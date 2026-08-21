import { describe, it, expect } from "vitest";
import {
  startOfDay, addDays, isoWeekday, startOfWeek, normalizeSchedule, periods,
  overlapsWindow, computeStats, isRequiredOn, canBackfill, dotState,
  periodScore, meetsTarget,
} from "./habit-stats";

/* ================================================================== */
/* SHARED FIXTURES — declared ONCE. Later tasks reuse these.          */
/*                                                                     */
/* Verified calendar:                                                  */
/*   Mon 17 Aug 2026 .. Sun 23 Aug 2026                                */
/*   Mon 24 Aug 2026 .. Sun 30 Aug 2026                                */
/*   27 Jul, 3 Aug, 10 Aug and 28 Dec 2026 are all Mondays             */
/* ================================================================== */

export const MON17 = new Date(2026, 7, 17);
export const TUE18 = new Date(2026, 7, 18);
export const WED19 = new Date(2026, 7, 19);
export const THU20 = new Date(2026, 7, 20);
export const FRI21 = new Date(2026, 7, 21);
export const SAT22 = new Date(2026, 7, 22);
export const SUN23 = new Date(2026, 7, 23);

export const THU20_NOON = new Date(2026, 7, 20, 12, 0);
export const NEXT_MIDNIGHT = new Date(2026, 7, 21); // `to` while now is Thu 20th
export const EPOCH = new Date(0);

export const logsOn = (...ds: Date[]) => ds.map((d) => ({ loggedAt: d }));

describe("date helpers", () => {
  it("startOfDay strips the time in local terms", () => {
    const d = startOfDay(new Date(2026, 7, 20, 15, 30));
    expect(d.getHours()).toBe(0);
    expect(d.getDate()).toBe(20);
  });

  it("addDays crosses month boundaries", () => {
    const d = addDays(new Date(2026, 7, 31), 1);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(1);
  });

  it("isoWeekday returns 1 for Monday and 7 for Sunday", () => {
    expect(isoWeekday(MON17)).toBe(1);
    expect(isoWeekday(SUN23)).toBe(7);
  });

  it("startOfWeek returns the Monday of that week", () => {
    const w = startOfWeek(THU20);
    expect(w.getDate()).toBe(17);
    expect(isoWeekday(w)).toBe(1);
  });

  it("startOfWeek on a Sunday returns the preceding Monday", () => {
    expect(startOfWeek(SUN23).getDate()).toBe(17);
  });

  it("startOfWeek does not split a week across a year boundary", () => {
    // Mon 28 Dec 2026 .. Sun 3 Jan 2027 is ONE week. Week-NUMBER keying
    // would split it, because getFullYear() disagrees with the ISO
    // week-year across Dec 29 - Jan 3.
    const a = startOfWeek(new Date(2026, 11, 28));
    const b = startOfWeek(new Date(2027, 0, 3));
    expect(a.getTime()).toBe(b.getTime());
  });
});

describe("normalizeSchedule", () => {
  const DAILY = { kind: "daily" };

  it("keeps a valid per_week count", () => {
    expect(normalizeSchedule({ type: "per_week", count: 3 }))
      .toEqual({ kind: "perWeek", count: 3 });
  });

  it("keeps and sorts valid days", () => {
    expect(normalizeSchedule({ type: "daily", days: [5, 1, 3] }))
      .toEqual({ kind: "days", days: [1, 3, 5] });
  });

  it("dedupes days", () => {
    expect(normalizeSchedule({ type: "daily", days: [1, 1, 3] }))
      .toEqual({ kind: "days", days: [1, 3] });
  });

  // Each of these would poison periodScore / rate30d / strength if it survived.
  it.each([
    ["count 9 (unreachable in a 7-day week)", { type: "per_week", count: 9 }],
    ["count 0 (division by zero)", { type: "per_week", count: 0 }],
    ["count 1 (identical to a one-day schedule)", { type: "per_week", count: 1 }],
    ["count 7 (daily by definition)", { type: "per_week", count: 7 }],
    ["count 3.5 (non-integer)", { type: "per_week", count: 3.5 }],
    ["count NaN", { type: "per_week", count: NaN }],
    ["count Infinity", { type: "per_week", count: Infinity }],
    ["count as a string", { type: "per_week", count: "3" }],
    ["empty days", { type: "daily", days: [] }],
    ["all seven days", { type: "daily", days: [1, 2, 3, 4, 5, 6, 7] }],
    ["JS getDay() convention (0 = Sunday)", { type: "daily", days: [0] }],
    ["out-of-range days", { type: "daily", days: [8, 9] }],
    ["unrecognised type", { type: "monthly" }],
    ["empty object", {}],
    ["null", null],
    ["a string", "daily"],
  ])("falls back to daily: %s", (_label, input) => {
    expect(normalizeSchedule(input)).toEqual(DAILY);
  });

  it("keeps valid days when mixed with invalid ones", () => {
    expect(normalizeSchedule({ type: "daily", days: [1, 0, 3, 99] }))
      .toEqual({ kind: "days", days: [1, 3] });
  });
});

