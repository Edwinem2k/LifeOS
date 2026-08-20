# Habits Page — Design Spec

**Date:** 2026-08-20
**Status:** Draft
**Mockup:** `mockups/habits-full.html`
**Design review:** https://claude.ai/code/artifact/163f159d-b812-4f9e-8758-7eb95fe9449c
**Branch:** `feat/habits-page` (off `main`)

## Summary

Add a Habits page to LifeOS: one row per habit, one tap to log today, a week of history
inline, and a flyout carrying streak statistics and a month heatmap. Habits link to goals
the same way projects and tasks already do.

The page also fixes `src/services/habits.ts`, which is entirely non-functional today, and
replaces the `habit_stats` SQL view with a pure TypeScript module so that non-daily
schedules (`3× per week`, `Mon/Wed/Fri`) produce correct streaks and rates.

## Scope

### In scope
- New Habits page (`/habits`) — summary strip, habit rows, QuickAdd
- Fix `logHabit` / `unlogHabit` (wrong column, missing `user_id`, timezone anchoring)
- Migration 006: add `area` to `habits`
- `src/lib/habit-stats.ts` — pure period-based statistics module
- `SchedulePicker` component — edit the `schedule` jsonb
- `HabitRow`, `HabitFlyout`, `HabitHeatmap` components
- `children` prop on `FlyoutPanel`
- Habits entry in `AppNav`
- Habit ↔ goal linking, including a `src_type <> 'habit'` guard on migrations 004/005
- Schedule filter for habits on the Today page (see §8)

### Out of scope
- Rewriting or dropping the `habit_stats` view — left in the database untouched for the
  MCP server, simply not read by this page
- Today page `item_details.streak` bug — the Today page reads a key `today_agenda` never
  emits, so habit streaks silently never render there. Pre-existing and unrelated.
- Per-habit notes — cut deliberately (`habit_logs.note` still exists for per-log notes)
- Count/duration metric habits — `metric_type` and `target_value` are displayed but only
  `boolean` is fully wired. Multi-log counting is a follow-up.
- Habit reordering / `sort_order` — habits order by `created_at`
- Kanban or alternate views

## 1. Data model

### 1.1 Existing tables (migration 001)

**habits**
```
id, user_id, name,
polarity      habit_polarity      ('build' | 'break')
schedule      jsonb               default '{"type":"daily"}'
metric_type   habit_metric_type   default 'boolean'
target_value  numeric
active        boolean             default true
created_at, updated_at, archived_at
```

**habit_logs**
```
id, user_id, habit_id → habits(id),
logged_at   timestamptz  not null default now()
value       numeric      default 1
note        text
created_at, updated_at, archived_at
```

Note the column is **`logged_at timestamptz`**, not `logged_date`. There is no unique
constraint on `(habit_id, day)`.

### 1.2 Migration 006

```sql
alter table habits add column area life_area;
```

Nullable, matching `tasks.area`. That is the entire migration.

No other schema change is needed:
- `links.src_type` / `links.dst_type` are plain `text`, so `'habit'` already works
- `schedule` is already `jsonb`, so §2's schedule shapes need no migration

### 1.3 Schedule shapes

The three shapes documented by the `schedule` column comment, all of which this page now
reads and writes:

| Shape | Stored as |
|---|---|
| Every day | `{"type":"daily"}` |
| Specific days | `{"type":"daily","days":[1,3,5]}` |
| N times a week | `{"type":"per_week","count":3}` |

`days` is **ISO-8601**: `1` = Monday through `7` = Sunday. So `[1,3,5]` is Mon/Wed/Fri.

A `schedule` that is null, malformed, or an unrecognised `type` is treated as
`{"type":"daily"}` rather than throwing.

### 1.4 Duplicate logs

`habit_logs` permits two rows for the same habit on the same day. This is left alone
deliberately: `habit-stats.ts` counts a *day* as done when at least one log exists, so
streaks stay correct, and `unlogHabit` deletes by day-range so it clears both rows. Adding
a unique constraint would block multi-log count habits, which `metric_type` already
anticipates.

## 2. The period model

This is the core abstraction. Everything else in the statistics module derives from it.

> **The schedule defines a period. The streak counts periods, not days.**

| Shape | Period | Target per period |
|---|---|---|
| Every day | one day | 1 |
| Specific days | one *required* day | 1 |
| N times a week | one ISO week (Mon–Sun) | N |

### 2.1 The generator

```ts
type Period = {
  start: Date;    // inclusive, local midnight
  end: Date;      // exclusive, local midnight
  target: number;
  actual: number; // distinct days logged within [start, end)
};

function periods(habit: Habit, logs: HabitLog[], from: Date, to: Date): Period[]
```

