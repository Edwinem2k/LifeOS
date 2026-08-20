# Habits Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the LifeOS Habits page — one row per habit, one tap to log today, a week of history inline, and a flyout with streak statistics and a month heatmap — on top of a pure TypeScript statistics module that handles daily, specific-day and per-week schedules correctly.

**Architecture:** A pure, dependency-free module (`src/lib/habit-stats.ts`) owns every calculation, built on one abstraction: the schedule defines a *period*, and streaks count periods rather than days. Services and TanStack Query hooks mirror the existing `projects.ts` shape. Components are split by responsibility from the start rather than accumulating in the page file. Nothing reads the existing `habit_stats` SQL view.

**Tech Stack:** Next.js 16.3.1, React 19, Tailwind v4, TanStack Query, supabase-js, Lucide, Vitest (new).

**Spec:** `docs/superpowers/specs/2026-08-20-habits-page-design.md` (rev 6, approved)

---

## Implementation clarifications

Two things surfaced while writing the code that the spec leaves ambiguous. Both are resolved here; neither changes a design decision.

**1. Window trimming must never drop the creation period.**

Spec §2.2(a) says "a period whose `start < from` is not emitted" and separately that the creation period is always emitted. For the list query (`from` = 365 days ago) these never conflict. For the flyout query, §3.3 says `from = createdAt` — and `startOfWeek(createdAt) < createdAt`, so the trim rule would drop the creation week that §2.2(b) exists to pro-rate.

Resolution: the emit condition is
```ts
start >= from || (start <= created && created < end)
```
The second clause protects the creation period unconditionally. The flyout additionally passes `from = new Date(0)`, which is what "unbounded" in §3.3 means in practice, so the clause is belt-and-braces rather than load-bearing.

**2. `periods()` takes `now` as an injected parameter.**

`closed` is defined against `now`, and every streak test depends on controlling it. `now` is a parameter defaulting to `new Date()` so tests are deterministic without mocking global time.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/habit-stats.ts` | **New.** Every calculation. Pure, no imports from the app. Date helpers, `normalizeSchedule`, `periods`, `periodScore`, the four statistics, and the three predicates. |
| `src/lib/habit-stats.test.ts` | **New.** Unit tests. The only automated coverage in this work. |
| `src/lib/constants.ts` | **Modify.** Add `polarity` and `metric` pill colour maps. |
| `src/services/habits.ts` | **Modify.** Currently two broken functions; becomes the full CRUD + logs surface. |
| `src/hooks/use-habits.ts` | **Modify.** Currently two hooks; becomes the full set with optimistic log/unlog. |
| `src/components/app/HabitRow.tsx` | **New.** One row: circle, name, subtitle, week dots, streak slot. |
| `src/components/app/SchedulePicker.tsx` | **New.** Popover editor for the `schedule` jsonb. |
| `src/components/app/HabitHeatmap.tsx` | **New.** Month grid with paging and backfill. |
| `src/components/app/HabitFlyout.tsx` | **New.** Flyout body: metadata, stats bar, heatmap, strength, linked goal. |
| `src/components/app/FlyoutPanel.tsx` | **Modify.** Add a `children` prop. |
| `src/components/app/AppNav.tsx` | **Modify.** One nav entry. |
| `src/app/(app)/habits/page.tsx` | **New.** Data fetching and page state only. |
| `src/app/(app)/page.tsx` | **Modify.** Filter habits by schedule (§8). |
| `src/app/(app)/goals/page.tsx` | **Modify.** Enable the "+ Link habit" stub, habit KR branch. |
| `supabase/migrations/006_habits_area.sql` | **New.** One column. |

---

## Chunk 1: Foundation — test harness, migration, statistics module

### Task 1: Vitest setup

The web app has no test runner. `package.json` scripts are `dev`/`build`/`start`/`lint` and there are zero test files under `src/`.

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest**

```bash
npm install -D vitest@^3.2
```

- [ ] **Step 2: Add the config**

Create `vitest.config.ts`. No jsdom — `habit-stats.ts` is pure, and component tests are explicitly out of scope (spec §9.2).

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

- [ ] **Step 3: Add the test script**

In `package.json`, add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify the runner starts**

Run: `npm test`
Expected: exits 0 with "No test files found" — the runner works and finds nothing yet.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest for the habit-stats module"
```

---

### Task 2: Migration 006

**Files:**
- Create: `supabase/migrations/006_habits_area.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 006_habits_area.sql
-- Adds `area` to habits, matching tasks.area, so habits can be
-- grouped and filtered by life area like every other entity.
--
-- No other schema change is needed for the Habits page:
--   - links.src_type / dst_type are plain text, so 'habit' already works
--   - schedule is already jsonb, so per-week schedules need no migration
--   - migrations 004/005 already exclude habits by construction

alter table habits add column area life_area;
```

- [ ] **Step 2: Apply it**

Paste into the Supabase SQL Editor for project `nhqxhntueexrzpyldvee` and run.

- [ ] **Step 3: Verify**

