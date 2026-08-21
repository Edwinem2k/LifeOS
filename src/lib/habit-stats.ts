/**
 * Pure habit statistics. No Supabase, no React, no app imports —
 * everything here is a function of its arguments, which is what makes it
 * testable in a way the habit_stats SQL view is not.
 *
 * Core idea: the schedule defines a PERIOD, and streaks count periods
 * rather than days. See spec §2.
 */

/* ------------------------------------------------------------------ */
/* Date helpers — all local time (spec §2.6)                           */
/* ------------------------------------------------------------------ */

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** ISO-8601 weekday: 1 = Monday .. 7 = Sunday. */
export function isoWeekday(d: Date): number {
  const js = d.getDay(); // 0 = Sunday
  return js === 0 ? 7 : js;
}

/**
 * Monday local-midnight of the week containing `d`.
 * A week is identified by this date and NEVER by a week number.
 */
export function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -(isoWeekday(d) - 1));
}

/* ------------------------------------------------------------------ */
/* Schedule normalisation (spec §2.1)                                  */
/* ------------------------------------------------------------------ */

export type NormalizedSchedule =
  | { kind: "daily" }
  | { kind: "days"; days: number[] }      // sorted, deduped, each 1..7, length 1..6
  | { kind: "perWeek"; count: number };   // integer 2..6

const DAILY: NormalizedSchedule = { kind: "daily" };

export function normalizeSchedule(raw: unknown): NormalizedSchedule {
  if (!raw || typeof raw !== "object") return DAILY;
  const o = raw as Record<string, unknown>;

  if (o.type === "per_week") {
    const c = o.count;
    // ONE positive predicate, deliberately. Two negative bounds would let
    // NaN through both while remaining typeof "number".
    return typeof c === "number" && Number.isInteger(c) && c >= 2 && c <= 6
      ? { kind: "perWeek", count: c }
      : DAILY;
  }

  if (o.type === "daily") {
    if (!Array.isArray(o.days)) return DAILY;
    const days = Array.from(
      new Set(
        o.days.filter(
          (x): x is number =>
            typeof x === "number" && Number.isInteger(x) && x >= 1 && x <= 7,
        ),
      ),
    ).sort((a, b) => a - b);
    if (days.length === 0 || days.length === 7) return DAILY;
    return { kind: "days", days };
  }

  return DAILY;
}

/* ------------------------------------------------------------------ */
/* Period generation (spec §2.2)                                       */
/* ------------------------------------------------------------------ */

export type Polarity = "build" | "break";

export type Period = {
  start: Date;     // inclusive, local midnight
  end: Date;       // exclusive, local midnight
  target: number;  // a GOAL for build, a CEILING for break
  actual: number;  // distinct days logged within [start, end)
  closed: boolean; // end <= now
};

export type HabitLog = { loggedAt: Date };

/**
 * Does a period survive the window trim?
 *
 * Three clauses, each load-bearing:
 *   - `start >= from` — the ordinary case, the period starts inside the window.
 *   - `start <= created && created < end` — the habit's CREATION period is
 *     protected from the trim even when it starts before `from`, so it can be
 *     pro-rated. Without this the flyout's `from = createdAt` deletes the very
 *     week that needs pro-rating, since startOfWeek(createdAt) < createdAt.
 *   - `end > from` — bounds that protection. Without it a habit created in 2023
 *     viewed through a 365-day window emits a lone phantom period two years
 *     before everything else in the list.
 */
export function overlapsWindow(
  start: Date, end: Date, from: Date, created: Date,
): boolean {
  return start >= from || (start <= created && created < end && end > from);
}

/**
 * Oldest-first list of periods.
 *
 * `to` is the exclusive end of the range of interest and callers ALWAYS
 * pass tomorrow's local midnight — that is what makes today's daily period
 * whole and "the current period" well defined everywhere.
 *
 * `now` is injected so tests are deterministic.
 */