Periods are returned oldest-first. For `daily` and specific-days schedules, only required
days produce a period at all — a Tuesday on a Mon/Wed/Fri habit yields no period, which is
what makes it neutral rather than a miss everywhere downstream.

`actual` counts **distinct days** with at least one log, not raw log rows, so a double-tap
cannot inflate a per-week count.

### 2.2 Statistics derived from it

Every statistic reads the period list and never inspects `schedule` again.

- **`currentStreak`** — walk backwards from the most recent period, counting consecutive
  periods that met target. The period containing today is special: if it already meets
  target it counts; if it does not, it is **skipped rather than treated as a break**,
  because it is still open. This is the *streak survives until end of period* rule, and it
  is precisely what the `habit_stats` view gets wrong at day granularity.

- **`bestStreak`** — longest run of target-meeting periods across all history. No 90-day
  cap.

- **`rate30d`** — `sum(min(actual, target)) / sum(target)` over periods intersecting the
  last 30 days, as a percentage. Daily divides by 30, Mon/Wed/Fri by ~13, 3×/week by ~12.9.

- **`strength`** — EWMA with `alpha = 2/31`, matching the existing model's span, but
  weighting **periods** rather than raw days. Each period contributes
  `min(actual / target, 1)`. Output is identical to the current model for daily habits; a
  perfect 3-of-3 week now scores 1.0 rather than being penalised for four rest days.

- **`unit`** — `'day'` or `'week'`, derived from the schedule, so the UI can render `12d`
  vs `3w` without re-deriving it.

### 2.3 Break habits

`polarity = 'break'` flips exactly one comparison: the target becomes a **ceiling** and a
period succeeds when `actual <= target`.

- daily / specific-days → ceiling 0 (any log is a failure)
- per-week → `count` reads as an allowance, giving "takeaway at most twice a week"

No separate code path, no inverted period generator.

### 2.4 Shared helper

```ts
function isRequiredOn(habit: Habit, date: Date): boolean
```

True for every day on a `daily` schedule, true only for listed weekdays on a specific-days
schedule, and **true for every day** on a `per_week` schedule (any day may be used to hit
the target). Used by the row dots, the heatmap, and the Today page filter in §8, so all
three agree by construction.

### 2.5 Timezone

All period boundaries are computed in **local time**. Logs are anchored at 12:00 local
(§3.1), so bucketing a log into a day or week never straddles a UTC boundary.

## 3. Services and hooks

### 3.1 `src/services/habits.ts`

Currently broken: both existing functions write to a non-existent `logged_date` column, and
`logHabit` omits `user_id` so the insert would fail RLS regardless.

| Function | Behaviour |
|---|---|
| `getHabits()` | `active`, non-archived, ordered by `created_at` |
| `getHabit(id)` | Single |
| `createHabit(data)` | Injects `user_id` via `supabase.auth.getUser()`, same as `createProject` |
| `updateHabit(id, data)` | Standard update |
| `archiveHabit(id)` | Sets `archived_at`. No hard delete, matching projects |
| `getHabitLogs(from, to)` | All habits, date range. Powers dots, heatmap and statistics from one call |
| `logHabit(id, date?)` | Inserts with `user_id` and `logged_at` anchored at **12:00 local** on the target date |
| `unlogHabit(id, date?)` | Deletes with `gte(dayStart)` + `lt(dayStart + 1 day)` — **not** `.eq()`, which can never match a timestamp |

Noon anchoring matters: the user is in Lisbon (UTC+1), and a log written at 00:30 local
would otherwise land on the previous UTC day.

Both log functions take an optional date so the heatmap can backfill past days.

### 3.2 `src/hooks/use-habits.ts`

`useHabits`, `useHabit`, `useCreateHabit`, `useUpdateHabit`, `useArchiveHabit`,
`useHabitLogs(from, to)`, plus the existing `useLogHabit` / `useUnlogHabit` extended to
accept a date.

Mutations invalidate `["habits"]`, `["habit-logs"]` and `["today"]` — the Today page reads
the same logs through `today_agenda`.

### 3.3 Why not the `habit_stats` view

Confirmed by reading migration 002. The view is wrong in four ways:

1. **`current_streak` returns 0 until today is logged.** The subquery correlates against
   `hd3.day = current_date` with a matching-polarity filter, so a 12-day streak reads as 0
   all morning — exactly wrong for a page whose purpose is streaks.
2. **`longest_streak` is capped at the 90-day window**, so a best streak quietly resets.
3. **`rate_30d` divides by a fixed `30.0`** regardless of schedule, so a 3×/week habit
   maxes out at ~43%.