describe("periods — daily, build", () => {
  const daily = { kind: "daily" as const };

  it("emits one period per day from creation to today inclusive", () => {
    const p = periods(daily, "build", MON17, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(4); // 17, 18, 19, 20
    expect(p[0].target).toBe(1);
  });

  it("marks today's period open and earlier ones closed", () => {
    const p = periods(daily, "build", MON17, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p.slice(0, 3).every((x) => x.closed)).toBe(true);
    expect(p[3].closed).toBe(false);
  });

  it("counts a logged day as actual 1", () => {
    const p = periods(daily, "build", MON17, logsOn(new Date(2026, 7, 18, 12)),
                      EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[1].actual).toBe(1);
    expect(p[0].actual).toBe(0);
  });

  it("counts two logs on one day only once", () => {
    const p = periods(daily, "build", MON17,
      logsOn(new Date(2026, 7, 18, 9), new Date(2026, 7, 18, 21)),
      EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[1].actual).toBe(1);
  });

  it("emits nothing before the habit existed", () => {
    const p = periods(daily, "build", WED19, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(2); // 19, 20
  });

  it("clamps a future createdAt to now", () => {
    const p = periods(daily, "build", new Date(2027, 0, 1), [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(1);
  });

  it("does not emit a phantom creation period far outside the window", () => {
    // An unbounded creation clause emitted a lone 2023 period followed by a
    // 2-year gap, and made the day loop run from createdAt every time.
    const old = new Date(2023, 0, 2);
    const from = addDays(startOfDay(THU20_NOON), -365);
    const p = periods(daily, "build", old, [], from, NEXT_MIDNIGHT, THU20_NOON);
    expect(p.length).toBeLessThanOrEqual(366);
    expect(p[0].start.getTime()).toBeGreaterThanOrEqual(from.getTime());
  });
});

describe("periods — daily, break", () => {
  const daily = { kind: "daily" as const };

  it("sets the target to 0 — a ceiling, not a goal", () => {
    // With target 1, `actual <= target` is always true and break polarity
    // becomes inert: a habit logged every day would report a full streak.
    const p = periods(daily, "break", MON17, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[0].target).toBe(0);
  });

  it("still counts logs into actual", () => {
    const p = periods(daily, "break", MON17, logsOn(new Date(2026, 7, 18, 12)),
                      EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[1].actual).toBe(1); // 1 > 0 ceiling, so a failure downstream
  });
});

describe("periods — specific days", () => {
  const MWF = { kind: "days" as const, days: [1, 3, 5] };

  it("emits only required days", () => {
    const p = periods(MWF, "build", MON17, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(2); // Mon 17, Wed 19
  });

  it("a habit created on a non-required day starts at its first required day", () => {
    const p = periods(MWF, "build", TUE18, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(1);
    expect(p[0].start.getDate()).toBe(19);
    expect(p[0].target).toBe(1); // full target, no pro-rating
  });

  it("uses a 0 ceiling for break polarity", () => {
    const p = periods(MWF, "break", MON17, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[0].target).toBe(0);
  });
});

describe("periods — per week", () => {
  const X3 = { kind: "perWeek" as const, count: 3 };

  it("emits the current week even though it ends in the future", () => {
    const p = periods(X3, "build", MON17, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(1);
    expect(p[0].closed).toBe(false);
    expect(p[0].end.getDate()).toBe(24); // next Monday, beyond `to`
  });

  it("counts distinct logged days across the week", () => {
    const p = periods(X3, "build", MON17,
      logsOn(new Date(2026, 7, 17, 12), new Date(2026, 7, 19, 12)),
      EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[0].actual).toBe(2);
  });

  it("keeps the full target when created early enough to reach it", () => {
    const p = periods(X3, "build", WED19, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[0].target).toBe(3); // Wed..Sun = 5 days
  });

  it("pro-rates a build habit's creation week when the target is unreachable", () => {
    const SAT_NOW = new Date(2026, 7, 22, 12);
    const p = periods(X3, "build", SAT22, [], EPOCH, new Date(2026, 7, 23), SAT_NOW);
    expect(p[0].target).toBe(2); // Sat, Sun
  });

  it("pro-rates a Sunday creation to 1", () => {
    const SUN_NOW = new Date(2026, 7, 23, 12);
    const p = periods(X3, "build", SUN23, [], EPOCH, new Date(2026, 7, 24), SUN_NOW);
    expect(p[0].target).toBe(1);
  });

  it("does NOT pro-rate a break habit's creation week", () => {
    // For break polarity `count` is an ALLOWANCE. Shrinking it would make the
    // creation week stricter than the ongoing rule — the opposite of the
    // "don't judge time it did not exist" rationale.
    const SAT_NOW = new Date(2026, 7, 22, 12);
    const p = periods(X3, "break", SAT22, [], EPOCH, new Date(2026, 7, 23), SAT_NOW);
    expect(p[0].target).toBe(3);
  });

  it("does not pro-rate weeks after the creation week", () => {
    const NEXT_THU = new Date(2026, 7, 27, 12);
    const p = periods(X3, "build", SAT22, [], EPOCH, new Date(2026, 7, 28), NEXT_THU);
    expect(p).toHaveLength(2);
    expect(p[0].target).toBe(2); // creation week, pro-rated
    expect(p[1].target).toBe(3); // full week
  });

  it("never drops the creation period when `from` is mid-week", () => {
    // The flyout passes from = createdAt; startOfWeek(createdAt) < createdAt,
    // so a naive `start >= from` trim would delete the week being pro-rated.
    const p = periods(X3, "build", WED19, [], WED19, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(1);
  });

  it("trims a window-straddling week that is not the creation week", () => {
    // createdAt is WELL before `from`, so the creation clause does not apply
    // and the Aug 17 week is trimmed for starting before `from`.
    const created = new Date(2026, 6, 1);
    const NEXT_THU = new Date(2026, 7, 27, 12);
    const p = periods(X3, "build", created, [], new Date(2026, 7, 19),
                      new Date(2026, 7, 28), NEXT_THU);
    expect(p).toHaveLength(1);
    expect(p[0].start.getDate()).toBe(24);
  });

  it("treats a week spanning the new year as one period", () => {
    const DEC28 = new Date(2026, 11, 28);
    const JAN1_NOW = new Date(2027, 0, 1, 12);
    const p = periods(X3, "build", DEC28, [], EPOCH, new Date(2027, 0, 2), JAN1_NOW);
    expect(p).toHaveLength(1);
  });
});

describe("overlapsWindow — the window trim predicate", () => {
  const JUL1 = new Date(2026, 6, 1);

  it("admits a period starting inside the window", () => {
    expect(overlapsWindow(WED19, THU20, MON17, JUL1)).toBe(true);
  });

  it("rejects a period entirely before the window", () => {
    expect(overlapsWindow(JUL1, new Date(2026, 6, 2), MON17, JUL1)).toBe(false);
  });

  it("admits the creation period even when it starts before `from`", () => {
    // startOfWeek(createdAt) < createdAt, so the flyout's from = createdAt
    // would otherwise delete the week being pro-rated.
    expect(overlapsWindow(MON17, new Date(2026, 7, 24), WED19, WED19)).toBe(true);
  });

  it("does NOT admit a creation period that ended before the window", () => {
    // The phantom-period bug: without `end > from`, a habit created in 2023
    // emits a lone period two years adrift from the rest of the list.
    const created2023 = new Date(2023, 0, 2);
    expect(
      overlapsWindow(created2023, new Date(2023, 0, 3), MON17, created2023),
    ).toBe(false);
  });

  it("rejects a non-creation period straddling the window start", () => {
    expect(overlapsWindow(MON17, THU20, WED19, JUL1)).toBe(false);
  });
});

const daily = { kind: "daily" as const };
const stats = (
  sched: any, created: Date, logs: any[], now: Date, to: Date,
  polarity: "build" | "break" = "build",
) => computeStats(sched, polarity, created, logs, EPOCH, to, now);

describe("computeStats — the empty-set guard", () => {
  it("returns 0, never NaN, for a habit created today", () => {
    // The list is NOT empty — the current period is always emitted — but
    // rate30d filters to CLOSED periods and finds none.
    const s = stats(daily, THU20, [], THU20_NOON, NEXT_MIDNIGHT);
    expect(s.rate30d).toBe(0);
    expect(Number.isNaN(s.rate30d)).toBe(false);
    expect(s.strength).toBe(0);
    expect(s.currentStreak).toBe(0);
    expect(s.bestStreak).toBe(0);
  });

  it("returns 0 for a per-week habit whose first week has not closed", () => {
    const s = stats({ kind: "perWeek", count: 3 }, WED19, [], THU20_NOON, NEXT_MIDNIGHT);
    expect(s.rate30d).toBe(0);
    expect(Number.isNaN(s.rate30d)).toBe(false);
  });
});

describe("computeStats — currentStreak, build", () => {
  it("survives an open unmet period", () => {
    // Logged Mon/Tue/Wed, today (Thu) not yet. THE bug in habit_stats.
    const s = stats(daily, MON17,
      logsOn(new Date(2026, 7, 17, 12), new Date(2026, 7, 18, 12), new Date(2026, 7, 19, 12)),
      THU20_NOON, NEXT_MIDNIGHT);
    expect(s.currentStreak).toBe(3);
  });

  it("counts the open period once it is met", () => {
    const s = stats(daily, MON17,
      logsOn(new Date(2026, 7, 17, 12), new Date(2026, 7, 18, 12),
             new Date(2026, 7, 19, 12), new Date(2026, 7, 20, 12)),
      THU20_NOON, NEXT_MIDNIGHT);
    expect(s.currentStreak).toBe(4);
  });

  it("breaks on a closed unmet period", () => {
    const FRI21_NOON = new Date(2026, 7, 21, 12);
    const s = stats(daily, MON17,
      logsOn(new Date(2026, 7, 17, 12), new Date(2026, 7, 18, 12), new Date(2026, 7, 19, 12)),
      FRI21_NOON, new Date(2026, 7, 22));
    expect(s.currentStreak).toBe(0);
  });
});

describe("computeStats — currentStreak, break", () => {
  it("never credits the open period", () => {
    // A break habit satisfies its ceiling at 00:00. Crediting it would award
    // a streak before it was earned, then decrement it on logging.
    const s = stats(daily, MON17, [], THU20_NOON, NEXT_MIDNIGHT, "break");
    expect(s.currentStreak).toBe(3); // Mon, Tue, Wed closed and clean — NOT 4
  });

  it("breaks when the habit was logged", () => {
    const s = stats(daily, MON17, logsOn(new Date(2026, 7, 18, 12)),
                    THU20_NOON, NEXT_MIDNIGHT, "break");
    expect(s.currentStreak).toBe(1); // only Wednesday
  });

  it("reports a zero streak when logged every day", () => {
    // The regression guard: with a target of 1 instead of a 0 ceiling this
    // returned a full streak and 100%.
    const s = stats(daily, MON17,
      logsOn(new Date(2026, 7, 17, 12), new Date(2026, 7, 18, 12),
             new Date(2026, 7, 19, 12), new Date(2026, 7, 20, 12)),
      THU20_NOON, NEXT_MIDNIGHT, "break");
    expect(s.currentStreak).toBe(0);
    expect(s.rate30d).toBe(0);
  });
});

describe("computeStats — per-week streaks count weeks", () => {
  const X3 = { kind: "perWeek" as const, count: 3 };

  it("counts three consecutive met weeks as 3", () => {
    const created = new Date(2026, 6, 27); // Mon 27 Jul
    const logs = logsOn(
      new Date(2026, 6, 27, 12), new Date(2026, 6, 28, 12), new Date(2026, 6, 29, 12),
      new Date(2026, 7, 3, 12),  new Date(2026, 7, 4, 12),  new Date(2026, 7, 5, 12),
      new Date(2026, 7, 10, 12), new Date(2026, 7, 11, 12), new Date(2026, 7, 12, 12),
    );
    const s = stats(X3, created, logs, THU20_NOON, NEXT_MIDNIGHT);
    expect(s.currentStreak).toBe(3);
    expect(s.unit).toBe("week");
  });

  it("a mid-week 1/3 neither counts nor breaks", () => {
    const created = new Date(2026, 7, 3);
    const logs = logsOn(
      new Date(2026, 7, 3, 12), new Date(2026, 7, 4, 12), new Date(2026, 7, 5, 12),
      new Date(2026, 7, 10, 12), new Date(2026, 7, 11, 12), new Date(2026, 7, 12, 12),
      new Date(2026, 7, 17, 12), // this week: 1 of 3, still open
    );
    const s = stats(X3, created, logs, THU20_NOON, NEXT_MIDNIGHT);
    expect(s.currentStreak).toBe(2);
  });

  it("honours a break habit's weekly allowance", () => {
    // "At most 3 a week": 3 logs is a pass, 4 is a fail.
    const created = new Date(2026, 7, 10); // Mon
    const ok = logsOn(new Date(2026, 7, 10, 12), new Date(2026, 7, 11, 12),
                      new Date(2026, 7, 12, 12));
    const over = logsOn(...ok.map((l) => l.loggedAt), new Date(2026, 7, 13, 12));
    expect(stats(X3, created, ok, THU20_NOON, NEXT_MIDNIGHT, "break").currentStreak).toBe(1);
    expect(stats(X3, created, over, THU20_NOON, NEXT_MIDNIGHT, "break").currentStreak).toBe(0);
  });
});

describe("computeStats — rate30d denominators (spec §9.2)", () => {
  it("divides a daily habit by its closed days", () => {
    const s = stats(daily, MON17,
      logsOn(new Date(2026, 7, 17, 12), new Date(2026, 7, 18, 12), new Date(2026, 7, 19, 12)),
      THU20_NOON, NEXT_MIDNIGHT);
    expect(s.rate30d).toBe(100); // 3 of 3 closed days
  });

  it("uses 30 closed day-periods for a long-running daily habit", () => {
    const created = new Date(2026, 5, 1);
    const s = stats(daily, created, [], THU20_NOON, NEXT_MIDNIGHT);
    expect(s.rate30d).toBe(0);
    // and with every day logged in the window it must be exactly 100
    const logs = Array.from({ length: 60 }, (_, i) =>
      ({ loggedAt: new Date(2026, 6, 1 + i, 12) }));
    expect(stats(daily, created, logs, THU20_NOON, NEXT_MIDNIGHT).rate30d).toBe(100);
  });

  it("uses only required days for a Mon/Wed/Fri habit (~13 in 30 days)", () => {
    const MWF = { kind: "days" as const, days: [1, 3, 5] };
    const created = new Date(2026, 5, 1);
    const logs = Array.from({ length: 90 }, (_, i) => new Date(2026, 5, 1 + i))
      .filter((d) => [1, 3, 5].includes(isoWeekday(d)))
      .map((d) => ({ loggedAt: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12) }));
    const s = stats(MWF, created, logs, THU20_NOON, NEXT_MIDNIGHT);
    expect(s.rate30d).toBe(100); // every required day met
  });

  it("gives partial credit for a 2-of-3 week", () => {
    const X3 = { kind: "perWeek" as const, count: 3 };
    const created = new Date(2026, 7, 10);
    const logs = logsOn(new Date(2026, 7, 10, 12), new Date(2026, 7, 11, 12));
    const s = stats(X3, created, logs, THU20_NOON, NEXT_MIDNIGHT);
    expect(s.rate30d).toBeCloseTo(66.7, 0);
  });

  it("scores a break habit's clean closed period as 1", () => {
    const s = stats(daily, MON17, [], THU20_NOON, NEXT_MIDNIGHT, "break");
    expect(s.rate30d).toBe(100);
  });

  it("never divides by a zero target on a break habit", () => {
    const s = stats(daily, MON17, logsOn(new Date(2026, 7, 18, 12)),
                    THU20_NOON, NEXT_MIDNIGHT, "break");
    expect(Number.isFinite(s.rate30d)).toBe(true);
    expect(s.rate30d).toBeCloseTo(66.7, 0); // 2 clean of 3 closed
  });
});

describe("computeStats — strength (spec §9.2 parity)", () => {
  it("uses a NORMALISED weighted mean, not a zero-seeded recursion", () => {
    // Pinned deliberately. This fixture logs all ten days including today, so
    // the normalised weighted mean scores it 100 while a zero-seeded
    // s = ax + (1-a)s scores 48.7 — the > 80 bound is what discriminates.
    // Only the normalised form reproduces spec §2.4's "a habit at 90% reads
    // about 84% each morning" (which describes an UNLOGGED open period).
    // Drift here would be invisible in production.
    const created = new Date(2026, 7, 11);
    const logs = Array.from({ length: 10 }, (_, i) =>
      ({ loggedAt: new Date(2026, 7, 11 + i, 12) }));
    const s = stats(daily, created, logs, THU20_NOON, NEXT_MIDNIGHT);
    expect(s.strength).toBeGreaterThan(80);
    expect(s.strength).toBeLessThanOrEqual(100);
  });

  it("a perfect long-running daily habit approaches 100", () => {
    const created = new Date(2026, 5, 1);
    const logs = Array.from({ length: 90 }, (_, i) =>
      ({ loggedAt: new Date(2026, 5, 1 + i, 12) }));
    expect(stats(daily, created, logs, THU20_NOON, NEXT_MIDNIGHT).strength).toBe(100);
  });
});

describe("computeStats — timezone (spec §9.2)", () => {
  it("buckets a 00:30 local log onto that local day", () => {
    const s = stats(daily, MON17, logsOn(new Date(2026, 7, 18, 0, 30)),
                    THU20_NOON, NEXT_MIDNIGHT);
    // If it slipped to the 17th, the 18th would be a miss and the streak 0.
    expect(s.rate30d).toBeCloseTo(33.3, 0);
  });
});

describe("computeStats — bestStreak and current", () => {
  it("finds the longest run, not the current one", () => {
    const created = new Date(2026, 7, 10);
    const logs = logsOn(
      new Date(2026, 7, 10, 12), new Date(2026, 7, 11, 12), new Date(2026, 7, 12, 12),
      new Date(2026, 7, 13, 12), // 4-day run, gap on the 14th
      new Date(2026, 7, 17, 12), new Date(2026, 7, 18, 12),
    );
    expect(stats(daily, created, logs, THU20_NOON, NEXT_MIDNIGHT).bestStreak).toBe(4);
  });

  it("exposes the open period as `current`", () => {
    const s = stats(daily, MON17, [], THU20_NOON, NEXT_MIDNIGHT);
    expect(s.current).not.toBeNull();
    expect(s.current!.closed).toBe(false);
  });

  it("`current` is null on a non-required day of a days schedule", () => {
    // §4.5's summary cards and §5.4's fraction must handle this.
    const MWF = { kind: "days" as const, days: [1, 3, 5] };
    const s = stats(MWF, MON17, [], THU20_NOON, NEXT_MIDNIGHT); // Thu is not required
    expect(s.current).toBeNull();
  });
});

describe("computeStats — unit", () => {
  it("is day for daily and specific days, week for per-week", () => {
    expect(stats(daily, MON17, [], THU20_NOON, NEXT_MIDNIGHT).unit).toBe("day");
    expect(stats({ kind: "days", days: [1, 3, 5] }, MON17, [], THU20_NOON, NEXT_MIDNIGHT).unit).toBe("day");
    expect(stats({ kind: "perWeek", count: 3 }, MON17, [], THU20_NOON, NEXT_MIDNIGHT).unit).toBe("week");
  });
});

const MWF = { kind: "days" as const, days: [1, 3, 5] };
const DAILY_S = { kind: "daily" as const };
const X3S = { kind: "perWeek" as const, count: 3 };

describe("isRequiredOn — Today page filter only", () => {
  it("is true every day for daily", () => {
    expect(isRequiredOn({ type: "daily" }, TUE18)).toBe(true);
  });

  it("is true only on listed weekdays for a days schedule", () => {
    expect(isRequiredOn({ type: "daily", days: [1, 3, 5] }, MON17)).toBe(true);
    expect(isRequiredOn({ type: "daily", days: [1, 3, 5] }, TUE18)).toBe(false);
  });

  it("is true every day for per-week — any day may be used", () => {
    expect(isRequiredOn({ type: "per_week", count: 3 }, TUE18)).toBe(true);
  });

  it("takes raw jsonb, since today_agenda supplies item_details.schedule", () => {
    expect(isRequiredOn(null, TUE18)).toBe(true); // normalises to daily
  });
});

describe("canBackfill", () => {
  it("is false for a future date", () => {
    expect(canBackfill(DAILY_S, FRI21, THU20)).toBe(false);
  });

  it("is true for a past-or-today date on daily", () => {
    expect(canBackfill(DAILY_S, MON17, THU20)).toBe(true);
    expect(canBackfill(DAILY_S, THU20, THU20)).toBe(true);
  });

  it("is TRUE for a per-week habit's unlogged past day", () => {
    // An earlier spec revision made this false and so made per-week backfill
    // impossible — the schedule where it matters most.
    expect(canBackfill(X3S, TUE18, THU20)).toBe(true);
  });

  it("is false on an unlisted weekday of a days schedule", () => {
    // A log there is invisible to every statistic yet would render as done.
    expect(canBackfill(MWF, TUE18, THU20)).toBe(false);
    expect(canBackfill(MWF, MON17, THU20)).toBe(true);
  });
});

describe("dotState", () => {
  it("future beats everything", () => {
    expect(dotState(DAILY_S, "build", FRI21, THU20, false)).toBe("future");
  });

  it("logged is done for build and broke for break", () => {
    expect(dotState(DAILY_S, "build", MON17, THU20, true)).toBe("done");
    expect(dotState(DAILY_S, "break", MON17, THU20, true)).toBe("broke");
  });

  it("a break habit's clean past day is clean, NOT missed", () => {
    // An earlier revision had no break branch on the final rule, so thirty
    // successful days of abstention painted thirty red dots.
    expect(dotState(DAILY_S, "break", MON17, THU20, false)).toBe("clean");
  });

  it("a build habit's unlogged required past day is missed", () => {
    expect(dotState(DAILY_S, "build", MON17, THU20, false)).toBe("missed");
  });

  it("today unlogged is pending, not missed", () => {
    expect(dotState(DAILY_S, "build", THU20, THU20, false)).toBe("pending");
  });

  it("a per-week unlogged day is idle — never red", () => {
    expect(dotState(X3S, "build", MON17, THU20, false)).toBe("idle");
  });

  it("an off-day on a days schedule is not-required", () => {
    expect(dotState(MWF, "build", TUE18, THU20, false)).toBe("not-required");
  });
});

/* ================================================================== */
/* Gaps found in the module-completion review (21 Aug)                */
/* ================================================================== */

describe("periodScore and meetsTarget — direct coverage", () => {
  // Both were previously exercised only through computeStats, so an
  // off-by-one here could survive if computeStats' assertions happened
  // not to expose it.
  const period = (target: number, actual: number) => ({
    start: MON17, end: TUE18, target, actual, closed: true,
  });

  it("build: gives partial credit and caps at 1", () => {
    expect(periodScore(period(3, 2), "build")).toBeCloseTo(2 / 3);
    expect(periodScore(period(3, 5), "build")).toBe(1);
    expect(periodScore(period(3, 0), "build")).toBe(0);
  });

  it("build: a zero target scores on presence, avoiding a divide", () => {
    expect(periodScore(period(0, 1), "build")).toBe(1);
    expect(periodScore(period(0, 0), "build")).toBe(0);
  });

  it("break: scores the ceiling, never divides", () => {
    expect(periodScore(period(0, 0), "break")).toBe(1); // clean day
    expect(periodScore(period(0, 1), "break")).toBe(0); // broke it
    expect(periodScore(period(3, 3), "break")).toBe(1); // at the allowance
    expect(periodScore(period(3, 4), "break")).toBe(0); // over it
  });

  it("meetsTarget flips its comparison on polarity", () => {
    expect(meetsTarget(period(3, 3), "build")).toBe(true);
    expect(meetsTarget(period(3, 2), "build")).toBe(false);
    expect(meetsTarget(period(0, 0), "break")).toBe(true);
    expect(meetsTarget(period(0, 1), "break")).toBe(false);
  });
});

describe("dotState — rule-order edge cases", () => {
  it("a per-week habit's unlogged TODAY is idle, not pending", () => {
    // Rule 3 (perWeek) fires before rule 5 (today). Every other `idle`
    // assertion uses a PAST date, so this is the one that pins the order.
    expect(dotState(X3S, "build", THU20, THU20, false)).toBe("idle");
  });

  it("a log on a non-required day paints done — the known quirk", () => {
    // canBackfill forbids creating this through the UI, but the MCP server
    // or an agent can write it directly. periods() emits no period for that
    // day so no statistic reflects it, yet rule 2 precedes rule 4 and paints
    // it done. Pinned so a refactor cannot silently change it either way.
    expect(canBackfill(MWF, TUE18, THU20)).toBe(false);
    expect(dotState(MWF, "build", TUE18, THU20, true)).toBe("done");
  });
});
