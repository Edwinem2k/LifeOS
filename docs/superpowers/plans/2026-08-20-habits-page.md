# Habits Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the LifeOS Habits page — one row per habit, one tap to log today, a week of history inline, and a flyout with streak statistics and a month heatmap — on top of a pure TypeScript statistics module that handles daily, specific-day and per-week schedules correctly.

**Architecture:** A pure, dependency-free module (`src/lib/habit-stats.ts`) owns every calculation, built on one abstraction: the schedule defines a *period*, and streaks count periods rather than days. Services and TanStack Query hooks mirror the existing `projects.ts` shape. Components are split by responsibility from the start rather than accumulating in the page file. Nothing reads the existing `habit_stats` SQL view.

**Tech Stack:** Next.js 16.3.1, React 19, Tailwind v4, TanStack Query, supabase-js, Lucide, Vitest (new).

**Spec:** `docs/superpowers/specs/2026-08-20-habits-page-design.md` (rev 6, approved)

---

## Implementation clarifications

Four things surfaced while writing and executing this code that the spec leaves ambiguous or gets wrong at the implementation level. All are resolved here.

**1. `periods()` needs `polarity`, because a break habit's target is a ceiling.**

Spec §2.3 says a break habit's target is a **ceiling — 0 for daily and specific-days**, `count` only for per-week. A first draft of this plan set `target: 1` for every daily period regardless of polarity, which makes `meetsTarget` evaluate `actual (0 or 1) <= 1` — always true. A daily break habit logged *every day* then reports a full streak and 100%. Break polarity is not merely inaccurate that way, it is inert.

This cannot be patched inside `periodScore`, because `Period` carries neither the polarity nor the schedule kind. `periods()` therefore takes `polarity` and sets the target correctly at source.

**2. Creation-period protection must be bounded by the window.**

Window trimming (§2.2(a)) drops periods starting before `from`; the creation period must survive that trim so §2.2(b) can pro-rate it. But an unqualified `start <= created && created < end` protects the creation period *however far* it predates `from` — a habit created in 2023 viewed through a 365-day window emits a phantom 2023 period disconnected from everything else. The clause is bounded with `end > from`, which is all the flyout's `from = createdAt` case needs.

**3. The generator's loop starts at `max(periodStart(created), periodStart(from))`.**

Without it the day loop runs from `createdAt` to today unconditionally — about 1300 iterations per habit per recompute on a list page that runs `computeStats` for every visible row. With the bounded `emit` above, starting later drops only periods that `emit` would reject anyway.

**4. Creation pro-rating is build-only.**

For a build habit, pro-rating the creation week *lowers* an unreachable goal — the point of §2.2(b). For a **break** habit the target is an allowance, so shrinking it makes the creation week **stricter** than the ongoing rule: a "at most 3 a week" habit created Saturday would be held to 2. That inverts the rationale, so break habits keep their full allowance in the creation week.

**5. `periods()` takes `now` as an injected parameter.**