4. The view carries a dead `streaks` CTE the final `select` never references, plus a
   correlated subquery per habit.

The page already fetches raw logs for the week dots and month heatmap — for 5–15 habits
over 90 days that is a few hundred rows in a single query — so computing statistics in
TypeScript costs nothing extra and yields a pure, unit-testable module. The view is left in
the database untouched; the MCP server may still read it.

## 4. Page structure and components

### 4.1 Route and navigation

Route at `src/app/(app)/habits/page.tsx`.

`AppNav` gains one entry between Goals and the More button:
```ts
{ href: "/habits", label: "Habits", icon: Repeat }
```

### 4.2 Page layout

Matching Projects and Tasks:

1. Page header — title + New button
2. Summary strip — four cards: done today, best streak, 30-day rate, overall strength
3. Habit list — one `HabitRow` per habit
4. `QuickAdd` pinned at the bottom

### 4.3 Component split

`src/app/(app)/goals/page.tsx` has reached ~960 lines with `GoalFlyout` declared inline.
Habits starts split rather than being refactored later:

```
src/
├── app/(app)/habits/page.tsx     new   data fetching + page state only
├── components/app/
│   ├── HabitRow.tsx              new   circle, name, dots, streak slot
│   ├── HabitFlyout.tsx           new   detail panel body
│   ├── HabitHeatmap.tsx          new   month grid + backfill
│   ├── SchedulePicker.tsx        new   schedule jsonb editor
│   ├── FlyoutPanel.tsx           edit  add `children` prop
│   └── AppNav.tsx                edit  one nav entry
├── lib/habit-stats.ts            new   pure, no Supabase, unit-tested
├── services/habits.ts            edit  fix + extend
└── hooks/use-habits.ts           edit  fix + extend
```

### 4.4 Reuse

- **As-is:** `AppNav`, `QuickAdd`, `StatusPill` (polarity / metric / area pills),
  `FilterBar` (filter by area), `Toast`, `EditableCell` inside the flyout
- **Not `DataTable`** — habits have no sortable or resizable columns and the mockup is a
  list of fixed-shape rows. `HabitRow` is cheaper than bending `DataTable` to fit.
- **`FlyoutPanel` gains a `children` prop**, rendered after the field sections. It takes
  `fields`, `data` and `stats` today with no slot for arbitrary content, so there is
  nowhere to put the heatmap or strength bar. Three lines, no existing caller affected, and
  it gives Goals a route back onto the shared component instead of drifting further.

## 5. Row interactions

### 5.1 Anatomy

Left to right: circle toggle, name with a schedule/area subtitle, seven week dots
(Mon–Sun), right-aligned streak slot.

### 5.2 Behaviour

- **The circle toggles today**, optimistically. It fills immediately, the streak and last
  week dot update from recomputed statistics, and a failed write rolls back with a `Toast`.
  The circle stops propagation so it does not also open the flyout.
- **Clicking the row anywhere else opens the flyout.**
- **QuickAdd** matches Projects and Tasks: typing a name and pressing Enter creates the
  habit with defaults (`build` / `daily` / `boolean`) and opens the flyout with the title
  focused. The `+` button does the same with an empty name.

### 5.3 Week dot states

Five states, resolved via `isRequiredOn` and the log set:

| State | When | Render |
|---|---|---|
| done | logged | filled, success |
| missed | required, past, not logged | filled, danger |
| not required | `isRequiredOn` false, or per-week and unlogged | small hollow dot, muted |
| future | after today | hollow, muted |
| today | the current day | accent ring drawn *over* whichever state applies |

The **not required** state is what stops a 3×/week habit rendering four red misses every
week. Break habits invert: a logged day is a failure and renders danger rather than
success.

### 5.4 Streak slot

Takes the unit of the habit's period:

- **daily / specific-days** — one line, `12d`. Muted grey at zero rather than shouting,
  matching the mockup's `streak none` state.
- **per-week** — two lines: `2/3` as the primary, turning accent once the target is met,
  with `3w` beneath. On a per-week habit the fraction is the fact wanted at a glance and
  the streak is secondary; the two lines mirror the name-and-subtitle pair on the left.

## 6. The flyout

Same slide-over geometry and escape-to-close behaviour as existing panels. Everything below
the metadata block is passed through the new `children` prop.

| Block | Contents | Editable |
|---|---|---|
| Metadata | Row 1: polarity, metric, area. Row 2: schedule, active | `EditableCell`, except schedule → `SchedulePicker` |
| Stats bar | Current streak, best streak, 30-day rate, strength | Read-only, from `habit-stats.ts` |
| Heatmap | One month, Mon-first, `←` `→` month paging | Click a past cell to backfill or clear |
| Strength | EWMA bar, warning→success gradient, "100% = Automatic" | Read-only |
| Linked goal | Goal name, area and horizon, click through to Goals | Link / unlink |