Run in the SQL editor:
```sql
select column_name, data_type
from information_schema.columns
where table_name = 'habits' and column_name = 'area';
```
Expected: one row, `area | USER-DEFINED`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/006_habits_area.sql
git commit -m "feat(db): add area column to habits"
```

---

### Task 3: Date helpers

All period boundaries are local-time (spec §2.6). These are the foundation everything else stands on, so they are tested first.

**Files:**
- Create: `src/lib/habit-stats.ts`
- Create: `src/lib/habit-stats.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { startOfDay, addDays, isoWeekday, startOfWeek } from "./habit-stats";

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
    expect(isoWeekday(new Date(2026, 7, 17))).toBe(1); // Mon 17 Aug 2026
    expect(isoWeekday(new Date(2026, 7, 23))).toBe(7); // Sun 23 Aug 2026
  });

  it("startOfWeek returns the Monday of that week", () => {
    const w = startOfWeek(new Date(2026, 7, 20)); // Thu
    expect(w.getDate()).toBe(17);
    expect(isoWeekday(w)).toBe(1);
  });

  it("startOfWeek on a Sunday returns the preceding Monday", () => {
    const w = startOfWeek(new Date(2026, 7, 23)); // Sun
    expect(w.getDate()).toBe(17);
  });

  it("startOfWeek does not split a week across a year boundary", () => {
    // Mon 28 Dec 2026 .. Sun 3 Jan 2027 is ONE week
    const a = startOfWeek(new Date(2026, 11, 28));
    const b = startOfWeek(new Date(2027, 0, 3));
    expect(a.getTime()).toBe(b.getTime());
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./habit-stats`.

- [ ] **Step 3: Implement**

Create `src/lib/habit-stats.ts`:

```ts
/**
 * Pure habit statistics. No Supabase, no React, no app imports —
 * everything here is a function of its arguments, which is what makes
 * it testable in a way the habit_stats SQL view is not.
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
 * A week is identified by this date and NEVER by a week number —
 * getFullYear() disagrees with the ISO week-year across Dec 29 - Jan 3,
 * which would split one week into two half-periods. (Spec §2.2)
 */
export function startOfWeek(d: Date): Date {
  return addDays(startOfDay(d), -(isoWeekday(d) - 1));
}

export function sameDay(a: Date, b: Date): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/habit-stats.ts src/lib/habit-stats.test.ts
git commit -m "feat: add local-time date helpers for habit stats"
```

---

### Task 4: `normalizeSchedule`

The module never trusts the raw jsonb — it is written by this UI, the MCP server, agents, and rows predating any validation (spec §2.1).

**Files:**
- Modify: `src/lib/habit-stats.ts`
- Modify: `src/lib/habit-stats.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { normalizeSchedule } from "./habit-stats";

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
```

**Why `NaN` gets its own case:** written as two negative bounds (`count >= 7 → daily`, `count < 1 → daily`), `NaN` fails *both* comparisons while still being `typeof "number"`, so it would survive as a `perWeek` target and turn every downstream statistic into `NaN`. The single positive `Number.isInteger` predicate is what closes it.

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `normalizeSchedule` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/habit-stats.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/habit-stats.ts src/lib/habit-stats.test.ts
git commit -m "feat: add schedule normalisation with NaN and range guards"
```

---

### Task 5: `periods()` — the generator

The core abstraction. Two separate concerns govern it: **window trimming** decides which periods exist, **creation pro-rating** decides the target of the period the habit was created in. Keeping them separate is what stops them colliding (spec §2.2).

**Files:**
- Modify: `src/lib/habit-stats.ts`
- Modify: `src/lib/habit-stats.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { periods, type Period } from "./habit-stats";

// Fixed calendar for every test below:
//   Mon 17 Aug 2026 ... Sun 23 Aug 2026
//   Mon 24 Aug 2026 ... Sun 30 Aug 2026
const MON17 = new Date(2026, 7, 17);
const WED19 = new Date(2026, 7, 19);
const SAT22 = new Date(2026, 7, 22);
const THU20_NOON = new Date(2026, 7, 20, 12, 0);
const EPOCH = new Date(0);
const NEXT_MIDNIGHT = new Date(2026, 7, 21); // "to" while now is Thu 20th

const logsOn = (...ds: Date[]) => ds.map((d) => ({ loggedAt: d }));

describe("periods — daily", () => {
  it("emits one period per day from creation to today inclusive", () => {
    const p = periods({ kind: "daily" }, MON17, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(4); // 17, 18, 19, 20
    expect(p[0].target).toBe(1);
  });

  it("marks today's period open and earlier ones closed", () => {
    const p = periods({ kind: "daily" }, MON17, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p.slice(0, 3).every((x) => x.closed)).toBe(true);
    expect(p[3].closed).toBe(false);
  });

  it("counts a logged day as actual 1", () => {
    const p = periods({ kind: "daily" }, MON17, logsOn(new Date(2026, 7, 18, 12)),
                      EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[1].actual).toBe(1);
    expect(p[0].actual).toBe(0);
  });

  it("counts two logs on one day only once", () => {
    const p = periods({ kind: "daily" }, MON17,
      logsOn(new Date(2026, 7, 18, 9), new Date(2026, 7, 18, 21)),
      EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[1].actual).toBe(1);
  });

  it("emits nothing before the habit existed", () => {
    const p = periods({ kind: "daily" }, WED19, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(2); // 19, 20 — not the 17th or 18th
  });

  it("clamps a future createdAt to now", () => {
    const future = new Date(2027, 0, 1);
    const p = periods({ kind: "daily" }, future, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(1); // today only, not zero
  });
});

describe("periods — specific days", () => {
  const MWF = { kind: "days" as const, days: [1, 3, 5] };

  it("emits only required days", () => {
    const p = periods(MWF, MON17, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(2); // Mon 17, Wed 19 — not Tue/Thu
  });

  it("a habit created on a non-required day starts at its first required day", () => {
    const TUE18 = new Date(2026, 7, 18);
    const p = periods(MWF, TUE18, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(1);
    expect(p[0].start.getDate()).toBe(19); // Wednesday
    expect(p[0].target).toBe(1);           // full target, no pro-rating
  });
});

describe("periods — per week", () => {
  const X3 = { kind: "perWeek" as const, count: 3 };

  it("emits the current week even though it ends in the future", () => {
    // THE rev-3 regression: "only whole periods" dropped this.
    const p = periods(X3, MON17, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(1);
    expect(p[0].closed).toBe(false);
    expect(p[0].end.getDate()).toBe(24); // next Monday, beyond `to`
  });

  it("counts distinct logged days across the week", () => {
    const p = periods(X3, MON17,
      logsOn(new Date(2026, 7, 17, 12), new Date(2026, 7, 19, 12)),
      EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[0].actual).toBe(2);
  });

  it("keeps the full target when created early enough to reach it", () => {
    const p = periods(X3, WED19, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[0].target).toBe(3); // Wed..Sun = 5 days, 3 sessions fit
  });

  it("pro-rates the creation week when the target cannot be reached", () => {
    const SAT = new Date(2026, 7, 22);
    const SAT_NOW = new Date(2026, 7, 22, 12);
    const p = periods(X3, SAT, [], EPOCH, new Date(2026, 7, 23), SAT_NOW);
    expect(p[0].target).toBe(2); // Sat, Sun = 2 days
  });

  it("pro-rates a Sunday creation to 1", () => {
    const SUN = new Date(2026, 7, 23);
    const SUN_NOW = new Date(2026, 7, 23, 12);
    const p = periods(X3, SUN, [], EPOCH, new Date(2026, 7, 24), SUN_NOW);
    expect(p[0].target).toBe(1);
  });

  it("does not pro-rate weeks after the creation week", () => {
    const SAT = new Date(2026, 7, 22);
    const NEXT_THU = new Date(2026, 7, 27, 12);
    const p = periods(X3, SAT, [], EPOCH, new Date(2026, 7, 28), NEXT_THU);
    expect(p).toHaveLength(2);
    expect(p[0].target).toBe(2); // creation week, pro-rated
    expect(p[1].target).toBe(3); // full week
  });

  it("never drops the creation period even when `from` is mid-week", () => {
    // The flyout passes from = createdAt; startOfWeek(createdAt) < createdAt,
    // so a naive `start >= from` trim would delete the week being pro-rated.
    const p = periods(X3, WED19, [], WED19, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(1);
  });

  it("trims a window-straddling week that is not the creation week", () => {
    const NEXT_THU = new Date(2026, 7, 27, 12);
    const p = periods(X3, MON17, [], new Date(2026, 7, 19), new Date(2026, 7, 28), NEXT_THU);
    expect(p).toHaveLength(1);            // only the second week
    expect(p[0].start.getDate()).toBe(24);
  });

  it("treats a week spanning the new year as one period", () => {
    const DEC28 = new Date(2026, 11, 28);
    const JAN1_NOW = new Date(2027, 0, 1, 12);
    const p = periods(X3, DEC28, [], EPOCH, new Date(2027, 0, 2), JAN1_NOW);
    expect(p).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `periods` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/habit-stats.ts`:

```ts
/* ------------------------------------------------------------------ */
/* Period generation (spec §2.2)                                       */
/* ------------------------------------------------------------------ */

export type Period = {
  start: Date;     // inclusive, local midnight
  end: Date;       // exclusive, local midnight
  target: number;
  actual: number;  // distinct days logged within [start, end)
  closed: boolean; // end <= now
};

export type HabitLog = { loggedAt: Date };

/**
 * Oldest-first list of periods.
 *
 * `to` is the exclusive end of the range of interest and callers ALWAYS
 * pass tomorrow's local midnight — that is what makes today's daily
 * period whole and "the current period" well defined everywhere.
 *
 * `now` is injected so tests are deterministic.
 */
export function periods(
  schedule: NormalizedSchedule,
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

  // Window trimming never drops the creation period. `from` is an arbitrary
  // fetch boundary; the creation period is a fact about the habit.
  const emit = (start: Date, end: Date) =>
    start >= from || (start <= created && created < end);

  if (schedule.kind === "perWeek") {
    for (let ws = startOfWeek(created); ws < to; ws = addDays(ws, 7)) {
      const we = addDays(ws, 7);
      if (!emit(ws, we)) continue;

      // Pro-rate ONLY the period createdAt falls inside.
      let target = schedule.count;
      if (ws <= created && created < we) {
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

  // daily and days: one period per REQUIRED day. A non-required day yields
  // no period at all, which is what makes it neutral downstream.
  for (let d = startOfDay(created); d < to; d = addDays(d, 1)) {
    const required =
      schedule.kind === "daily" || schedule.days.includes(isoWeekday(d));
    if (!required) continue;

    const end = addDays(d, 1);
    if (!emit(d, end)) continue;

    out.push({
      start: d,
      end,
      target: 1, // never pro-rated: a habit made at 15:00 can still be logged tonight
      actual: loggedDays.has(d.getTime()) ? 1 : 0,
      closed: end <= now,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS, all `periods` describes green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/habit-stats.ts src/lib/habit-stats.test.ts
git commit -m "feat: add period generator with creation pro-rating"
```

---

### Task 6: `periodScore` and the four statistics

**Files:**
- Modify: `src/lib/habit-stats.ts`
- Modify: `src/lib/habit-stats.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { computeStats } from "./habit-stats";

const MON17 = new Date(2026, 7, 17);
const THU20_NOON = new Date(2026, 7, 20, 12);
const NEXT_MIDNIGHT = new Date(2026, 7, 21);
const EPOCH = new Date(0);
const logsOn = (...ds: Date[]) => ds.map((d) => ({ loggedAt: d }));

const daily = { kind: "daily" as const };
const stats = (sched: any, created: Date, logs: any[], now: Date, to: Date,
               polarity: "build" | "break" = "build") =>
  computeStats(sched, polarity, created, logs, EPOCH, to, now);

describe("computeStats — the empty-set guard", () => {
  it("returns 0, never NaN, for a habit created today", () => {
    // The list is NOT empty — trimming rule 3 emits today's open period —
    // but rate30d filters to CLOSED periods and finds none.
    const s = stats(daily, new Date(2026, 7, 20), [], THU20_NOON, NEXT_MIDNIGHT);
    expect(s.rate30d).toBe(0);
    expect(Number.isNaN(s.rate30d)).toBe(false);
    expect(s.strength).toBe(0);
    expect(s.currentStreak).toBe(0);
    expect(s.bestStreak).toBe(0);
  });

  it("returns 0 for a per-week habit created mid-week, whose week has not closed", () => {
    const s = stats({ kind: "perWeek", count: 3 }, new Date(2026, 7, 19), [],
                    THU20_NOON, NEXT_MIDNIGHT);
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
    // Same logs, but now it is Friday — Thursday closed unlogged.
    const FRI21_NOON = new Date(2026, 7, 21, 12);
    const s = stats(daily, MON17,
      logsOn(new Date(2026, 7, 17, 12), new Date(2026, 7, 18, 12), new Date(2026, 7, 19, 12)),
      FRI21_NOON, new Date(2026, 7, 22));
    expect(s.currentStreak).toBe(0);
  });
});

describe("computeStats — currentStreak, break", () => {
  it("never credits the open period", () => {
    // A break habit satisfies 0 <= 0 at 00:00. Crediting it would award a
    // streak before it was earned, then decrement on logging.
    const s = stats(daily, MON17, [], THU20_NOON, NEXT_MIDNIGHT, "break");
    expect(s.currentStreak).toBe(3); // Mon, Tue, Wed closed and clean — NOT 4
  });

  it("breaks when the habit was logged", () => {
    const s = stats(daily, MON17, logsOn(new Date(2026, 7, 18, 12)),
                    THU20_NOON, NEXT_MIDNIGHT, "break");
    expect(s.currentStreak).toBe(1); // only Wednesday
  });
});

describe("computeStats — per-week streaks count weeks", () => {
  it("counts three consecutive met weeks as 3", () => {
    const X3 = { kind: "perWeek" as const, count: 3 };
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
    const X3 = { kind: "perWeek" as const, count: 3 };
    const created = new Date(2026, 7, 3);
    const logs = logsOn(
      new Date(2026, 7, 3, 12), new Date(2026, 7, 4, 12), new Date(2026, 7, 5, 12),
      new Date(2026, 7, 10, 12), new Date(2026, 7, 11, 12), new Date(2026, 7, 12, 12),
      new Date(2026, 7, 17, 12), // this week: 1 of 3, still open
    );
    const s = stats(X3, created, logs, THU20_NOON, NEXT_MIDNIGHT);
    expect(s.currentStreak).toBe(2);
  });
});

describe("computeStats — rate30d denominators", () => {
  it("a perfect daily week reads 100%", () => {
    const s = stats(daily, MON17,
      logsOn(new Date(2026, 7, 17, 12), new Date(2026, 7, 18, 12), new Date(2026, 7, 19, 12)),
      THU20_NOON, NEXT_MIDNIGHT);
    expect(s.rate30d).toBe(100); // 3 of 3 closed days
  });

  it("gives partial credit for a 2-of-3 week", () => {
    const X3 = { kind: "perWeek" as const, count: 3 };
    const created = new Date(2026, 7, 10); // Mon
    const logs = logsOn(new Date(2026, 7, 10, 12), new Date(2026, 7, 11, 12));
    const s = stats(X3, created, logs, THU20_NOON, NEXT_MIDNIGHT);
    expect(s.rate30d).toBeCloseTo(66.7, 0); // one closed week, 2/3
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

describe("computeStats — bestStreak", () => {
  it("finds the longest run, not the current one", () => {
    const created = new Date(2026, 7, 10);
    const logs = logsOn(
      new Date(2026, 7, 10, 12), new Date(2026, 7, 11, 12), new Date(2026, 7, 12, 12),
      new Date(2026, 7, 13, 12), // 4-day run, then a gap on the 14th
      new Date(2026, 7, 17, 12), new Date(2026, 7, 18, 12),
    );
    const s = stats(daily, created, logs, THU20_NOON, NEXT_MIDNIGHT);
    expect(s.bestStreak).toBe(4);
  });
});

describe("computeStats — unit", () => {
  it("is day for daily and specific days, week for per-week", () => {
    expect(stats(daily, MON17, [], THU20_NOON, NEXT_MIDNIGHT).unit).toBe("day");
    expect(stats({ kind: "days", days: [1, 3, 5] }, MON17, [], THU20_NOON, NEXT_MIDNIGHT).unit).toBe("day");
    expect(stats({ kind: "perWeek", count: 3 }, MON17, [], THU20_NOON, NEXT_MIDNIGHT).unit).toBe("week");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — `computeStats` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/habit-stats.ts`:

```ts
/* ------------------------------------------------------------------ */
/* Scoring and statistics (spec §2.3, §2.4)                            */
/* ------------------------------------------------------------------ */

export type Polarity = "build" | "break";

/**
 * One function for both polarities, so nothing ever divides by a target
 * that may legitimately be zero.
 */
export function periodScore(p: Period, polarity: Polarity): number {
  if (polarity === "break") {
    // target is a CEILING: 0 for daily/days, `count` as an allowance for perWeek.
    return p.actual <= p.target ? 1 : 0;
  }
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
  const ps = periods(schedule, createdAt, logs, from, to, now);
  const unit = schedule.kind === "perWeek" ? "week" : "day";

  const last = ps.length ? ps[ps.length - 1] : null;
  const current = last && !last.closed ? last : null;

  /* --- currentStreak: walk backwards over PERIODS ------------------ */
  let currentStreak = 0;
  let i = ps.length - 1;

  if (i >= 0 && !ps[i].closed) {
    // The open period. For build it counts only if already met; for break it
    // is ALWAYS skipped, since `0 <= 0` is trivially true from 00:00.
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
    if (p.closed && meetsTarget(p, polarity)) {
      run++;
      if (run > bestStreak) bestStreak = run;
    } else if (p.closed) {
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
  // rate30d is a scoreboard and must not be dragged down mid-period;
  // strength is a live trajectory and should decay and recover.
  let num = 0;
  let den = 0;
  for (let k = 0; k < ps.length; k++) {
    const age = ps.length - 1 - k;
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/habit-stats.ts src/lib/habit-stats.test.ts
git commit -m "feat: add period scoring and the four habit statistics"
```

---

### Task 7: The three predicates

`isRequiredOn`, `canBackfill` and `dotState` answer different questions and must not be conflated — an earlier revision of the spec used one function for all three and produced contradictions in both directions (spec §2.5).

**Files:**
- Modify: `src/lib/habit-stats.ts`
- Modify: `src/lib/habit-stats.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { isRequiredOn, canBackfill, dotState } from "./habit-stats";

const MON17 = new Date(2026, 7, 17);
const TUE18 = new Date(2026, 7, 18);
const THU20 = new Date(2026, 7, 20);
const FRI21 = new Date(2026, 7, 21);
const MWF = { kind: "days" as const, days: [1, 3, 5] };
const DAILY = { kind: "daily" as const };
const X3 = { kind: "perWeek" as const, count: 3 };

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
    expect(canBackfill(DAILY, FRI21, THU20)).toBe(false);
  });

  it("is true for a past-or-today date on daily", () => {
    expect(canBackfill(DAILY, MON17, THU20)).toBe(true);
    expect(canBackfill(DAILY, THU20, THU20)).toBe(true);
  });

  it("is TRUE for a per-week habit's unlogged past day", () => {
    // Rev-2 of the spec made this false and so made per-week backfill
    // impossible — the schedule where it matters most.
    expect(canBackfill(X3, TUE18, THU20)).toBe(true);
  });

  it("is false on an unlisted weekday of a days schedule", () => {
    // A log there is invisible to every statistic yet would render as done.
    expect(canBackfill(MWF, TUE18, THU20)).toBe(false);
    expect(canBackfill(MWF, MON17, THU20)).toBe(true);
  });
});

describe("dotState", () => {
  it("future beats everything", () => {
    expect(dotState(DAILY, "build", FRI21, THU20, false)).toBe("future");
  });

  it("logged is done for build and broke for break", () => {
    expect(dotState(DAILY, "build", MON17, THU20, true)).toBe("done");
    expect(dotState(DAILY, "break", MON17, THU20, true)).toBe("broke");
  });

  it("a break habit's clean past day is clean, NOT missed", () => {
    // Rev 2 had no break branch on the final rule, so thirty successful
    // days of abstention painted thirty red dots.
    expect(dotState(DAILY, "break", MON17, THU20, false)).toBe("clean");
  });

  it("a build habit's unlogged required past day is missed", () => {
    expect(dotState(DAILY, "build", MON17, THU20, false)).toBe("missed");
  });

  it("today unlogged is pending, not missed", () => {
    expect(dotState(DAILY, "build", THU20, THU20, false)).toBe("pending");
  });

  it("a per-week unlogged day is idle — never red", () => {
    expect(dotState(X3, "build", MON17, THU20, false)).toBe("idle");
  });

  it("an off-day on a days schedule is not-required", () => {
    expect(dotState(MWF, "build", TUE18, THU20, false)).toBe("not-required");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — the three functions are not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/habit-stats.ts`:

```ts
/* ------------------------------------------------------------------ */
/* Three predicates — three different questions (spec §2.5)            */
/* ------------------------------------------------------------------ */

/**
 * (a) Today page filter ONLY. Takes raw jsonb because today_agenda supplies
 *     item_details.schedule, not a habits row.
 *
 * Known limitation (spec §8): true every day for perWeek, so a 3x/week habit
 * already completed three times stays on Today for the rest of the week.
 * today_agenda does not carry the week's logs, so it cannot know otherwise.
 */
export function isRequiredOn(rawSchedule: unknown, date: Date): boolean {
  const s = normalizeSchedule(rawSchedule);
  if (s.kind === "days") return s.days.includes(isoWeekday(date));
  return true;
}

/** (b) Can this heatmap cell be clicked to log or clear that date? */
export function canBackfill(
  schedule: NormalizedSchedule,
  date: Date,
  today: Date,
): boolean {
  if (startOfDay(date) > startOfDay(today)) return false;
  // An off-day log is invisible to every statistic (periods() emits nothing
  // for it) yet would render as done — a cell that lies about its own effect.
  if (schedule.kind === "days") return schedule.days.includes(isoWeekday(date));
  return true;
}

export type DotState =
  | "future" | "done" | "broke" | "idle"
  | "not-required" | "pending" | "missed" | "clean";

/** (c) How is this dot or heatmap cell painted? Ordered rules, first match wins. */
export function dotState(
  schedule: NormalizedSchedule,
  polarity: Polarity,
  date: Date,
  today: Date,
  logged: boolean,
): DotState {
  const d = startOfDay(date);
  const t = startOfDay(today);

  if (d > t) return "future";                                    // 1
  if (logged) return polarity === "build" ? "done" : "broke";    // 2
  if (schedule.kind === "perWeek") return "idle";                // 3
  if (schedule.kind === "days" && !schedule.days.includes(isoWeekday(d)))
    return "not-required";                                       // 4
  if (d.getTime() === t.getTime()) return "pending";             // 5
  return polarity === "build" ? "missed" : "clean";              // 6
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS. Full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/habit-stats.ts src/lib/habit-stats.test.ts
git commit -m "feat: add isRequiredOn, canBackfill and dotState predicates"
```

---
## Chunk 2: Services, hooks and shared-component changes

No automated tests in this chunk — it is all Supabase I/O and shared UI, and component tests are out of scope (spec §9.2). Verification is by running the app and by the §10 checklist in Chunk 4.

### Task 8: Fix and extend `src/services/habits.ts`

Both existing functions are dead code: they target a non-existent `logged_date` column (the real column is `logged_at timestamptz`), and `logHabit` omits `user_id` so the insert would fail RLS regardless.

**Files:**
- Modify: `src/services/habits.ts` (full rewrite — the file is 28 lines)

- [ ] **Step 1: Rewrite the file**

```ts
import { createClient } from "@/lib/supabase-client";
import type { Database } from "@/lib/types";

type Habit = Database["public"]["Tables"]["habits"]["Row"];
type HabitInsert = Database["public"]["Tables"]["habits"]["Insert"];
type HabitUpdate = Database["public"]["Tables"]["habits"]["Update"];
type HabitLogRow = Database["public"]["Tables"]["habit_logs"]["Row"];

/**
 * Anchor a log at 12:00 LOCAL on the target date.
 *
 * habit_stats and today_agenda both bucket by
 * (logged_at at time zone 'UTC')::date. Anchoring at noon keeps that SQL
 * bucketing in agreement with habit-stats.ts, which buckets by local date.
 * A log written at 00:30 local would otherwise land on the previous UTC day.
 */
function noonOn(date?: string | Date): string {
  const d = date ? new Date(date) : new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0).toISOString();
}

function dayBounds(date?: string | Date): { start: string; end: string } {
  const d = date ? new Date(date) : new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function getHabits(opts?: {
  includeInactive?: boolean;
}): Promise<Habit[]> {
  const supabase = createClient();
  let query = supabase
    .from("habits")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: true });

  if (!opts?.includeInactive) query = query.eq("active", true);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getHabit(id: string): Promise<Habit> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("habits")
    .select("*")
    .eq("id", id)
    .is("archived_at", null)
    .single();
  if (error) throw error;
  return data;
}

export async function createHabit(data: HabitInsert): Promise<Habit> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: created, error } = await supabase
    .from("habits")
    .insert({ ...data, user_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return created;
}

export async function updateHabit(id: string, data: HabitUpdate): Promise<Habit> {
  const supabase = createClient();
  const { data: updated, error } = await supabase
    .from("habits")
    .update(data)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return updated;
}

/** Soft delete, matching archiveProject. */
export async function archiveHabit(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("habits")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** All habits, date range. Feeds the row dots, streaks and summary strip. */
export async function getHabitLogs(from: Date, to: Date): Promise<HabitLogRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("habit_logs")
    .select("*")
    .is("archived_at", null)
    .gte("logged_at", from.toISOString())
    .lt("logged_at", to.toISOString())
    .order("logged_at", { ascending: true });
  if (error) throw error;
  return data;
}

/** One habit, unbounded. Feeds the flyout's all-time best streak and heatmap paging. */
export async function getHabitLogsFor(habitId: string): Promise<HabitLogRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("habit_logs")
    .select("*")
    .eq("habit_id", habitId)
    .is("archived_at", null)
    .order("logged_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function logHabit(habitId: string, date?: string | Date): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase.from("habit_logs").insert({
    habit_id: habitId,
    user_id: user.id,
    logged_at: noonOn(date),
    value: 1,
  });
  if (error) throw error;
}

/**
 * Hard delete, deliberately — unlogging is a CORRECTION, not an event.
 * The user is saying the log should never have existed, so there is no
 * history worth preserving. (archiveHabit soft-deletes; this does not.)
 *
 * Deletes by day RANGE. `.eq("logged_at", date)` can never match a timestamp,
 * which is one of the two bugs in the original implementation.
 */
export async function unlogHabit(habitId: string, date?: string | Date): Promise<void> {
  const supabase = createClient();
  const { start, end } = dayBounds(date);
  const { error } = await supabase
    .from("habit_logs")
    .delete()
    .eq("habit_id", habitId)
    .gte("logged_at", start)
    .lt("logged_at", end);
  if (error) throw error;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from `src/services/habits.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/services/habits.ts
git commit -m "fix: repair logHabit/unlogHabit and add the habits service surface

Both functions targeted a non-existent logged_date column and logHabit
omitted user_id, so neither could ever have worked. Logs are now anchored
at noon local so the SQL views' UTC bucketing agrees with habit-stats.ts,
and unlog deletes by day range rather than timestamp equality."
```

---

### Task 9: `src/hooks/use-habits.ts`

**Files:**
- Modify: `src/hooks/use-habits.ts` (full rewrite — the file is 24 lines)

- [ ] **Step 1: Rewrite the file**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getHabits, getHabit, createHabit, updateHabit, archiveHabit,
  getHabitLogs, getHabitLogsFor, logHabit, unlogHabit,
} from "@/services/habits";
import { toast } from "@/components/app/Toast";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function useHabits(includeInactive = false) {
  return useQuery({
    queryKey: ["habits", includeInactive],
    queryFn: () => getHabits({ includeInactive }),
  });
}

export function useHabit(id: string | null) {
  return useQuery({
    queryKey: ["habits", id],
    queryFn: () => getHabit(id!),
    enabled: !!id,
  });
}

/** Stats window: today-anchored, 365 days. Key members are ISO STRINGS —
 *  a Date is a new object identity every render and would churn the cache. */
export function useHabitLogs(from: Date, to: Date) {
  return useQuery({
    queryKey: ["habit-logs", iso(from), iso(to)],
    queryFn: () => getHabitLogs(from, to),
  });
}

/** Flyout window: unbounded, one habit. */
export function useHabitLogsFor(habitId: string | null) {
  return useQuery({
    queryKey: ["habit-logs", habitId],
    queryFn: () => getHabitLogsFor(habitId!),
    enabled: !!habitId,
  });
}

function useInvalidateHabits() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["habits"] });
    qc.invalidateQueries({ queryKey: ["habit-logs"] });
    qc.invalidateQueries({ queryKey: ["today"] });
  };
}

export function useCreateHabit() {
  const invalidate = useInvalidateHabits();
  return useMutation({ mutationFn: createHabit, onSuccess: invalidate });
}

export function useUpdateHabit() {
  const invalidate = useInvalidateHabits();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => updateHabit(id, data),
    onSuccess: invalidate,
  });
}

export function useArchiveHabit() {
  const invalidate = useInvalidateHabits();
  return useMutation({ mutationFn: archiveHabit, onSuccess: invalidate });
}

/* ------------------------------------------------------------------ */
/* Optimistic log / unlog                                              */
/* ------------------------------------------------------------------ */

type ToggleArgs = { habitId: string; date?: Date };

/**
 * TWO caches, not one. useHabitLogs caches a flat array of all habits' logs
 * under ["habit-logs", fromISO, toISO]; useHabitLogsFor caches one habit's
 * logs under ["habit-logs", habitId]. A prefix cancel matches both, but the
 * optimistic write and the restore must handle both shapes — otherwise
 * toggling the circle with the flyout open leaves the heatmap stale.
 */
function useOptimisticToggle(
  mutationFn: (a: ToggleArgs) => Promise<void>,
  mode: "log" | "unlog",
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ habitId, date }: ToggleArgs) => mutationFn({ habitId, date }),

    onMutate: async ({ habitId, date }) => {
      await qc.cancelQueries({ queryKey: ["habit-logs"] });
      const snapshots = qc.getQueriesData({ queryKey: ["habit-logs"] });

      const target = date ?? new Date();
      const dayStart = new Date(target.getFullYear(), target.getMonth(), target.getDate());
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      const optimistic = {
        id: `optimistic-${habitId}-${dayStart.getTime()}`,
        habit_id: habitId,
        logged_at: new Date(dayStart.getTime() + 12 * 3_600_000).toISOString(),
        value: 1,
        archived_at: null,
      };

      for (const [key, data] of snapshots) {
        if (!Array.isArray(data)) continue;
        const next =
          mode === "log"
            ? [...data, optimistic]
            : data.filter((l: any) => {
                if (l.habit_id !== habitId) return true;
                const t = new Date(l.logged_at);
                return !(t >= dayStart && t < dayEnd);
              });
        qc.setQueryData(key, next);
      }

      return { snapshots };
    },

    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
      toast(mode === "log" ? "Could not log habit" : "Could not remove log", "error");
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["habits"] });
      qc.invalidateQueries({ queryKey: ["habit-logs"] });
      qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

export function useLogHabit() {
  return useOptimisticToggle(({ habitId, date }) => logHabit(habitId, date), "log");
}

export function useUnlogHabit() {
  return useOptimisticToggle(({ habitId, date }) => unlogHabit(habitId, date), "unlog");
}
```

- [ ] **Step 2: Check existing callers still compile**

`useLogHabit` / `useUnlogHabit` are already used by the Today page. The mutate signature changes from `logHabit(id)` to `{ habitId, date? }`.

Run: `npx tsc --noEmit`
Expected: errors pointing at `src/app/(app)/page.tsx`. Fix each call site to pass `{ habitId }`.

- [ ] **Step 3: Typecheck clean**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-habits.ts "src/app/(app)/page.tsx"
git commit -m "feat: add habits hooks with two-cache optimistic log/unlog"
```

---

### Task 10: Polarity and metric pill types

`StatusPill`'s `type` union is `"status" | "area" | "priority"`, and `getPillColor` falls back to `var(--color-text-muted)` for unrecognised values. `'build'`, `'break'`, `'boolean'` and `'count'` appear in no map, so all four would render as identical grey pills.

**Files:**
- Modify: `src/lib/constants.ts`
- Modify: `src/components/app/StatusPill.tsx`

- [ ] **Step 1: Add the maps to `constants.ts`**

```ts
export const HABIT_POLARITIES = [
  { value: "build", label: "Build" },
  { value: "break", label: "Break" },
] as const;

export const HABIT_METRICS = [
  { value: "boolean", label: "Yes / no" },
  { value: "count", label: "Count" },
  { value: "duration", label: "Duration" },
] as const;

const POLARITY_COLORS: Record<string, string> = {
  build: "var(--color-accent-success)",
  break: "var(--color-accent-danger)",
};

const METRIC_COLORS: Record<string, string> = {
  boolean: "var(--color-accent-info)",
  count: "var(--color-accent-warning)",
  duration: "var(--color-accent-info)",
};
```

Extend `getPillColor` to accept the two new types and read these maps.

- [ ] **Step 2: Widen the `StatusPill` union**

```ts
type Props = {
  value: string;
  type: "status" | "area" | "priority" | "polarity" | "metric";
};
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/constants.ts src/components/app/StatusPill.tsx
git commit -m "feat: add polarity and metric pill colours"
```

---

### Task 11: `children` prop on `FlyoutPanel`

`FlyoutPanel` takes `fields`, `data` and `stats` with no slot for arbitrary content, so there is nowhere to put the heatmap or strength bar. Three lines, and no existing caller is affected.

**Files:**
- Modify: `src/components/app/FlyoutPanel.tsx`

- [ ] **Step 1: Add the prop**

In the `Props` type:
```ts
  children?: React.ReactNode;
```

In the signature, destructure `children`, and render it after the field sections and before the closing panel div:
```tsx
        {children}
```

- [ ] **Step 2: Verify no caller broke**

Run: `npx tsc --noEmit`
Expected: clean. `children` is optional, so Projects, Tasks and Goals are untouched.

- [ ] **Step 3: Commit**

```bash
git add src/components/app/FlyoutPanel.tsx
git commit -m "feat: add children slot to FlyoutPanel

Lets Habits put a heatmap and strength meter below the field sections,
and gives GoalFlyout a route back onto the shared component later."
```

---

### Task 12: Habits nav entry

**Files:**
- Modify: `src/components/app/AppNav.tsx`

- [ ] **Step 1: Add the import and entry**

```ts
import { Home, FolderKanban, CheckSquare, Target, Repeat, MoreHorizontal } from "lucide-react";

const navItems = [
  { href: "/", label: "Today", icon: Home },
  { href: "/projects", label: "Projects", icon: FolderKanban },
  { href: "/tasks", label: "Tasks", icon: CheckSquare },
  { href: "/goals", label: "Goals", icon: Target },
  { href: "/habits", label: "Habits", icon: Repeat },
];
```

- [ ] **Step 2: Commit**

```bash
git add src/components/app/AppNav.tsx
git commit -m "feat: add Habits to the nav"
```

---

## Chunk 3: Habits page components

### Task 13: `HabitRow`

**Files:**
- Create: `src/components/app/HabitRow.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { Check } from "lucide-react";
import {
  dotState, startOfWeek, addDays, startOfDay,
  type DotState, type NormalizedSchedule, type HabitStats, type Polarity,
} from "@/lib/habit-stats";

const DOT_CLASS: Record<DotState, string> = {
  done:           "w-2.5 h-2.5 rounded-full bg-accent-success",
  clean:          "w-2.5 h-2.5 rounded-full bg-accent-success",
  missed:         "w-2.5 h-2.5 rounded-full bg-accent-danger",
  broke:          "w-2.5 h-2.5 rounded-full bg-accent-danger",
  pending:        "w-2.5 h-2.5 rounded-full border border-border-default",
  future:         "w-2.5 h-2.5 rounded-full border border-border-default",
  idle:           "w-1.5 h-1.5 rounded-full border border-border-default",
  "not-required": "w-1.5 h-1.5 rounded-full border border-border-default",
};

type Props = {
  habit: any;
  schedule: NormalizedSchedule;
  stats: HabitStats;
  loggedDays: Set<number>;   // startOfDay().getTime()
  scheduleLabel: string;     // "Daily" | "3x / week" | "Mon Wed Fri"
  today: Date;
  onToggleToday: () => void;
  onOpen: () => void;
};

export function HabitRow({
  habit, schedule, stats, loggedDays, scheduleLabel, today, onToggleToday, onOpen,
}: Props) {
  const polarity = habit.polarity as Polarity;
  const weekStart = startOfWeek(today);
  const loggedToday = loggedDays.has(startOfDay(today).getTime());
  const isPerWeek = schedule.kind === "perWeek";

  return (
    <div
      onClick={onOpen}
      className="flex items-center gap-3 px-4 py-3 bg-card rounded-md cursor-pointer hover:bg-elevated transition-colors"
    >
      {/* circle — the only hit target that does not open the flyout */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleToday(); }}
        disabled={!habit.active}
        aria-label={loggedToday ? `Remove today's log for ${habit.name}` : `Log ${habit.name} for today`}
        aria-pressed={loggedToday}
        className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
          loggedToday
            ? polarity === "build"
              ? "bg-accent-success text-page"
              : "bg-accent-danger text-page"
            : "border border-text-muted hover:border-accent-primary"
        } disabled:opacity-40 disabled:cursor-not-allowed`}
      >
        {loggedToday && <Check size={13} strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-text-primary truncate">{habit.name}</div>
        <div className="text-[11px] text-text-secondary truncate">
          {scheduleLabel}{habit.area ? ` · ${habit.area}` : ""}
        </div>
      </div>

      {/* week dots, Mon -> Sun */}
      <div className="hidden sm:flex items-center gap-1.5 shrink-0">
        {Array.from({ length: 7 }, (_, i) => {
          const day = addDays(weekStart, i);
          const state = dotState(schedule, polarity, day, today, loggedDays.has(day.getTime()));
          const isToday = startOfDay(day).getTime() === startOfDay(today).getTime();
          return (
            <span
              key={i}
              title={day.toDateString()}
              className={`inline-flex items-center justify-center ${isToday ? "ring-1 ring-accent-primary ring-offset-2 ring-offset-card rounded-full" : ""}`}
            >
              <span className={DOT_CLASS[state]} />
            </span>
          );
        })}
      </div>

      {/* streak slot — takes the unit of the habit's period */}
      <div className="shrink-0 text-right w-14">
        {isPerWeek && stats.current ? (
          <>
            <div className={`text-sm font-semibold tabular-nums ${
              stats.current.actual >= stats.current.target ? "text-accent-primary" : "text-text-primary"
            }`}>
              {stats.current.actual}/{stats.current.target}
            </div>
            <div className="text-[11px] text-text-secondary tabular-nums">
              {stats.currentStreak}w
            </div>
          </>
        ) : (
          <div className={`text-sm font-semibold tabular-nums ${
            stats.currentStreak > 0 ? "text-accent-primary" : "text-text-muted"
          }`}>
            {stats.currentStreak}d
          </div>
        )}
      </div>
    </div>
  );
}
```

**Note on the fraction:** the denominator is `stats.current.target`, never `schedule.count`. In the creation week those differ because `periods()` pro-rates — a 3x/week habit created Saturday shows `1/2` against a "3x / week" subtitle. That is correct: the denominator is what the user needs to hit *this* week; the subtitle is the ongoing rule.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/app/HabitRow.tsx
git commit -m "feat: add HabitRow with polarity-aware dots and streak slot"
```

---

### Task 14: `SchedulePicker`

Follows the existing `NotePopover` pattern: click the value, a popover opens, clicking outside saves.

**Files:**
- Create: `src/components/app/SchedulePicker.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState, useRef, useEffect } from "react";
import { normalizeSchedule, type NormalizedSchedule } from "@/lib/habit-stats";

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"]; // ISO order, Mon first

export function scheduleLabel(s: NormalizedSchedule): string {
  if (s.kind === "daily") return "Daily";
  if (s.kind === "perWeek") return `${s.count}x / week`;
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return s.days.map((d) => names[d - 1]).join(" ");
}

type Props = {
  value: unknown;                          // raw jsonb from the habits row
  onSave: (next: object) => Promise<void>;
};

export function SchedulePicker({ value, onSave }: Props) {
  const norm = normalizeSchedule(value);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<NormalizedSchedule["kind"]>(norm.kind);
  const [count, setCount] = useState(norm.kind === "perWeek" ? norm.count : 3);
  const [days, setDays] = useState<number[]>(norm.kind === "days" ? norm.days : [1, 3, 5]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        void commit();
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open, kind, count, days]);

  function serialise(): object {
    if (kind === "perWeek") return { type: "per_week", count };
    if (kind === "days") return { type: "daily", days: [...days].sort((a, b) => a - b) };
    return { type: "daily" };
  }

  async function commit() {
    const next = serialise();
    if (JSON.stringify(next) === JSON.stringify(value)) return;
    try {
      await onSave(next);
    } catch {
      setKind(norm.kind);
    }
  }

  function toggleDay(d: number) {
    setDays((prev) => {
      const next = prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d];
      return next.length === 0 ? prev : next;   // never allow an empty selection
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-medium text-text-primary hover:text-accent-primary"
      >
        {scheduleLabel(norm)}
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-60 p-3 bg-elevated border border-border-default rounded-md shadow-lg space-y-3">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as NormalizedSchedule["kind"])}
            className="w-full text-xs px-2 py-1.5 bg-card border border-border-default rounded-sm"
          >
            <option value="daily">Every day</option>
            <option value="perWeek">N times a week</option>
            <option value="days">Specific days</option>
          </select>

          {kind === "perWeek" && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <button onClick={() => setCount((c) => Math.max(2, c - 1))}
                        className="w-7 h-7 border border-border-default rounded-sm">-</button>
                <span className="flex-1 text-center text-sm tabular-nums">{count}x / week</span>
                <button onClick={() => setCount((c) => Math.min(6, c + 1))}
                        className="w-7 h-7 border border-border-default rounded-sm">+</button>
              </div>
              {/* 2-6 only. 1 normalises to daily in habit-stats, so offering it
                  would silently flip the habit to "Every day" on save. */}
              <p className="text-[11px] text-text-muted">
                Once a week? Use <em>Specific days</em> with one day.
              </p>
            </div>
          )}

          {kind === "days" && (
            <div className="flex gap-1">
              {DAY_LABELS.map((label, i) => {
                const d = i + 1;
                const on = days.includes(d);
                return (
                  <button
                    key={i}
                    onClick={() => toggleDay(d)}
                    aria-pressed={on}
                    className={`flex-1 h-8 text-[11px] rounded-sm border ${
                      on ? "bg-accent-primary text-page border-accent-primary"
                         : "border-border-default text-text-secondary"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/app/SchedulePicker.tsx
git commit -m "feat: add SchedulePicker for the schedule jsonb"
```

---

### Task 15: `HabitHeatmap`

Painted by `dotState`, enabled by `canBackfill` — two separate predicates.

**Files:**
- Create: `src/components/app/HabitHeatmap.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  dotState, canBackfill, startOfDay, isoWeekday,
  type DotState, type NormalizedSchedule, type Polarity,
} from "@/lib/habit-stats";

const CELL: Record<DotState, string> = {
  done:           "bg-accent-success",
  clean:          "bg-accent-success",
  missed:         "bg-accent-danger",
  broke:          "bg-accent-danger",
  pending:        "bg-card border border-border-default",
  future:         "bg-transparent",
  idle:           "bg-card border border-border-default",
  "not-required": "bg-transparent border border-border-default/40",
};

type Props = {
  schedule: NormalizedSchedule;
  polarity: Polarity;
  loggedDays: Set<number>;
  today: Date;
  onToggleDate: (date: Date) => void;
};

export function HabitHeatmap({ schedule, polarity, loggedDays, today, onToggleDate }: Props) {
  const [offset, setOffset] = useState(0); // months back from the current month

  const cursor = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = isoWeekday(new Date(year, month, 1)) - 1; // Mon-first grid

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <button onClick={() => setOffset((o) => o - 1)} aria-label="Previous month"
                className="p-1 text-text-secondary hover:text-text-primary">
          <ChevronLeft size={14} />
        </button>
        <span className="font-medium">
          {cursor.toLocaleString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button onClick={() => setOffset((o) => Math.min(0, o + 1))}
                disabled={offset >= 0} aria-label="Next month"
                className="p-1 text-text-secondary hover:text-text-primary disabled:opacity-30">
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
          <div key={i} className="text-[10px] text-text-muted text-center">{d}</div>
        ))}

        {Array.from({ length: leading }, (_, i) => <div key={`pad-${i}`} />)}

        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = new Date(year, month, i + 1);
          const logged = loggedDays.has(startOfDay(date).getTime());
          const state = dotState(schedule, polarity, date, today, logged);
          const clickable = canBackfill(schedule, date, today);
          const isToday = startOfDay(date).getTime() === startOfDay(today).getTime();

          return (
            <button
              key={i}
              onClick={() => clickable && onToggleDate(date)}
              disabled={!clickable}
              title={`${date.toDateString()}${clickable ? "" : " - not scheduled"}`}
              className={`aspect-square rounded-sm text-[9px] ${CELL[state]} ${
                isToday ? "outline outline-2 outline-accent-primary outline-offset-1" : ""
              } ${clickable ? "cursor-pointer hover:opacity-70" : "cursor-default"}`}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 text-[10px] text-text-secondary pt-1">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-accent-success inline-block" />
          {polarity === "build" ? "Done" : "Clean"}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-accent-danger inline-block" />
          {polarity === "build" ? "Missed" : "Broke"}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-card border border-border-default inline-block" />
          Not scheduled
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/app/HabitHeatmap.tsx
git commit -m "feat: add HabitHeatmap with backfill"
```

---
### Task 16: `HabitFlyout`

Wraps the shared `FlyoutPanel`, using the new `children` slot for everything below the metadata block.

**Files:**
- Create: `src/components/app/HabitFlyout.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { FlyoutPanel } from "./FlyoutPanel";
import { HabitHeatmap } from "./HabitHeatmap";
import { SchedulePicker, scheduleLabel } from "./SchedulePicker";
import { useHabitLogsFor } from "@/hooks/use-habits";
import {
  computeStats, normalizeSchedule, startOfDay, addDays,
  type Polarity,
} from "@/lib/habit-stats";
import { LIFE_AREAS, HABIT_POLARITIES, HABIT_METRICS } from "@/lib/constants";

type Props = {
  habit: any;
  linkedGoal: { id: string; title: string; area: string | null; horizon: string | null } | null;
  onSave: (field: string, value: any) => Promise<void>;
  onToggleDate: (date: Date) => void;
  onClose: () => void;
};

export function HabitFlyout({ habit, linkedGoal, onSave, onToggleDate, onClose }: Props) {
  // Unbounded, single-habit query: the flyout's "Best" is genuinely all-time.
  const { data: logs = [] } = useHabitLogsFor(habit.id);

  const today = new Date();
  const schedule = normalizeSchedule(habit.schedule);
  const polarity = habit.polarity as Polarity;

  const loggedDays = new Set(
    logs.map((l: any) => startOfDay(new Date(l.logged_at)).getTime()),
  );

  const stats = computeStats(
    schedule,
    polarity,
    new Date(habit.created_at),
    logs.map((l: any) => ({ loggedAt: new Date(l.logged_at) })),
    new Date(0),                                   // unbounded; the creation floor bounds it
    addDays(startOfDay(today), 1),                 // `to` is ALWAYS tomorrow's midnight
  );

  const unitSuffix = stats.unit === "week" ? "w" : "d";

  return (
    <FlyoutPanel
      title={habit.name}
      titleField="name"
      data={habit}
      onSave={onSave}
      onClose={onClose}
      fields={[
        { key: "polarity", label: "Polarity", type: "select", inline: true, row: 1,
          displayAs: "pill", pillType: "polarity" as any,
          options: HABIT_POLARITIES.map((p) => ({ value: p.value, label: p.label })) },
        { key: "metric_type", label: "Metric", type: "select", inline: true, row: 1,
          displayAs: "pill", pillType: "metric" as any,
          options: HABIT_METRICS.map((m) => ({ value: m.value, label: m.label })) },
        { key: "area", label: "Area", type: "select", inline: true, row: 1,
          displayAs: "pill", pillType: "area",
          options: LIFE_AREAS.map((a: any) => ({ value: a.value, label: a.label })) },
        { key: "active", label: "Active", type: "select", inline: true, row: 2,
          options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      ]}
      stats={[
        { label: "Current", value: `${stats.currentStreak}${unitSuffix}`, bold: true },
        { label: "Best", value: `${stats.bestStreak}${unitSuffix}` },
        { label: "30d rate", value: `${stats.rate30d}%` },
        { label: "Strength", value: `${stats.strength}%` },
      ]}
    >
      {/* --- schedule lives here: EditableCell cannot edit jsonb --- */}
      <div className="px-4 py-3 border-b border-border-default">
        <div className="text-[11px] uppercase tracking-wide text-text-secondary mb-1">
          Schedule
        </div>
        <SchedulePicker
          value={habit.schedule}
          onSave={(next) => onSave("schedule", next)}
        />
      </div>

      <div className="px-4 py-4 space-y-5">
        <section>
          <h3 className="text-xs font-semibold text-text-primary mb-2">History</h3>
          <HabitHeatmap
            schedule={schedule}
            polarity={polarity}
            loggedDays={loggedDays}
            today={today}
            onToggleDate={onToggleDate}
          />
        </section>

        <section>
          <h3 className="text-xs font-semibold text-text-primary mb-2">Habit strength</h3>
          <div className="h-2 rounded-full bg-card overflow-hidden">
            <div
              className="h-full rounded-full transition-[width]"
              style={{
                width: `${stats.strength}%`,
                background: "linear-gradient(90deg, var(--color-accent-warning), var(--color-accent-success))",
              }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-text-secondary mt-1">
            <span>{stats.strength}%</span>
            <span>100% = automatic</span>
          </div>
        </section>

        <section>
          <h3 className="text-xs font-semibold text-text-primary mb-2">Linked goal</h3>
          {linkedGoal ? (
            <a
              href={`/goals?goal=${linkedGoal.id}`}
              className="flex items-center gap-2 px-3 py-2 bg-card border border-border-default rounded-md"
            >
              <div>
                <div className="text-[13px] font-medium text-text-primary">{linkedGoal.title}</div>
                <div className="text-[11px] text-text-secondary">
                  {[linkedGoal.area, linkedGoal.horizon].filter(Boolean).join(" · ")}
                </div>
              </div>
            </a>
          ) : (
            <p className="text-[12px] text-text-muted">
              Not linked. Link this habit from a goal&rsquo;s key results.
            </p>
          )}
        </section>
      </div>
    </FlyoutPanel>
  );
}
```

**Note:** `active` is rendered as a Yes/No `select` because `EditableCell` has no boolean type and `FlyoutPanel.onSave` is typed `(field, value: string)`. The page's `onSave` maps `"true"`/`"false"` back to a boolean. Because `getHabits()` filters on `active`, the page must also offer an **Active / All** filter (Task 17) or this becomes a one-way door.

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/components/app/HabitFlyout.tsx
git commit -m "feat: add HabitFlyout using the FlyoutPanel children slot"
```

---

### Task 17: The Habits page

**Files:**
- Create: `src/app/(app)/habits/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { AppNav } from "@/components/app/AppNav";
import { FilterBar } from "@/components/app/FilterBar";
import { QuickAdd } from "@/components/app/QuickAdd";
import { HabitRow } from "@/components/app/HabitRow";
import { HabitFlyout } from "@/components/app/HabitFlyout";
import { scheduleLabel } from "@/components/app/SchedulePicker";
import {
  useHabits, useHabitLogs, useCreateHabit, useUpdateHabit,
  useLogHabit, useUnlogHabit,
} from "@/hooks/use-habits";
import {
  computeStats, normalizeSchedule, startOfDay, addDays,
  type Polarity,
} from "@/lib/habit-stats";

const STATS_WINDOW_DAYS = 365;

export default function HabitsPage() {
  const [showInactive, setShowInactive] = useState(false);
  const [areaFilter, setAreaFilter] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const today = new Date();
  const to = addDays(startOfDay(today), 1);              // ALWAYS tomorrow's midnight
  const from = addDays(startOfDay(today), -STATS_WINDOW_DAYS);

  const { data: habits, isLoading, isError, refetch } = useHabits(showInactive);
  const { data: logs = [], isError: logsError } = useHabitLogs(from, to);

  const createHabit = useCreateHabit();
  const updateHabit = useUpdateHabit();
  const logHabit = useLogHabit();
  const unlogHabit = useUnlogHabit();

  /* --- per-habit logs and stats, computed once --- */
  const rows = useMemo(() => {
    if (!habits) return [];
    const byHabit = new Map<string, { loggedAt: Date }[]>();
    for (const l of logs as any[]) {
      const arr = byHabit.get(l.habit_id) ?? [];
      arr.push({ loggedAt: new Date(l.logged_at) });
      byHabit.set(l.habit_id, arr);
    }
    return habits
      .filter((h: any) => areaFilter.length === 0 || areaFilter.includes(h.area))
      .map((h: any) => {
        const hLogs = byHabit.get(h.id) ?? [];
        const schedule = normalizeSchedule(h.schedule);
        return {
          habit: h,
          schedule,
          loggedDays: new Set(hLogs.map((l) => startOfDay(l.loggedAt).getTime())),
          stats: computeStats(
            schedule, h.polarity as Polarity, new Date(h.created_at),
            hLogs, from, to,
          ),
        };
      });
  }, [habits, logs, areaFilter, from, to]);

  /* --- summary strip (spec §4.5) --- */
  const summary = useMemo(() => {
    if (rows.length === 0) return null;
    // "On track" and "At risk" count BUILD habits only. A break habit satisfies
    // actual <= target at 00:00, so including them would credit every one of
    // them at midnight — the premature-credit bug currentStreak refuses.
    const build = rows.filter((r) => r.habit.polarity === "build");
    const openBuild = build.filter((r) => r.stats.current);
    const met = openBuild.filter((r) => r.stats.current!.actual >= r.stats.current!.target);
    const atRisk = openBuild.filter(
      (r) => r.stats.currentStreak >= 3 && r.stats.current!.actual < r.stats.current!.target,
    );
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    return {
      hasBuild: build.length > 0,
      onTrack: `${met.length} / ${openBuild.length}`,
      atRisk: atRisk.length,
      rate: Math.round(mean(rows.map((r) => r.stats.rate30d))),
      strength: Math.round(mean(rows.map((r) => r.stats.strength))),
    };
  }, [rows]);

  async function handleSave(habitId: string, field: string, value: any) {
    const parsed = field === "active" ? value === "true" : value;
    await updateHabit.mutateAsync({ id: habitId, data: { [field]: parsed } });
  }

  function toggle(habitId: string, loggedDays: Set<number>, date: Date) {
    const key = startOfDay(date).getTime();
    if (loggedDays.has(key)) unlogHabit.mutate({ habitId, date });
    else logHabit.mutate({ habitId, date });
  }

  async function handleCreate(name: string) {
    const created = await createHabit.mutateAsync({
      name: name || "New habit",
      polarity: "build",
      metric_type: "boolean",
      schedule: { type: "daily" },
      active: true,
    } as any);
    setOpenId(created.id);
  }

  const openRow = rows.find((r) => r.habit.id === openId) ?? null;

  return (
    <>
      <AppNav />
      <main className="max-w-[1536px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-semibold text-text-primary">Habits</h1>
          <button
            onClick={() => handleCreate("")}
            className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-accent-primary text-page rounded-sm"
          >
            <Plus size={14} /> New habit
          </button>
        </div>

        <FilterBar>
          {/* area pills wired to setAreaFilter, plus: */}
          <button
            onClick={() => setShowInactive((s) => !s)}
            className={`text-xs px-2.5 py-1 rounded-full border ${
              showInactive
                ? "border-accent-primary text-accent-primary"
                : "border-border-default text-text-secondary"
            }`}
          >
            {showInactive ? "All" : "Active"}
          </button>
        </FilterBar>

        {/* summary strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-5">
          {[
            { label: "On track", caption: "build habits",
              value: summary?.hasBuild ? summary.onTrack : "—",
              sub: summary?.hasBuild ? undefined : "no build habits" },
            { label: "At risk", caption: "build habits",
              value: summary?.hasBuild ? String(summary.atRisk) : "—",
              sub: summary?.hasBuild ? undefined : "no build habits" },
            { label: "30-day rate", caption: "all habits",
              value: summary ? `${summary.rate}%` : "—" },
            { label: "Strength", caption: "all habits",
              value: summary ? `${summary.strength}%` : "—" },
          ].map((c) => (
            <div key={c.label} className="px-3 py-2.5 bg-card rounded-md">
              <div className="text-lg font-semibold tabular-nums text-text-primary">{c.value}</div>
              <div className="text-[11px] text-text-secondary">{c.label}</div>
              <div className="text-[10px] text-text-muted">{c.sub ?? c.caption}</div>
            </div>
          ))}
        </div>

        {/* list */}
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-14 bg-card rounded-md animate-pulse" />
            ))}
          </div>
        ) : isError || logsError ? (
          <div className="px-4 py-6 bg-card rounded-md text-sm text-text-secondary">
            Could not load habits.{" "}
            <button onClick={() => refetch()} className="text-accent-primary underline">
              Try again
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-text-secondary">
            No habits yet. Add one below to start tracking.
          </div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <HabitRow
                key={r.habit.id}
                habit={r.habit}
                schedule={r.schedule}
                stats={r.stats}
                loggedDays={r.loggedDays}
                scheduleLabel={scheduleLabel(r.schedule)}
                today={today}
                onToggleToday={() => toggle(r.habit.id, r.loggedDays, today)}
                onOpen={() => setOpenId(r.habit.id)}
              />
            ))}
          </div>
        )}

        <div className="mt-4">
          <QuickAdd placeholder="Add habit..." onAdd={handleCreate} />
        </div>
      </main>

      {openRow && (
        <HabitFlyout
          habit={openRow.habit}
          linkedGoal={null}
          onSave={(field, value) => handleSave(openRow.habit.id, field, value)}
          onToggleDate={(date) => toggle(openRow.habit.id, openRow.loggedDays, date)}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Run the app and check the page renders**

Run: `npm run dev`, open `http://localhost:3000/habits`
Expected: nav shows Habits; empty state or existing habits render; no console errors.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/habits/page.tsx"
git commit -m "feat: add the Habits page"
```

---

## Chunk 4: Integration and verification

### Task 18: Today page schedule filter

`today_agenda` emits **every** active habit (`002_views.sql:416, 433-435`) with the comment *"app/agent filters by schedule"* — a filter that has never been written. Invisible while every habit is daily; a visible bug the moment specific-day schedules are editable.

**Files:**
- Modify: `src/app/(app)/page.tsx`

- [ ] **Step 1: Filter the habit items**

The view already emits `item_details.schedule` (line 425), so no view change is needed.

```ts
import { isRequiredOn } from "@/lib/habit-stats";

// where habit items are derived from today_agenda:
const habitItems = (agenda ?? [])
  .filter((i: any) => i.item_type === "habit")
  .filter((i: any) => isRequiredOn(i.item_details?.schedule, new Date()));
```

**Known limitation (spec §8):** this is a no-op for per-week habits. `isRequiredOn` returns true every day for `perWeek` because any day may be used to hit the target, so a 3x/week habit already completed three times stays on Today for the rest of the week. Suppressing it would require Today to fetch the current week's logs, which `today_agenda` does not carry.

- [ ] **Step 2: Verify**

Create a Mon/Wed/Fri habit. On a Tuesday, confirm it is absent from Today. Change the system date if needed, or temporarily pass a fixed date to `isRequiredOn`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/page.tsx"
git commit -m "fix: filter Today's habits by schedule

today_agenda emits every active habit with a comment saying the app
filters by schedule. It never did. Harmless while all habits were daily;
a visible bug now that specific-day schedules are editable."
```

---

### Task 19: Habit ↔ goal linking

Linking already exists and already anticipates habits: `linkKRToEntity` (`src/services/links.ts:39-61`) writes `src_type: "key_result"`, `dst_type: "project" | "task" | "habit"` and **already accepts `'habit'`**. The Goals page already renders a **disabled** `+ Link habit` button (`goals/page.tsx:467-473`, "Coming soon").

**No migration and no trigger change.** Both 004/005 functions already filter `l.src_type = 'key_result'`, and habits are excluded by construction: 004 installs triggers only `after update of status on projects`/`on tasks` (habits have no `status` column), and 005 updates only `projects` where `dst_type = 'project'` and `tasks` where `dst_type = 'task'`.

**Files:**
- Modify: `src/app/(app)/goals/page.tsx`

- [ ] **Step 1: Fetch habits and their logs on the Goals page**

The page fetches neither today. Add:
```ts
const { data: habits } = useHabits();
const { data: habitLogs = [] } = useHabitLogs(
  addDays(startOfDay(new Date()), -365),
  addDays(startOfDay(new Date()), 1),
);
```

- [ ] **Step 2: Enable the button**

Replace the disabled stub at `goals/page.tsx:467-473`:
```tsx
<button
  onClick={() => setLinkSearch({ krId: kr.id, type: "habit", query: "" })}
  className="text-xs text-text-muted hover:text-accent-primary border border-border-default rounded px-2 py-1"
>
  + Link habit
</button>
```

- [ ] **Step 3: Widen `linkSearch.type` and `filteredSearchResults`**

`filteredSearchResults` (`goals/page.tsx:184-192`) currently sources only `projects` and `tasks`:
```ts
const items =
  linkSearch.type === "project"
    ? (projects ?? []).map((p: any) => ({ id: p.id, title: p.name ?? p.title }))
    : linkSearch.type === "habit"
    ? (habits ?? []).map((h: any) => ({ id: h.id, title: h.name }))
    : (tasks ?? []).map((t: any) => ({ id: t.id, title: t.title }));
```

- [ ] **Step 4: Add the habit branch to the KR renderer**

A habit is never *done* — it is ongoing. For a habit-backed KR (`goals/page.tsx:341-378`), hide the check circle and drive the progress bar from the habit's `rate30d`:

```tsx
const habitLink = krLinks.find((l: any) => l.dst_type === "habit");
if (habitLink) {
  const h = habits?.find((x: any) => x.id === habitLink.dst_id);
  const hLogs = habitLogs
    .filter((l: any) => l.habit_id === habitLink.dst_id)
    .map((l: any) => ({ loggedAt: new Date(l.logged_at) }));
  const s = h && computeStats(
    normalizeSchedule(h.schedule), h.polarity, new Date(h.created_at),
    hLogs, addDays(startOfDay(new Date()), -365), addDays(startOfDay(new Date()), 1),
  );
  // render the progress bar at s.rate30d%, and NO check circle
}
```

- [ ] **Step 5: Verify**

Link a habit to a KR from Goals. Confirm the KR shows a rate and no check circle. Mark the KR done and confirm the habit is unaffected.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/goals/page.tsx"
git commit -m "feat: enable habit linking on the Goals page

linkKRToEntity already accepted 'habit' and the button already existed
as a disabled stub. Habit-backed KRs show a 30-day rate rather than a
check circle, because a habit is never done."
```

---

### Task 20: Manual verification pass

`habit-stats.ts` is covered by unit tests; nothing else is (spec §9.2). This checklist is the only guard on the page-level behaviour, so run all of it before merging.

- [ ] Log and unlog today on a daily habit; the circle, last dot and streak all update and survive a refresh
- [ ] Kill the network and tap the circle; confirm rollback and the error `Toast`
- [ ] Open the flyout, then toggle the circle behind it; the heatmap and stats bar update too, not just the row (the two-cache path)
- [ ] Backfill a past day from the heatmap; the streak recomputes
- [ ] Click a non-required heatmap cell on a Mon/Wed/Fri habit; nothing happens
- [ ] Backfill a past day on a **3x/week** habit; the cell is clickable and the fraction updates
- [ ] Switch a habit to 3x/week; dots stop showing red, the slot shows `n/3`, the streak reads in weeks
- [ ] **Create a break habit and leave it unlogged for several days; those days render green, not red, and the streak grows only as each day closes**
- [ ] Log the break habit once; that day turns red and the streak resets
- [ ] Set a habit inactive; it disappears from Active and returns under All
- [ ] Link a habit to a KR from Goals; the KR shows a rate and no check circle
- [ ] Mark that KR done; the habit is unaffected
- [ ] A Mon/Wed/Fri habit is absent from Today on a Tuesday
- [ ] **Create a habit and check the summary strip immediately: the 30-day rate reads `0%`, never `NaN%`. Repeat with a 3x/week habit, which has no closed period for up to a week, and confirm it does not poison the average**
- [ ] "On track" counts a per-week habit that met its target earlier in the week
- [ ] With only break habits visible, "On track" and "At risk" read `—` with the "no build habits" caption
- [ ] With no habits, the empty state renders
- [ ] Break the Supabase URL; the error row and retry action appear rather than a blank page
- [ ] Fail a `SchedulePicker` save; the popover stays open with the previous value

- [ ] **Final checks**

```bash
npm test          # habit-stats suite green
npx tsc --noEmit  # clean
npm run lint      # clean
npm run build     # succeeds
```

- [ ] **Commit any fixes, then use superpowers:finishing-a-development-branch**

---

## Deferred, with reasons

Recorded so they are decisions rather than omissions:

| Item | Why |
|---|---|
| Component tests for the row, heatmap and optimistic path | Needs jsdom + React Testing Library, which the app has never had. Task 20 covers it manually. |
| Rewriting the `habit_stats` view | Left untouched for the MCP server. This page simply does not read it. |
| Today page `item_details.streak` bug | `page.tsx:113` reads a key `today_agenda` never emits, so habit streaks silently never render there. Pre-existing and unrelated. |
| Per-week suppression on Today | `today_agenda` does not carry the week's logs; a second query is out of scope. |
| Count and duration metric habits | `metric_type` is displayed but only `boolean` is wired. |
| Habit reordering | Habits order by `created_at`; no `sort_order` column. |
| Streaks beyond 365 days | Truncated by the list window. Same class of flaw as the SQL view's 90-day cap, at four times the span. |