`closed` is defined against `now` and every streak test depends on controlling it, so it is a parameter defaulting to `new Date()` rather than a hidden global read.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/habit-stats.ts` | **New.** Every calculation. Pure, no imports from the app. Date helpers, `normalizeSchedule`, `periods`, `periodScore`, the four statistics, and the three predicates. ~340 lines. |
| `src/lib/habit-stats.test.ts` | **New.** Unit tests. The only automated coverage in this work. |
| `src/lib/constants.ts` | **Modify.** Add `polarity` and `metric` pill colour maps and a shared `PillType`. |
| `src/services/habits.ts` | **Modify.** Currently two broken functions; becomes the full CRUD + logs surface. |
| `src/hooks/use-habits.ts` | **Modify.** Currently two hooks; becomes the full set with optimistic log/unlog. |
| `src/components/app/HabitRow.tsx` | **New.** One row: circle, name, subtitle, week dots, streak slot. |
| `src/components/app/SchedulePicker.tsx` | **New.** Popover editor for the `schedule` jsonb. |
| `src/components/app/HabitHeatmap.tsx` | **New.** Month grid with paging and backfill. |
| `src/components/app/HabitFlyout.tsx` | **New.** Flyout body: metadata, stats bar, heatmap, strength, linked goal. |
| `src/components/app/FlyoutPanel.tsx` | **Modify.** Add a `children` prop; widen `pillType`. |
| `src/components/app/EditableCell.tsx` | **Modify.** Widen `pillType`. |
| `src/components/app/StatusPill.tsx` | **Modify.** Widen the `type` union. |
| `src/components/app/AppNav.tsx` | **Modify.** One nav entry. |
| `src/app/(app)/habits/page.tsx` | **New.** Data fetching and page state only. |
| `src/app/(app)/page.tsx` | **Modify.** One call-site fix, plus the schedule filter (§8). |
| `src/app/(app)/goals/page.tsx` | **Modify.** Enable the "+ Link habit" stub, habit KR branch. |
| `supabase/migrations/006_habits_area.sql` | **New.** One column. |

---

## Chunk 0: Setup

### Task 1: Vitest setup

The web app has no test runner. `package.json` scripts are `dev`/`build`/`start`/`lint` and there are zero test files under `src/`. `mcp/` now has its own `package.json` and `vitest.config.ts` (merged from main on 21 Aug), but that is a **separate package** with its own config, deps and `tsconfig`, and the root `tsconfig.json` excludes `mcp` entirely. It is a useful reference, not something the root config can reuse — the root needs its own vitest install and config.

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

- [ ] **Step 3: Add the test scripts**

In `package.json`, add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Verify the runner is installed**

Run: `npx vitest --version`
Expected: a version string beginning `3.`.

Do **not** run `npm test` yet — vitest exits with code **1** when it finds no test files ("No test files found, exiting with code 1"), so it would report failure. Task 3's failing test is the runner's real proof of life.

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

This repo has no down-migration convention — 001 through 005 are all forward-only and applied by hand through the SQL editor. 006 follows that. To reverse it manually: `alter table habits drop column area;`

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

## Chunk 1: Statistics module - schedules and periods

Every task in this chunk is strict TDD. `habit-stats.ts` carries all the automated coverage in this work, so the tests are the deliverable as much as the code is.

**One shared fixture block, declared once.** Task 3 creates it at the top of the test file; Tasks 4-7 add `describe` blocks below and **reuse** these constants. Re-declaring them is a `SyntaxError` that stops the whole file parsing, not just one test.

### Task 3: Date helpers and the shared fixtures

All period boundaries are local-time (spec §2.6).

**Files:**
- Create: `src/lib/habit-stats.ts`
- Create: `src/lib/habit-stats.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import {
  startOfDay, addDays, isoWeekday, startOfWeek,
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./habit-stats`.

- [ ] **Step 3: Implement**

Create `src/lib/habit-stats.ts`:

```ts
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

- [ ] **Step 1: Add the failing tests**

Add `normalizeSchedule` to the existing import at the top of the test file, then append:

```ts
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

The core abstraction. Two separate concerns govern it: **window trimming** decides which periods exist, **creation pro-rating** decides the target of the period the habit was created in (spec §2.2). It also needs `polarity`, because a break habit's target is a ceiling rather than a goal (clarification 1).

**Files:**
- Modify: `src/lib/habit-stats.ts`
- Modify: `src/lib/habit-stats.test.ts`

- [ ] **Step 1: Add the failing tests**

Add `periods` to the existing import at the top of the test file, then append the blocks
below. Reuse the shared fixtures from Task 3 — do **not** redeclare them. (Forgetting the
import gives a `ReferenceError`, which looks deceptively like the expected red-test failure.)

```ts
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

  /**
   * Window trimming, with the creation period protected — but only while it
   * still overlaps the window. Unbounded protection emits a phantom period
   * years before everything else.
   */
  const emit = (start: Date, end: Date) =>
    start >= from || (start <= created && created < end && end > from);

  if (schedule.kind === "perWeek") {
    // Start at the later boundary. With the bounded `emit` above, anything
    // earlier would be rejected anyway, so this only avoids wasted iterations.
    const first = startOfWeek(created);
    const windowFirst = startOfWeek(from);
    let ws = windowFirst > first ? windowFirst : first;

    for (; ws < to; ws = addDays(ws, 7)) {
      const we = addDays(ws, 7);
      if (!emit(ws, we)) continue;

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
    if (!emit(d, end)) continue;

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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: PASS, all four `periods` describes green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/habit-stats.ts src/lib/habit-stats.test.ts
git commit -m "feat: add period generator with polarity-aware targets"
```

> **Amended during execution (21 Aug, commit `c3b5e20`).** Code review flagged that the
> `emit` closure — the file's subtlest logic, and the clause behind two of the defects this
> plan documents — was reachable only through full `periods()` calls and so had no direct
> test. It is now an exported module-level predicate, `overlapsWindow(start, end, from,
> created)`, with its own five-assertion `describe` block covering both failure modes it
> guards. `periods()` calls it at the same two sites; behaviour is unchanged and all 48
> prior tests passed untouched. The rename was part of the fix: `if (!emit(...)) continue;`
> scanned as "don't emit" rather than "failed a check".

---

## Chunk 2: Statistics module - scoring and predicates

Still strict TDD, still reusing the Task 3 fixture block. Tasks 6 and 7 turn the
period list into the four statistics the UI reads, and into the three predicates that
decide what is required, what is clickable and how each dot is painted.

### Task 6: `periodScore` and the four statistics

**Files:**
- Modify: `src/lib/habit-stats.ts`
- Modify: `src/lib/habit-stats.test.ts`

- [ ] **Step 1: Add the failing tests**

Add `computeStats` to the existing import, then append. Reuse the Task 3 fixtures — do
**not** redeclare them.

```ts
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

- [ ] **Step 1: Add the failing tests**

Add `isRequiredOn`, `canBackfill` and `dotState` to the existing import, then append.
Reuse the Task 3 fixtures — do **not** redeclare them.

```ts
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

- [ ] **Step 4: Run the full suite**

Run: `npm test`
Expected: PASS, every describe green.

- [ ] **Step 5: Typecheck for unused symbols**

Run: `npx tsc --noEmit`
Expected: clean. `habit-stats.ts` exports nothing it does not use elsewhere in the plan.

- [ ] **Step 6: Commit**

```bash
git add src/lib/habit-stats.ts src/lib/habit-stats.test.ts
git commit -m "feat: add isRequiredOn, canBackfill and dotState predicates"
```

---
## Chunk 3: Services, hooks and shared-component changes

No automated tests in this chunk — it is all Supabase I/O and shared UI, and component tests are out of scope (spec §9.2). Verification is by typecheck, by running the app, and by the §10 checklist in Task 20 (Chunk 5).

**Layout note that applies to every component task below:** `src/app/(app)/layout.tsx` already renders `<AppNav />`, the `<main className="max-w-[1536px] mx-auto px-4 sm:px-6 lg:px-8 py-6">` wrapper and `<Toast />`. No page under `(app)` renders any of them. The Habits page must not either.

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
    .from("habits").select("*").eq("id", id).is("archived_at", null).single();
  if (error) throw error;
  return data;
}

export async function createHabit(data: HabitInsert): Promise<Habit> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: created, error } = await supabase
    .from("habits").insert({ ...data, user_id: user.id }).select().single();
  if (error) throw error;
  return created;
}

export async function updateHabit(id: string, data: HabitUpdate): Promise<Habit> {
  const supabase = createClient();
  const { data: updated, error } = await supabase
    .from("habits").update(data).eq("id", id).select().single();
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
    .from("habit_logs").select("*").is("archived_at", null)
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
    .from("habit_logs").select("*").eq("habit_id", habitId)
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
    habit_id: habitId, user_id: user.id, logged_at: noonOn(date), value: 1,
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
    .from("habit_logs").delete().eq("habit_id", habitId)
    .gte("logged_at", start).lt("logged_at", end);
  if (error) throw error;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from `src/services/habits.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/services/habits.ts
git commit -m "fix: repair logHabit/unlogHabit and add the habits service surface"
```

---

### Task 9: `src/hooks/use-habits.ts`

**Files:**
- Modify: `src/hooks/use-habits.ts` (full rewrite — the file is 24 lines)
- Modify: `src/services/links.ts` (widen one select — Step 1a)
- Modify: `src/hooks/use-links.ts` (one invalidation in two mutations — Step 1b)
- Modify: `src/app/(app)/page.tsx` (one call site)

- [ ] **Step 1: Rewrite the hooks file**

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getHabits, getHabit, createHabit, updateHabit, archiveHabit,
  getHabitLogs, getHabitLogsFor, logHabit, unlogHabit,
} from "@/services/habits";
import { getGoalForEntity } from "@/services/links";
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

/** Spec §7.1 item 5 — powers the flyout's Linked goal block.
 *  Requires the widened select in Step 1a below. */
export function useGoalForHabit(habitId: string | null) {
  return useQuery({
    queryKey: ["goal-for-habit", habitId],
    queryFn: () => getGoalForEntity("habit", habitId!),
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
  fn: (a: ToggleArgs) => Promise<void>,
  mode: "log" | "unlog",
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: ToggleArgs) => fn(a),

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
        // A single-habit cache (["habit-logs", habitId]) belonging to a
        // DIFFERENT habit must not receive this log. Without the guard, a
        // previously-opened flyout's cache gains a foreign row, and
        // HabitFlyout does not re-filter by habit_id.
        if (key.length === 2 && key[1] !== habitId) continue;

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

- [ ] **Step 1a: Widen `getGoalForEntity`'s select**

`src/services/links.ts:113` currently does `.select("id, title")`. Spec §6 requires the
flyout's Linked goal block to show "Goal name, area **and horizon**", and both columns exist
(`001_core_tables.sql:138-139`) — without this the subtitle renders as an empty string and
nothing in Task 20 would catch it.

```ts
    .select("id, title, area, horizon")
```

Risk-free: `getGoalForEntity` has no other callers anywhere in `src/`.

- [ ] **Step 1b: Invalidate the new key when a link changes**

`useLinkKR` and `useUnlinkKR` (`src/hooks/use-links.ts:20-32`) invalidate `goals`,
`goal-progress`, `area-progress`, `links` and `key-results` — none of which touches
`["goal-for-habit"]`, so linking on the Goals page leaves an already-open habit flyout stale.
Add to both mutations' `onSuccess`:

```ts
      qc.invalidateQueries({ queryKey: ["goal-for-habit"] });
```

- [ ] **Step 2: Fix the one existing call site**

The mutate signature changes from a bare id to `{ habitId, date? }`. There is exactly one caller, at `src/app/(app)/page.tsx:101`.

Replace:
```tsx
onClick={() => logHabit.mutate(habit.item_id)}
```
with:
```tsx
onClick={() => logHabit.mutate({ habitId: habit.item_id })}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-habits.ts src/hooks/use-links.ts \
        src/services/links.ts "src/app/(app)/page.tsx"
git commit -m "feat: add habits hooks with two-cache optimistic log/unlog"
```

---

### Task 10: Polarity and metric pill types

`StatusPill`'s `type` union is `"status" | "area" | "priority"`, and `getPillColor` (`constants.ts:106-110`) falls through to `getStatusColor` for anything unrecognised, which returns `var(--color-text-muted)`. `'build'`, `'break'`, `'boolean'` and `'count'` appear in no map, so all four would render as identical grey pills.

The same narrow union is declared in **four** places — `StatusPill.tsx`, `EditableCell.tsx:15`, `FlyoutPanel.tsx:15` (both as `FieldConfig.pillType`) and `FilterBar.tsx:44`. They must widen together, or the flyout needs an `as any` cast.

**Files:**
- Modify: `src/lib/constants.ts`
- Modify: `src/components/app/StatusPill.tsx`
- Modify: `src/components/app/EditableCell.tsx`
- Modify: `src/components/app/FlyoutPanel.tsx`
- Modify: `src/components/app/FilterBar.tsx` (a fourth declaration of the same narrow union, at line 44)

- [ ] **Step 1: Add the option lists and colour maps to `constants.ts`**

Labels are chosen so `formatLabel(value)` reproduces them — `StatusPill` renders `formatLabel(value)` and ignores the option label, so a label of "Yes / no" against a value of `boolean` would display as "Boolean" anyway.

```ts
export const HABIT_POLARITIES = [
  { value: "build", label: "Build" },
  { value: "break", label: "Break" },
] as const;

export const HABIT_METRICS = [
  { value: "boolean", label: "Boolean" },
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

export function getPolarityColor(value: string): string {
  return POLARITY_COLORS[value] ?? "var(--color-text-muted)";
}

export function getMetricColor(value: string): string {
  return METRIC_COLORS[value] ?? "var(--color-text-muted)";
}
```

- [ ] **Step 2: Extend `getPillColor`**

Replace `constants.ts:106-110` entirely:

```ts
export type PillType = "status" | "area" | "priority" | "polarity" | "metric";

export function getPillColor(value: string, type: PillType): string {
  if (type === "area") return getAreaColor(value);
  if (type === "priority") return getPriorityColor(value);
  if (type === "polarity") return getPolarityColor(value);
  if (type === "metric") return getMetricColor(value);
  return getStatusColor(value);
}
```

- [ ] **Step 3: Widen the three consumers**

In `StatusPill.tsx`, `EditableCell.tsx:15`, `FlyoutPanel.tsx:15` and `FilterBar.tsx:44`, replace the inline union with the shared type:

```ts
import { type PillType } from "@/lib/constants";
// StatusPill Props:
type Props = { value: string; type: PillType };
// EditableCell + FlyoutPanel FieldConfig:
  pillType?: PillType;
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, and no `as any` cast is needed in Task 16.

- [ ] **Step 5: Commit**

```bash
git add src/lib/constants.ts src/components/app/StatusPill.tsx \
        src/components/app/EditableCell.tsx src/components/app/FlyoutPanel.tsx
git commit -m "feat: add polarity and metric pill types"
```

---

### Task 11: `children` prop on `FlyoutPanel`

`FlyoutPanel` takes `fields`, `data` and `stats` with no slot for arbitrary content, so there is nowhere to put the heatmap or strength bar.

**Files:**
- Modify: `src/components/app/FlyoutPanel.tsx`

- [ ] **Step 1: Add the prop**

In the `Props` type add `children?: React.ReactNode;`, destructure `children` in the signature, and render `{children}` after the field sections, immediately before the panel's closing `</div>`.

- [ ] **Step 2: Verify no caller broke**

Run: `npx tsc --noEmit`
Expected: clean. `children` is optional, so Projects, Tasks and Goals are untouched.

- [ ] **Step 3: Commit**

```bash
git add src/components/app/FlyoutPanel.tsx
git commit -m "feat: add children slot to FlyoutPanel"
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

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`, then `npm run dev` and confirm a **Habits** item appears between Goals and the More button, and that `/habits` highlights it as active once Task 17 exists.

- [ ] **Step 3: Commit**

```bash
git add src/components/app/AppNav.tsx
git commit -m "feat: add Habits to the nav"
```

---

## Chunk 4: Habits page components

### Task 13: `HabitRow`

**Files:**
- Create: `src/components/app/HabitRow.tsx`

- [ ] **Step 1: Write the component**

```tsx
"use client";

import { Check } from "lucide-react";
import { StatusPill } from "./StatusPill";
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
  const unitSuffix = stats.unit === "week" ? "w" : "d";
  const showFraction = stats.unit === "week" && stats.current !== null;

  return (
    <div
      onClick={onOpen}
      className={`flex items-center gap-3 px-4 py-3 bg-card rounded-md cursor-pointer hover:bg-elevated transition-colors ${
        habit.active ? "" : "opacity-50"
      }`}
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
        } disabled:cursor-not-allowed`}
      >
        {loggedToday && <Check size={13} strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-text-primary truncate">{habit.name}</div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {/* The polarity pill is what makes the circle unambiguous: on a break
              habit, filling it is a FAILURE. (Spec §5.2) */}
          <StatusPill value={habit.polarity} type="polarity" />
          <span className="text-[11px] text-text-secondary truncate">
            {scheduleLabel}{habit.area ? ` · ${habit.area}` : ""}
          </span>
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
              className={`inline-flex items-center justify-center ${
                isToday ? "ring-1 ring-accent-primary ring-offset-2 ring-offset-card rounded-full" : ""
              }`}
            >
              <span className={DOT_CLASS[state]} />
            </span>
          );
        })}
      </div>

      {/* streak slot — takes the unit of the habit's period */}
      <div className="shrink-0 text-right w-14">
        {showFraction ? (
          <>
            <div className={`text-sm font-semibold tabular-nums ${
              stats.current!.actual >= stats.current!.target
                ? "text-accent-primary" : "text-text-primary"
            }`}>
              {stats.current!.actual}/{stats.current!.target}
            </div>
            <div className="text-[11px] text-text-secondary tabular-nums">
              {stats.currentStreak}w
            </div>
          </>
        ) : (
          <div className={`text-sm font-semibold tabular-nums ${
            stats.currentStreak > 0 ? "text-accent-primary" : "text-text-muted"
          }`}>
            {stats.currentStreak}{unitSuffix}
          </div>
        )}
      </div>
    </div>
  );
}
```

Two details that are easy to get wrong:

**The suffix comes from `stats.unit`, not from whether a fraction is showing.** A per-week habit with no open period (possible at a window edge) falls to the single-line branch and must still read `3w`, not `3d`.

**The fraction's denominator is `stats.current.target`, never `schedule.count`.** In the creation week those differ because `periods()` pro-rates — a 3x/week habit created Saturday shows `1/2` against a "3x / week" subtitle. That is correct: the denominator is what the user needs to hit *this* week; the subtitle is the ongoing rule.

- [ ] **Step 2: Typecheck and commit**

```bash
npx tsc --noEmit
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
import { toast } from "@/components/app/Toast";
import { normalizeSchedule, type NormalizedSchedule } from "@/lib/habit-stats";

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"]; // ISO order, Mon first
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function scheduleLabel(s: NormalizedSchedule): string {
  if (s.kind === "daily") return "Daily";
  if (s.kind === "perWeek") return `${s.count}x / week`;
  return s.days.map((d) => DAY_NAMES[d - 1]).join(" ");
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

  // Re-sync when the habit prop changes underneath us — but NEVER while the
  // popover is open. TanStack refetches ["habits"] on window focus by default,
  // and habit.schedule is a new object identity each time, so without this
  // guard a background refetch wipes an edit in progress.
  useEffect(() => {
    if (open) return;
    const n = normalizeSchedule(value);
    setKind(n.kind);
    if (n.kind === "perWeek") setCount(n.count);
    if (n.kind === "days") setDays(n.days);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) void commit();
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open, kind, count, days]);

  function serialise(): object {
    if (kind === "perWeek") return { type: "per_week", count };
    if (kind === "days") return { type: "daily", days: [...days].sort((a, b) => a - b) };
    return { type: "daily" };
  }

  function resetToProp() {
    const n = normalizeSchedule(value);
    setKind(n.kind);
    setCount(n.kind === "perWeek" ? n.count : 3);
    setDays(n.kind === "days" ? n.days : [1, 3, 5]);
  }

  /**
   * The popover closes ONLY on success. Spec §12 requires that a failed save
   * leaves it open with the previous value restored — closing regardless
   * would silently discard the user's edit.
   */
  async function commit() {
    const next = serialise();
    if (JSON.stringify(next) === JSON.stringify(value)) {
      setOpen(false);
      return;
    }
    try {
      await onSave(next);
      setOpen(false);
    } catch {
      resetToProp();           // restore kind AND count AND days
      toast("Could not save schedule", "error");
      // stays open
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
                        aria-label="Fewer times per week"
                        className="w-7 h-7 border border-border-default rounded-sm">-</button>
                <span className="flex-1 text-center text-sm tabular-nums">{count}x / week</span>
                <button onClick={() => setCount((c) => Math.min(6, c + 1))}
                        aria-label="More times per week"
                        className="w-7 h-7 border border-border-default rounded-sm">+</button>
              </div>
              {/* 2-6 only. normalizeSchedule turns count:1 into daily, so offering
                  1 would silently flip the habit to "Every day" on save. */}
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
                    aria-label={DAY_NAMES[i]}
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
        {DAY_HEADER.map((d, i) => (
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
              className={`aspect-square rounded-sm ${CELL[state]} ${
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

const DAY_HEADER = ["M", "T", "W", "T", "F", "S", "S"];
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
import { SchedulePicker } from "./SchedulePicker";
import { useHabitLogsFor, useGoalForHabit } from "@/hooks/use-habits";
import {
  computeStats, normalizeSchedule, startOfDay, addDays, type Polarity,
} from "@/lib/habit-stats";
import { LIFE_AREAS, HABIT_POLARITIES, HABIT_METRICS } from "@/lib/constants";

type Props = {
  habit: any;
  today: Date;
  autoFocusTitle?: boolean;
  onSave: (field: string, value: any) => Promise<void>;
  onToggleDate: (date: Date) => void;
  onClose: () => void;
};

export function HabitFlyout({
  habit, today, autoFocusTitle = false, onSave, onToggleDate, onClose,
}: Props) {
  // Unbounded, single-habit query: the flyout's "Best" is genuinely all-time.
  const { data: logs = [] } = useHabitLogsFor(habit.id);
  const { data: linkedGoal } = useGoalForHabit(habit.id);

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
    new Date(0),                     // unbounded; the creation floor bounds it
    addDays(startOfDay(today), 1),   // `to` is ALWAYS tomorrow's midnight
  );

  const suffix = stats.unit === "week" ? "w" : "d";

  return (
    <FlyoutPanel
      title={habit.name}
      titleField="name"
      data={habit}
      onSave={onSave}
      onClose={onClose}
      autoFocusTitle={autoFocusTitle}
      fields={[
        { key: "polarity", label: "Polarity", type: "select", inline: true, row: 1,
          displayAs: "pill", pillType: "polarity",
          options: HABIT_POLARITIES.map((p) => ({ value: p.value, label: p.label })) },
        { key: "metric_type", label: "Metric", type: "select", inline: true, row: 1,
          displayAs: "pill", pillType: "metric",
          options: HABIT_METRICS.map((m) => ({ value: m.value, label: m.label })) },
        { key: "area", label: "Area", type: "select", inline: true, row: 1,
          displayAs: "pill", pillType: "area",
          options: LIFE_AREAS.map((a: any) => ({ value: a.value, label: a.label })) },
        { key: "active", label: "Active", type: "select", inline: true, row: 2,
          options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      ]}
      stats={[
        { label: "Current", value: `${stats.currentStreak}${suffix}`, bold: true },
        { label: "Best", value: `${stats.bestStreak}${suffix}` },
        { label: "30d rate", value: `${stats.rate30d}%` },
        { label: "Strength", value: `${stats.strength}%` },
      ]}
    >
      {/* Schedule lives here rather than in `fields`: EditableCell has no
          jsonb type, and its union is text|textarea|select|date|number. */}
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
                background:
                  "linear-gradient(90deg, var(--color-accent-warning), var(--color-accent-success))",
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
                <div className="text-[13px] font-medium text-text-primary">
                  {linkedGoal.title}
                </div>
                <div className="text-[11px] text-text-secondary">
                  {[linkedGoal.area, linkedGoal.horizon].filter(Boolean).join(" · ")}
                </div>
              </div>
            </a>
          ) : (
            <p className="text-[12px] text-text-muted">
              Not linked. Use <strong>+ Link habit</strong> on a goal to connect this.
            </p>
          )}
        </section>
      </div>
    </FlyoutPanel>
  );
}
```

Two notes:

**`active` is a Yes/No `select`** because `EditableCell` has no boolean type and `FlyoutPanel.onSave` is typed `(field, value: string)`. The page's `onSave` maps `"true"`/`"false"` back to a boolean. Because `getHabits()` filters on `active`, the page must also offer the **Active / All** filter (Task 17) or this is a one-way door.

**Linking is read-only here.** Spec §6 lists the block as "Link / unlink", but all linking originates from the Goals side (spec §7.1), so the flyout shows the link and points at where to create one. Unlinking from the habit side is deferred — see the table at the end.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean, with **no `as any`** on `pillType` — Task 10 widened `FieldConfig`.

- [ ] **Step 3: Commit**

```bash
git add src/components/app/HabitFlyout.tsx
git commit -m "feat: add HabitFlyout using the FlyoutPanel children slot"
```

---

### Task 17: The Habits page

**`src/app/(app)/layout.tsx` already renders `<AppNav />`, the `<main className="max-w-[1536px] mx-auto px-4 sm:px-6 lg:px-8 py-6">` wrapper and `<Toast />`.** No page under `(app)` renders any of them, and this one must not either — doing so produces two nav bars and a nested `<main>` with doubled padding.

**Files:**
- Create: `src/app/(app)/habits/page.tsx`

- [ ] **Step 1: Write the page**

```tsx
"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { FilterBar, FilterPill } from "@/components/app/FilterBar";
import { QuickAdd } from "@/components/app/QuickAdd";
import { HabitRow } from "@/components/app/HabitRow";
import { HabitFlyout } from "@/components/app/HabitFlyout";
import { scheduleLabel } from "@/components/app/SchedulePicker";
import { LIFE_AREAS } from "@/lib/constants";
import {
  useHabits, useHabitLogs, useCreateHabit, useUpdateHabit,
  useLogHabit, useUnlogHabit,
} from "@/hooks/use-habits";
import {
  computeStats, normalizeSchedule, startOfDay, addDays, type Polarity,
} from "@/lib/habit-stats";

const STATS_WINDOW_DAYS = 365;

export default function HabitsPage() {
  const [showInactive, setShowInactive] = useState(false);
  const [areaFilter, setAreaFilter] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [focusNewTitle, setFocusNewTitle] = useState(false);

  // Stable for the lifetime of the mount. A fresh `new Date()` every render
  // would make `from`/`to` new object identities and defeat every useMemo.
  const today = useMemo(() => startOfDay(new Date()), []);
  const to = useMemo(() => addDays(today, 1), [today]);          // tomorrow's midnight
  const from = useMemo(() => addDays(today, -STATS_WINDOW_DAYS), [today]);

  const habitsQuery = useHabits(showInactive);
  const logsQuery = useHabitLogs(from, to);
  const habits = habitsQuery.data;
  const logs = logsQuery.data ?? [];

  const createHabit = useCreateHabit();
  const updateHabit = useUpdateHabit();
  const logHabit = useLogHabit();
  const unlogHabit = useUnlogHabit();

  /* --- per-habit logs and stats, computed once --- */
  const allRows = useMemo(() => {
    if (!habits) return [];
    const byHabit = new Map<string, { loggedAt: Date }[]>();
    for (const l of logs as any[]) {
      const arr = byHabit.get(l.habit_id) ?? [];
      arr.push({ loggedAt: new Date(l.logged_at) });
      byHabit.set(l.habit_id, arr);
    }
    return habits.map((h: any) => {
      const hLogs = byHabit.get(h.id) ?? [];
      const schedule = normalizeSchedule(h.schedule);
      return {
        habit: h,
        schedule,
        loggedDays: new Set(hLogs.map((l) => startOfDay(l.loggedAt).getTime())),
        stats: computeStats(
          schedule, h.polarity as Polarity, new Date(h.created_at), hLogs, from, to,
        ),
      };
    });
  }, [habits, logs, from, to]);

  const rows = useMemo(
    () => (areaFilter.length === 0
      ? allRows
      : allRows.filter((r) => areaFilter.includes(r.habit.area))),
    [allRows, areaFilter],
  );

  /* --- summary strip (spec §4.5) --- */
  const summary = useMemo(() => {
    // "On track" and "At risk" count BUILD habits only. A break habit
    // satisfies its ceiling at 00:00, so including them would credit every
    // one at midnight — the premature-credit bug currentStreak refuses.
    const build = rows.filter((r) => r.habit.polarity === "build");
    const openBuild = build.filter((r) => r.stats.current);
    const met = openBuild.filter(
      (r) => r.stats.current!.actual >= r.stats.current!.target,
    );
    const atRisk = openBuild.filter(
      (r) => r.stats.currentStreak >= 3 && r.stats.current!.actual < r.stats.current!.target,
    );
    const mean = (xs: number[]) =>
      xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
    return {
      hasAny: rows.length > 0,
      hasBuild: build.length > 0,
      onTrack: `${met.length} / ${openBuild.length}`,
      atRisk: String(atRisk.length),
      rate: `${mean(rows.map((r) => r.stats.rate30d))}%`,
      strength: `${mean(rows.map((r) => r.stats.strength))}%`,
    };
  }, [rows]);

  async function handleSave(habitId: string, field: string, value: any) {
    const parsed = field === "active" ? value === "true" : value;
    await updateHabit.mutateAsync({ id: habitId, data: { [field]: parsed } });
  }

  function toggle(habitId: string, loggedDays: Set<number>, date: Date) {
    if (loggedDays.has(startOfDay(date).getTime())) unlogHabit.mutate({ habitId, date });
    else logHabit.mutate({ habitId, date });
  }

  async function handleCreate(name: string) {
    const created = await createHabit.mutateAsync({
      name: name.trim() || "New habit",
      polarity: "build",
      metric_type: "boolean",
      schedule: { type: "daily" },
      active: true,
    } as any);
    setFocusNewTitle(true);
    setOpenId(created.id);
  }

  const openRow = rows.find((r) => r.habit.id === openId) ?? null;
  const isLoading = habitsQuery.isLoading || logsQuery.isLoading;
  const isError = habitsQuery.isError || logsQuery.isError;

  const cards = [
    { label: "On track", caption: "build habits",
      value: summary.hasBuild ? summary.onTrack : "—",
      caveat: summary.hasBuild ? null : "no build habits" },
    { label: "At risk", caption: "build habits",
      value: summary.hasBuild ? summary.atRisk : "—",
      caveat: summary.hasBuild ? null : "no build habits" },
    { label: "30-day rate", caption: "all habits",
      value: summary.hasAny ? summary.rate : "—", caveat: null },
    { label: "Strength", caption: "all habits",
      value: summary.hasAny ? summary.strength : "—", caveat: null },
  ];

  return (
    <>
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
        <FilterPill
          label="Area"
          options={LIFE_AREAS.map((a: any) => ({ value: a.value, label: a.label }))}
          selected={areaFilter}
          onChange={setAreaFilter}
          pillType="area"
        />
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-5">
        {cards.map((c) => (
          <div key={c.label} className="px-3 py-2.5 bg-card rounded-md">
            <div className="text-lg font-semibold tabular-nums text-text-primary">{c.value}</div>
            <div className="text-[11px] text-text-secondary">{c.label}</div>
            <div className="text-[10px] text-text-muted">{c.caveat ?? c.caption}</div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 bg-card rounded-md animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <div className="px-4 py-6 bg-card rounded-md text-sm text-text-secondary">
          Could not load habits.{" "}
          <button
            onClick={() => { habitsQuery.refetch(); logsQuery.refetch(); }}
            className="text-accent-primary underline"
          >
            Try again
          </button>
        </div>
      ) : allRows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-text-secondary">
          No habits yet. Add one below to start tracking.
        </div>
      ) : rows.length === 0 ? (
        // Distinct from "no habits yet" — spec §12 treats these separately.
        <div className="px-4 py-10 text-center text-sm text-text-secondary">
          No habits match this filter.{" "}
          <button onClick={() => setAreaFilter([])} className="text-accent-primary underline">
            Clear filter
          </button>
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
              onOpen={() => { setFocusNewTitle(false); setOpenId(r.habit.id); }}
            />
          ))}
        </div>
      )}

      <div className="mt-4">
        <QuickAdd placeholder="Add habit..." onAdd={handleCreate} />
      </div>

      {openRow && (
        <HabitFlyout
          habit={openRow.habit}
          today={today}
          autoFocusTitle={focusNewTitle}
          onSave={(field, value) => handleSave(openRow.habit.id, field, value)}
          onToggleDate={(date) => toggle(openRow.habit.id, openRow.loggedDays, date)}
          onClose={() => { setOpenId(null); setFocusNewTitle(false); }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Check `FilterPill`'s actual props before wiring**

Open `src/components/app/FilterBar.tsx` and confirm `FilterPill` takes `label`, `options`, `selected`, `onChange` and `pillType`. Adjust the call above to match the real signature if it differs.

- [ ] **Step 3: Run the app**

Run: `npm run dev`, open `http://localhost:3000/habits`
Expected: **one** nav bar, correct page padding, the empty state or existing habits, no console errors.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/habits/page.tsx"
git commit -m "feat: add the Habits page"
```

---

## Chunk 5: Integration and verification

### Task 18: Today page schedule filter

`today_agenda` emits **every** active habit (`002_views.sql:416, 433-435`) with the comment *"app/agent filters by schedule"* — a filter that has never been written. Invisible while every habit is daily; a visible bug the moment specific-day schedules are editable.

**Files:**
- Modify: `src/app/(app)/page.tsx`

- [ ] **Step 1: Filter the existing habit list**

The habit list is derived at **`src/app/(app)/page.tsx:29`** and consumed at lines 33, 44, 89 and 95. Modify that line in place — do **not** introduce a second variable, or nothing downstream changes.

Add the import:
```ts
import { isRequiredOn } from "@/lib/habit-stats";
```

Replace line 29:
```ts
const habits = agenda?.filter((item: any) => item.item_type === "habit") ?? [];
```
with:
```ts
const today = new Date();
const habits =
  agenda
    ?.filter((item: any) => item.item_type === "habit")
    .filter((item: any) => isRequiredOn(item.item_details?.schedule, today)) ?? [];
```

**Amended after code review (commit `4e8effd` → follow-up commit):** the double-`.filter()`
form above shipped first and passed typecheck and tests, but code review flagged two things
worth folding into one edit before merge. First, the re-filter had no comment explaining that
`today_agenda` deliberately delegates the schedule filter to the client (that contract lives
only in the SQL comment at `002_views.sql:416`) — worth writing down given the missing filter
*is* the bug this task fixes. Second, the two-callback form cost a second `(item: any) =>`
annotation, which silently pushed this file's `no-explicit-any` lint count from 7 to 8 (see
the Task 20 baseline table, now updated to include this file). The shipped version collapses
to one predicate, matching the visual shape of the `tasks`/`events` derivations either side of
it and costing zero net new lint problems:

```ts
// `today_agenda` emits every active habit and delegates the schedule filter
// to the client (002_views.sql:416). Not memoized deliberately: `habits`
// gets a fresh array every render regardless (no useMemo on this page), and
// pinning `today` to mount via useMemo(() => new Date(), []) would actively
// introduce a bug — a tab left open overnight would refetch on focus
// (staleTime 30s + refetchOnWindowFocus) but keep showing Monday's habits.
const today = new Date();
const habits =
  agenda?.filter(
    (item: any) =>
      item.item_type === "habit" &&
      isRequiredOn(item.item_details?.schedule, today)
  ) ?? [];
```

The view already emits `item_details.schedule` (line 425), so no view change is needed.

**Known limitation (spec §8):** this is a no-op for per-week habits. `isRequiredOn` returns true every day for `perWeek` because any day may be used to hit the target, so a 3x/week habit already completed three times stays on Today for the rest of the week. Suppressing it would require Today to fetch the current week's logs, which `today_agenda` does not carry.

- [ ] **Step 2: Verify**

Create a Mon/Wed/Fri habit. On a Tuesday, confirm it is absent from Today and that `habitsRemaining` (line 33) drops accordingly. If today is not a Tuesday, temporarily pass a fixed date into `isRequiredOn` to check both branches, then revert.

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
git add "src/app/(app)/page.tsx"
git commit -m "fix: filter Today's habits by schedule"
```

---

### Task 19: Habit ↔ goal linking

Linking already exists and already anticipates habits: `linkKRToEntity` (`src/services/links.ts:39-61`) writes `src_type: "key_result"`, `dst_type: "project" | "task" | "habit"` and **already accepts `'habit'`**. The Goals page already renders a **disabled** `+ Link habit` button.

**No migration and no trigger change.** Both 004/005 functions already filter `l.src_type = 'key_result'`, and habits are excluded by construction: 004 installs triggers only `after update of status on projects`/`on tasks` (habits have no `status` column), and 005 updates only `projects` where `dst_type = 'project'` and `tasks` where `dst_type = 'task'`.

All five edits below are inside **`GoalFlyout`**, the component declared inline at `goals/page.tsx:30` — that is where `linkSearch`, `handleLinkEntity` and `krLinks` all live, not the page component.

**Files:**
- Modify: `src/app/(app)/goals/page.tsx`

- [ ] **Step 1: Widen the `linkSearch` state type**

At `goals/page.tsx:68-72`:
```ts
const [linkSearch, setLinkSearch] = useState<{
  krId: string | null;
  type: "project" | "task" | "habit";
  query: string;
} | null>(null);
```

- [ ] **Step 2: Widen `handleLinkEntity` and fix its toast**

At `goals/page.tsx:160-165`, the signature types `dstType: "project" | "task"`, so passing `linkSearch.type` would not compile. Its success toast at line 177 hardcodes a two-way choice and would announce "Task linked" for a habit.

```ts
const ENTITY_LABEL: Record<string, string> = {
  project: "Project", task: "Task", habit: "Habit",
};

const handleLinkEntity = async (
  krId: string | null,
  dstType: "project" | "task" | "habit",
  dstId: string,
  dstTitle: string
) => {
  // ... body unchanged ...
  await linkKR.mutateAsync({ krId: targetKrId!, dstType, dstId });
  toast(`${ENTITY_LABEL[dstType]} linked`, "success");
  // ... catch unchanged ...
};
```

- [ ] **Step 3: Enable the button**

Replace the disabled stub at `goals/page.tsx:467-473`. It sits in the **goal-level** link bar, outside `krs.map` (which closes at line 417), so `kr` is **not in scope** — its siblings at lines 458-466 pass `krId: null`, and this must too.

```tsx
<button
  onClick={() => setLinkSearch({ krId: null, type: "habit", query: "" })}
  className="text-xs text-text-muted hover:text-accent-primary border border-border-default rounded px-2 py-1"
>
  + Link habit
</button>
```

- [ ] **Step 4: Source habits in `filteredSearchResults`**

At `goals/page.tsx:184-192`, which currently sources only `projects` and `tasks`:

```ts
const items =
  linkSearch.type === "project"
    ? (projects ?? []).map((p: any) => ({ id: p.id, title: p.name ?? p.title }))
    : linkSearch.type === "habit"
    ? (habits ?? []).map((h: any) => ({ id: h.id, title: h.name }))
    : (tasks ?? []).map((t: any) => ({ id: t.id, title: t.title }));
```

Add the data source near the component's other queries:
```ts
import { useHabits, useHabitLogs } from "@/hooks/use-habits";
import { computeStats, normalizeSchedule, startOfDay, addDays } from "@/lib/habit-stats";

const habitToday = useMemo(() => startOfDay(new Date()), []);
const { data: habits } = useHabits();
const { data: habitLogs = [] } = useHabitLogs(
  addDays(habitToday, -365),
  addDays(habitToday, 1),
);
```

- [ ] **Step 5: Add the habit branch to the KR renderer**

A habit is never *done* — it is ongoing. For a habit-backed KR, hide the check circle and drive the progress bar from the habit's `rate30d`.

**`krLinks` spans every KR of the goal** (see the `l.src_id` mapping at `goals/page.tsx:60-62`), so the lookup **must** filter by `src_id === kr.id`. Without that, one habit link makes *every* KR in the goal render as habit-backed.

Inside the `krs.map((kr) => ...)` body, before the existing check-circle JSX at lines 341-378:

```tsx
// `krLinks` is undefined while useLinksForKRs is in flight, and `krs` renders
// from the already-loaded `goals` — so on the flyout's first paint this runs
// against undefined. The existing code guards it the same way at line 60.
// TypeScript will NOT catch this: getLinksForKRs returns untyped `data ?? []`,
// so krLinks infers as `any`.
const habitLink = (krLinks ?? []).find(
  (l: any) => l.src_id === kr.id && l.dst_type === "habit",
);
const linkedHabit = habitLink
  ? habits?.find((h: any) => h.id === habitLink.dst_id)
  : undefined;

const habitRate = linkedHabit
  ? computeStats(
      normalizeSchedule(linkedHabit.schedule),
      linkedHabit.polarity,
      new Date(linkedHabit.created_at),
      habitLogs
        .filter((l: any) => l.habit_id === linkedHabit.id)
        .map((l: any) => ({ loggedAt: new Date(l.logged_at) })),
      addDays(habitToday, -365),
      addDays(habitToday, 1),
    ).rate30d
  : null;
```

Then render:

```tsx
{habitRate !== null ? (
  <div className="flex items-center gap-2 flex-1">
    {/* No check circle: a habit is never done. */}
    <span className="w-4 h-4 shrink-0 rounded-full border border-accent-info" />
    <span className="text-sm text-text-primary flex-1">{kr.title}</span>
    <div className="w-24 h-1.5 rounded-full bg-card overflow-hidden">
      <div
        className="h-full rounded-full bg-accent-info"
        style={{ width: `${habitRate}%` }}
      />
    </div>
    <span className="text-[11px] tabular-nums text-text-secondary w-10 text-right">
      {habitRate}%
    </span>
  </div>
) : (
  <>
    {/* The existing THREE siblings from lines 341-378, unchanged: the
        check-circle <button>, the title <span>, and the progress-bar <div>.
        They must be wrapped in a fragment — a ternary branch takes one
        expression, and as written they are three. */}
  </>
)}
```

- [ ] **Step 6: Typecheck and verify**

Run: `npx tsc --noEmit`
Then in the app: link a habit to a KR from Goals. Confirm the KR shows a rate and **no** check circle, that other KRs of the same goal are unaffected, and that the toast reads "Habit linked". Mark the KR done and confirm the habit is unaffected.

- [ ] **Step 7: Commit**

```bash
git add "src/app/(app)/goals/page.tsx"
git commit -m "feat: enable habit linking on the Goals page

linkKRToEntity already accepted 'habit' and the button already existed as
a disabled stub. Habit-backed KRs show a 30-day rate rather than a check
circle, because a habit is never done."
```

---

### Task 20: Manual verification pass

`habit-stats.ts` is covered by unit tests; nothing else is (spec §9.2). This checklist is the only guard on page-level behaviour, so run all of it before merging.

- [ ] Log and unlog today on a daily habit; the circle, last dot and streak all update and survive a refresh
- [ ] Kill the network and tap the circle; confirm rollback and the error `Toast`
- [ ] Open the flyout, then toggle the circle behind it; the heatmap and stats bar update too,
      not just the row (the two-cache path) — **verify in the OPPOSITE direction, 22 Aug.**
      Clicking the row circle while the flyout is open only dismisses the flyout; the first
      click never reaches the circle. Backfill *in the heatmap* instead and confirm the row
      behind it updates. Verified working: a 3x/week backfill moved the row to `1/3` and the
      summary strip from 27%/52% to 29%/55%.
- [ ] Backfill a past day from the heatmap; the streak recomputes
- [ ] Click a non-required heatmap cell on a Mon/Wed/Fri habit; nothing happens
- [ ] Backfill a past day on a **3x/week** habit; the cell is clickable and the fraction updates
- [ ] Switch a habit to 3x/week; dots stop showing red, the slot shows `n/3`, the streak reads in weeks
- [ ] **Create a break habit and leave it unlogged for several days; those days render green, not red, and the streak grows only as each day closes**
- [ ] **Log the break habit every day for three days; the streak reads 0 and the rate 0%** — with a target of 1 instead of a 0 ceiling this reported a full streak and 100%
- [ ] Set a habit inactive; it dims, the circle disables, it disappears from Active and returns under All
- [ ] Link a habit to a KR from Goals; that KR shows a rate and no check circle, and **other KRs in the same goal are unaffected**
- [ ] ~~Mark that KR done; the habit is unaffected~~ **NOT PERFORMABLE — 22 Aug.** The
      previous item verifies a habit-backed KR has *no clickable circle*, so this item asks
      for something its own predecessor makes impossible. The intent (004/005 triggers do not
      touch habits) is settled by construction: habits have no `status` column, so no trigger
      exists. Reachable only after deactivating the habit — which is the next item.
- [ ] **Set that linked habit inactive, then toggle the KR's circle.** `useHabits()` excludes
      inactive habits, so `linkedHabit` goes undefined and the KR silently reverts to the
      check-circle branch — which restores `toggleKR` and lets the KR be marked done. Reactivate
      the habit and confirm what that leaves behind: the rate row returns with a `status: "done"`
      persisting invisibly underneath it. Exercise the toggle, don't just eyeball the rendering
- [ ] A Mon/Wed/Fri habit is absent from Today on a Tuesday
- [ ] **Create a habit and check the summary strip immediately: the 30-day rate reads `0%`, never `NaN%`. Repeat with a 3x/week habit, which has no closed period for up to a week, and confirm it does not poison the average**
- [ ] "On track" counts a per-week habit that met its target earlier in the week
- [ ] With only break habits visible, "On track" and "At risk" read `—` with the "no build habits" caption
- [ ] With no habits, the empty state renders and the QuickAdd field accepts a name
      (auto-focusing it is deferred — see the table below)
- [ ] Filter to an area with no habits; "No habits match this filter" appears, distinct from the empty state
- [ ] Create a habit from QuickAdd; the flyout opens with the title focused
- [ ] Confirm exactly **one** nav bar on `/habits` and padding matching `/goals`
- [ ] Break the Supabase URL; the error row and retry action appear rather than a blank page
      — **DOES NOT TEST WHAT IT INTENDS, 22 Aug.** With an invalid URL the auth middleware
      cannot verify the session and redirects to `/login` before any page query runs, so the
      error row never renders. Not a blank page, so the stated criterion passes, but by a
      different mechanism. The error row is reachable only when the URL is *valid* and a query
      then fails (RLS denial, missing table, transient network). Verified separately by
      rejecting `fetch` for supabase calls: mutations surface a toast and roll back
      (see the two items above), but cached reads mean a client-side nav shows stale data
      rather than the error row. **The error/retry row remains UNVERIFIED.**
- [ ] Fail a `SchedulePicker` save; the popover **stays open** with the previous value and an error toast

- [ ] **Final checks**

```bash
npm test          # habit-stats suite green
npx tsc --noEmit  # clean
npm run build     # succeeds

# Lint ONLY the files this work touched. A bare `npm run lint` reports 264
# problems (236 errors) on this repo as of 21 Aug — eslint.config.mjs does not
# ignore `mcp/`, so it lints the MCP package's compiled dist/ output. That is a
# pre-existing condition that arrived with the MCP merge and is not this work's
# to fix; a whole-repo gate would be meaningless here.
npx eslint src/lib/habit-stats.ts src/lib/habit-stats.test.ts            src/services/habits.ts src/hooks/use-habits.ts            src/components/app/HabitRow.tsx src/components/app/HabitFlyout.tsx            src/components/app/HabitHeatmap.tsx src/components/app/SchedulePicker.tsx            "src/app/(app)/habits/page.tsx" "src/app/(app)/page.tsx"            "src/app/(app)/goals/page.tsx"
```

**`src/app/(app)/page.tsx` added to the scoped command on 22 Aug.** Task 18 modifies this
file but the command above originally didn't cover it, so Task 18 shipped with zero lint
coverage — a code-review finding caught it after the fact (the double-`.filter()` draft had
briefly pushed this file's `no-explicit-any` count from 7 to 8 before being collapsed to one
predicate; see Task 18's amendment note). Recorded here rather than left as a silent gap so
the next task doesn't reintroduce it.

**`src/app/(app)/goals/page.tsx` added to the scoped command on 22 Aug** — the SAME gap,
one task later. Task 19 modifies this file and the command still didn't cover it, so Task 19
would have shipped with zero lint coverage exactly as Task 18 nearly did. Caught during
Task 20's own final checks rather than by a reviewer this time. The pattern is worth naming:
**adding the file a task touches to the gate is part of that task, not an afterthought** —
twice now the gate has silently excluded the file under active edit.

**Expected lint baseline for the scoped command: 63 problems (55 errors, 8 warnings).**
Measured on 22 Aug with Tasks 1-19 landed — 53 `no-explicit-any`, 6 `no-unused-vars`,
2 `set-state-in-effect`, 2 `exhaustive-deps`. The gate's job is to catch *new* rule
violations, not to reach zero — so compare the composition, not just the count.

Without `goals/page.tsx` the gate reads 25 (23 errors, 2 warnings); that file contributes
38 (31 `no-explicit-any`, 6 `no-unused-vars`, 1 `set-state-in-effect`). Task 19 raised its
`no-explicit-any` from 26 to 31, all five being plan-prescribed `(l: any)` / `(h: any)`
callbacks in Steps 4-5.

| Rule | Count | Why it is accepted |
|---|---|---|
| `@typescript-eslint/no-explicit-any` | 53 | `src/lib/types.ts` is literally `export type Database = any`, so there are no generated Supabase row types to reference. The same rule fires in `DataTable.tsx` (×4), `FlyoutPanel.tsx` and `EditableCell.tsx`. 31 of the 53 are in `goals/page.tsx` and 7 in `src/app/(app)/page.tsx` (pre-existing, unrelated to Task 18's edit — Task 18's own edit reuses an existing `(item: any) =>` callback rather than adding one, so it contributes zero net-new). Typing these properly means generating Supabase types — a separate piece of work, now in the Deferred table. |
| `@typescript-eslint/no-unused-vars` | 6 | All in `goals/page.tsx`, all pre-existing at `bb758df` (verified). `ArrowRight`, `Link2`, `FilterBar`, `keyResultsData`, `prog` — and `unlinkKR`, which is the mutation for an unlink affordance that was started and abandoned. `Link2` is its icon. Together they are the clearest evidence the missing unlink is dropped work rather than an oversight; see the follow-up note under Task 19. |
| `react-hooks/set-state-in-effect` | 2 | `SchedulePicker`'s re-sync effect, and one pre-existing in `goals/page.tsx:125`. `NotePopover:17` has the same, and it is the pattern `SchedulePicker` was told to mirror. |
| `react-hooks/exhaustive-deps` on `open` | 1 | Deliberate. Adding `open` to the deps re-runs the effect on every open/close and defeats the guard that stops a background refetch wiping an edit in progress. |
| `react-hooks/exhaustive-deps` on `commit` | 1 | Same shape as `NotePopover:29`'s missing `handleSave`. |

**A new rule name appearing, or a count rising, is the signal to investigate.** During
execution this fired twice, and both were fixed rather than absorbed.

The second: an `exhaustive-deps` warning on the Habits page's `logs`, from
`logsQuery.data ?? []` minting a fresh array every render while the query loads — which
defeated the `allRows` useMemo and recomputed every habit's statistics on each pass. The
same class of bug this plan already guards against by memoizing `today`, so fixing one and
not the other would have been incoherent. Now `useMemo(() => logsQuery.data ?? [], [logsQuery.data])`.

The first: `Cannot access variable
before it is declared` in `SchedulePicker`, caused by this plan placing `serialise`,
`resetToProp` and `commit` after the effect that calls `commit`. `NotePopover` does not
produce that error, so it was introduced here, not inherited. Fixed by reordering (commit
`669654e`) — function declarations hoist, so it was pure code movement.

The lesson is worth keeping: "some of these problems are pre-existing" quietly becomes "all
of them are". Check each rule against a sibling file that predates this work.

- [ ] **Commit any fixes, then use superpowers:finishing-a-development-branch**

---

## Deferred, with reasons

Recorded so they are decisions rather than omissions:

| Item | Why |
|---|---|
| **Generated Supabase row types** | `src/lib/types.ts` is `export type Database = any`, which forces `any` annotations through every service, hook and component that touches a row — 10 of the 13 lint problems above. Fixing it means running Supabase type generation and threading real types through, which touches far more than Habits. |
| Component tests for the row, heatmap and optimistic path | Needs jsdom + React Testing Library, which the app has never had. Task 20 covers it manually. |
| **"Push to Habit"** — creating a habit from a manual KR | Spec §7.1 names it alongside the `→ Proj` / `→ Task` buttons at `goals/page.tsx:387,394`. Link-in works; push-out is a second flow on an already 968-line file. Ships separately. |
| **Auto-focusing QuickAdd in the empty state** | Spec §12 asks for it. `QuickAdd` is a `forwardRef`, so it is a ref plus a `focus()` — but focus-stealing on mount is a real annoyance if the user arrived to read rather than add. Left to a follow-up rather than half-wired. |
| **Unlinking from the habit flyout** | Spec §6 lists the block as "Link / unlink", but all linking originates from the Goals side (§7.1). The flyout displays the link and points at where to manage it. |
| Rewriting the `habit_stats` view | Left untouched for the MCP server. This page simply does not read it. |
| Today page `item_details.streak` bug | `page.tsx:113` reads a key `today_agenda` never emits, so habit streaks silently never render there. Pre-existing and unrelated. |
| Per-week suppression on Today | `today_agenda` does not carry the week's logs; a second query is out of scope. |
| Count and duration metric habits | `metric_type` is displayed but only `boolean` is wired. |
| Habit reordering | Habits order by `created_at`; no `sort_order` column. |
| Streaks beyond 365 days | Truncated by the list window. Same class of flaw as the SQL view's 90-day cap, at four times the span. |
| **A log dated before the habit's `created_at` cannot be cleared from the heatmap** | The cell renders `done` (or `broke`), but `canBackfill` refuses any date earlier than `created_at` — so the click that would clear it is rejected, and the heatmap offers no other way out. Clear it with the MCP `unlog` tool instead. **This state is reachable through normal use, not only through corrupted data:** `mcp/src/tools/habits.ts:190-193` declares `logged_at` as an unconstrained optional ISO string, so "log my meditation for last Tuesday" against a habit created yesterday produces exactly it. The durable fix is clamping `logged_at >= created_at` at the MCP write boundary, which would make the case unreachable by construction rather than merely documented — a separate task in a separate package, deliberately not done here. |
| **A KR linked to a PAUSED (inactive) habit shows a DRIFTING rate, with no "paused" affordance** | After `666a441` the KR correctly stays in the habit branch when its habit is deactivated — but the rate does not hold still, because `periods()` has no notion of `active` and keeps emitting one period per required day. **A paused BUILD habit decays to 0% within 30 days** (every post-pause period is unlogged, scoring 0), so a goal the user deliberately paused renders as comprehensively failing. **A paused BREAK habit sits at 100% indefinitely** (unlogged satisfies the ceiling), reading as perfect abstinence for something nobody is tracking. Both misrepresent, in opposite directions, and neither is visibly "paused". The fix is a muted **"paused" pill** next to the KR title — NOT dimming, which reads as loading/disabled and gives the user nothing to act on — and it likely also wants a reactivate-or-unlink affordance on that row, which is a real design task rather than a one-liner. |
| **A KR linked to an ARCHIVED habit can still be orphaned** | The narrower residue of the deactivated-habit bug fixed in `666a441`. `getHabits` filters `.is("archived_at", null)` unconditionally — `includeInactive` only gates the `.eq("active", true)` filter — so `useHabits(true)` rescues a deactivated habit but not an archived one. The KR reverts to the check-circle branch, `toggleKR` returns, and a `status="done"` can be persisted that no visible row will ever show. Much narrower, and arguably **accepted degradation rather than a deferred bug**: archiving is ONE-WAY — nothing in the app or the MCP tools ever clears `archived_at` (`services/habits.ts:77` sets it; no restore path exists). The deactivated case was harmful because the habit could come BACK, so the tick vanished while `status="done"` persisted and the header counted a completion no visible row could clear. An archived habit cannot return, so the KR degrades permanently into an ordinary manual KR and header, ticks and database stay in agreement. No invisible state. Fixing it needs a different query — one that resolves a single habit by id ignoring both filters — not another flag on `getHabits`. |