Heatmap cells use the same states as the week dots, so an off-day on a Mon/Wed/Fri habit
reads as neutral rather than as a hole in the month. Today gets an accent outline over
whichever state applies. Clicking a future cell does nothing; clicking a past cell calls
`logHabit` / `unlogHabit` with that date, which is why both take an optional date.

### 6.1 `SchedulePicker`

Follows the existing `NotePopover` pattern: click the value, a popover opens, clicking
outside saves.

- A select for the three shapes: *Every day* / *N times a week* / *Specific days*
- *N times a week* reveals a 1–6 stepper. Choosing 7 nudges the user to *Every day*.
- *Specific days* reveals seven day chips, ISO order Mon→Sun. Selecting all seven nudges to
  *Every day*; selecting none is rejected.

It writes the existing jsonb shapes, so `today_agenda`, `habit_stats` and the MCP server
continue reading exactly what they read today.

## 7. Goal linking

Mechanically identical to projects and tasks: a row in `links` with `src_type = 'habit'`,
`dst_type = 'goal'`, `relation = 'contributes_to'`. No migration needed.

The Goals page gains **Link Habit** (imports an existing habit as a key result) alongside
Link Project and Link Task, and **Push to Habit** creates a new habit from a manual KR.

### 7.1 Habits are excluded from the auto-complete triggers

Migrations 004 and 005 sync done-ness both ways between a KR and its linked project or
task. **A habit is never done** — it is ongoing — so wiring habits into those triggers would
either mark a goal complete after a single log or fight the user indefinitely.

Two changes follow:

1. The trigger functions in 004 and 005 need a `src_type <> 'habit'` guard.
2. The KR renderer on the Goals page needs a habit branch: a habit-backed KR shows
   **progress** — its 30-day rate — where a project-backed KR shows a check circle.

This is the one place the Habits work reaches into an existing page's logic rather than
adding alongside it.

## 8. Today page schedule filter

`today_agenda` emits **every** active habit, with the comment *"app/agent filters by
schedule"*. That filter has never been written.

This is invisible while every habit is daily, but becomes a visible bug the moment
specific-days schedules are editable — the Today page would show Mon/Wed/Fri habits on a
Tuesday. The view already emits `item_details.schedule`, so the fix is a client-side filter
on the Today page using the same `isRequiredOn(habit, date)` helper from §2.4.

The view itself is not changed.

## 9. Testing

`src/lib/habit-stats.ts` is pure and carries the interesting logic, so it takes the bulk of
the test coverage. Priority cases:

- **Period generation** for all three schedule shapes, including a specific-days habit
  producing no period on a non-required day
- **Streak survives an open period** — a daily habit logged through yesterday but not today
  reports the full streak, not 0. This is the headline bug in the SQL view.
- **Streak breaks on a closed unmet period** — the same habit reports 0 tomorrow if today
  ends unlogged
- **Per-week streaks count weeks** — 3/3 for three consecutive weeks is `3w`, and a
  mid-week 1/3 neither counts nor breaks
- **Schedule-aware rate denominators** — daily /30, Mon/Wed/Fri /~13, 3×/week /~12.9
- **Strength parity** — a daily habit's EWMA matches the existing model's output
- **Break habit polarity** — success on zero logs, and per-week allowance behaviour
- **Duplicate logs on one day** count once
- **Timezone** — a log written at 00:30 local lands on the correct local day
- **Malformed schedule** falls back to daily rather than throwing

Component tests cover the circle's optimistic update and rollback, and the five dot states.

## 10. Decisions taken

| Decision | Choice |
|---|---|
| Flyout composition | `children` prop on `FlyoutPanel`, not a bespoke shell |
| Per-habit notes | Cut. Migration 006 is `area` only |
| Schedule editing | Build `SchedulePicker`; per-week habits are a real requirement |
| Statistics location | TypeScript module, not the `habit_stats` SQL view |
| Habit ↔ goal auto-complete | Habits excluded from the 004/005 triggers |

## 11. Risks

- **Trigger guard touches shipped migrations.** §7.1 modifies the 004/005 trigger
  functions. It needs a new migration altering them rather than editing the applied files,
  and the change must be verified against existing project/task KR sync.
- **Migration 005 may not be applied.** Project notes record it as pending in the Supabase
  SQL Editor. Confirm before building on top of it.
- **`strength` parity** with the existing view is asserted for daily habits but the view is
  not read, so any drift is invisible in production. The test in §9 is the only guard.