export function periods(
  schedule: NormalizedSchedule,
  polarity: Polarity,
  createdAt: Date,
  logs: HabitLog[],
  from: Date,
  to: Date,
  now: Date = new Date(),
): Period[] {
  // A future or clock-skewed created_at would put the creation floor above
  // the current period and delete it entirely.
  const created = new Date(Math.min(createdAt.getTime(), now.getTime()));

  const loggedDays = new Set(logs.map((l) => startOfDay(l.loggedAt).getTime()));
  const out: Period[] = [];

  if (schedule.kind === "perWeek") {
    // Start at the later boundary. With the bounded `overlapsWindow` above,
    // anything earlier would be rejected anyway, so this only avoids wasted
    // iterations.
    const first = startOfWeek(created);
    const windowFirst = startOfWeek(from);
    let ws = windowFirst > first ? windowFirst : first;

    for (; ws < to; ws = addDays(ws, 7)) {
      const we = addDays(ws, 7);
      if (!overlapsWindow(ws, we, from, created)) continue;

      let target = schedule.count;
      // Pro-rate ONLY a BUILD habit's creation week. For break polarity
      // `count` is an allowance, and shrinking it would make the creation
      // week stricter than the ongoing rule.
      if (polarity === "build" && ws <= created && created < we) {
        const daysRemaining = 7 - (isoWeekday(created) - 1); // inclusive
        target = Math.min(schedule.count, daysRemaining);
      }

      let actual = 0;
      for (let i = 0; i < 7; i++) {
        if (loggedDays.has(addDays(ws, i).getTime())) actual++;
      }

      out.push({ start: ws, end: we, target, actual, closed: we <= now });
    }
    return out;
  }

  // daily and days: one period per REQUIRED day. A non-required day yields no
  // period at all, which is what makes it neutral downstream.
  //
  // Target is 1 for build (do it once) and 0 for break (do it zero times).
  // Getting this wrong makes `actual <= target` always true and break
  // polarity completely inert.
  const dayTarget = polarity === "break" ? 0 : 1;

  const firstDay = startOfDay(created);
  const windowFirstDay = startOfDay(from);
  let d = windowFirstDay > firstDay ? windowFirstDay : firstDay;

  for (; d < to; d = addDays(d, 1)) {
    const required =
      schedule.kind === "daily" || schedule.days.includes(isoWeekday(d));
    if (!required) continue;

    const end = addDays(d, 1);
    if (!overlapsWindow(d, end, from, created)) continue;

    out.push({
      start: d,
      end,
      target: dayTarget, // never pro-rated: a habit made at 15:00 can still be logged tonight
      actual: loggedDays.has(d.getTime()) ? 1 : 0,
      closed: end <= now,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Scoring and statistics (spec §2.3, §2.4)                            */
/* ------------------------------------------------------------------ */

/**
 * One function for both polarities, so nothing ever divides by a target
 * that may legitimately be zero.
 */
export function periodScore(p: Period, polarity: Polarity): number {
  // For break, `target` is a CEILING set by periods(): 0 for daily and
  // specific-days, `count` as an allowance for per-week.
  if (polarity === "break") return p.actual <= p.target ? 1 : 0;
  if (p.target > 0) return Math.min(p.actual / p.target, 1);
  return p.actual > 0 ? 1 : 0;
}

export function meetsTarget(p: Period, polarity: Polarity): boolean {
  return polarity === "break" ? p.actual <= p.target : p.actual >= p.target;
}

export type HabitStats = {
  currentStreak: number;
  bestStreak: number;
  rate30d: number;   // percentage, 0..100
  strength: number;  // percentage, 0..100
  unit: "day" | "week";
  current: Period | null; // the open period, for the row fraction and summary cards
};

const EWMA_ALPHA = 2 / 31; // span 30, matching the existing SQL model

export function computeStats(
  schedule: NormalizedSchedule,
  polarity: Polarity,
  createdAt: Date,
  logs: HabitLog[],
  from: Date,
  to: Date,
  now: Date = new Date(),
): HabitStats {
  const ps = periods(schedule, polarity, createdAt, logs, from, to, now);
  const unit = schedule.kind === "perWeek" ? "week" : "day";

  const last = ps.length ? ps[ps.length - 1] : null;
  const current = last && !last.closed ? last : null;

  /* --- currentStreak: walk backwards over PERIODS ------------------ */
  let currentStreak = 0;
  let i = ps.length - 1;

  if (i >= 0 && !ps[i].closed) {
    // The open period. For build it counts only if already met; for break it
    // is ALWAYS skipped, since the ceiling is trivially satisfied from 00:00.
    if (polarity === "build" && meetsTarget(ps[i], polarity)) currentStreak++;
    i--;
  }
  for (; i >= 0; i--) {
    if (!meetsTarget(ps[i], polarity)) break;
    currentStreak++;
  }

  /* --- bestStreak: longest run anywhere in the window -------------- */
  let bestStreak = 0;
  let run = 0;
  for (const p of ps) {
    if (!p.closed) continue;
    if (meetsTarget(p, polarity)) {
      run++;
      if (run > bestStreak) bestStreak = run;
    } else {
      run = 0;
    }
  }
  if (currentStreak > bestStreak) bestStreak = currentStreak;

  /* --- rate30d: CLOSED periods ending in the last 30 days ---------- */
  // Guard on THIS statistic's own input set, not on `ps`. A habit created
  // today has a non-empty `ps` (one open period) but zero closed periods,
  // and mean() over an empty set is NaN.
  const cutoff = addDays(startOfDay(now), -30);
  const recent = ps.filter((p) => p.closed && p.end > cutoff);
  const rate30d = recent.length
    ? (recent.reduce((a, p) => a + periodScore(p, polarity), 0) / recent.length) * 100
    : 0;

  /* --- strength: EWMA over periods, INCLUDING the open one --------- */
  // NORMALISED weighted mean (num/den), not a zero-seeded recursion. rate30d
  // is a scoreboard and must not be dragged down mid-period; strength is a
  // live trajectory and should decay and recover.
  let num = 0;
  let den = 0;
  for (let k = 0; k < ps.length; k++) {
    const age = ps.length - 1 - k;      // most recent period carries weight 1
    const w = Math.pow(1 - EWMA_ALPHA, age);
    num += periodScore(ps[k], polarity) * w;
    den += w;
  }
  const strength = den > 0 ? (num / den) * 100 : 0;

  return {
    currentStreak,
    bestStreak,
    rate30d: Math.round(rate30d * 10) / 10,
    strength: Math.round(strength * 10) / 10,
    unit,
    current,
  };
}
