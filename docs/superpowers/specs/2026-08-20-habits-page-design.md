# Habits Page — Design Spec

**Date:** 2026-08-20
**Status:** Draft (rev 2 — after spec review)
**Mockup:** `mockups/habits-full.html`
**Design review:** https://claude.ai/code/artifact/163f159d-b812-4f9e-8758-7eb95fe9449c
**Branch:** `feat/habits-page` (off `main`)

## Summary

Add a Habits page to LifeOS: one row per habit, one tap to log today, a week of history
inline, and a flyout carrying streak statistics and a month heatmap. Habits link to goals
through the existing key-result linking system.

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
- `polarity` and `metric` pill types in `constants.ts` / `StatusPill`
- Habits entry in `AppNav`
- Habit ↔ goal linking: enable the existing disabled stub on the Goals page
- Vitest + unit tests for `habit-stats.ts` (see §9)
- Schedule filter for habits on the Today page (see §8)

### Out of scope
- Rewriting or dropping the `habit_stats` view — left in the database untouched for the
  MCP server, simply not read by this page
- Today page `item_details.streak` bug — the Today page reads `habit.item_details?.streak`
  (`src/app/(app)/page.tsx:113`), a key `today_agenda` never emits, so habit streaks
  silently never render there. Pre-existing and unrelated.
- Per-habit notes — cut deliberately (`habit_logs.note` still exists for per-log notes)
- Count/duration metric habits — `metric_type` and `target_value` are displayed but only
  `boolean` is fully wired. Multi-log counting is a follow-up.
- Habit reordering / `sort_order` — habits order by `created_at`
- Kanban or alternate views
- Component/integration tests — see §9.2
- Any change to migrations 004 / 005 — see §7.2

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

The column is **`logged_at timestamptz`**, not `logged_date`. There is no unique constraint
on `(habit_id, day)`.

### 1.2 Migration 006

```sql
alter table habits add column area life_area;
```

Nullable, matching `tasks.area`. This is the only migration the work requires — see §7.2
for why no trigger migration is needed.

No other schema change is needed: `links.src_type` / `dst_type` are plain `text`, and
`schedule` is already `jsonb`.

### 1.3 Schedule shapes

| Shape | Stored as |
|---|---|
| Every day | `{"type":"daily"}` |
| Specific days | `{"type":"daily","days":[1,3,5]}` |
| N times a week | `{"type":"per_week","count":3}` |

`days` is **ISO-8601**: `1` = Monday through `7` = Sunday, so `[1,3,5]` is Mon/Wed/Fri.

Nothing in the database enforces this convention and neither existing view interprets
`days`, so a row written elsewhere using JavaScript's `getDay()` (0 = Sunday) would be
misread. Normalisation (§2.1) rejects out-of-range values rather than trusting them.

### 1.4 Duplicate logs

`habit_logs` permits two rows for the same habit on the same day. This is left alone
deliberately: `habit-stats.ts` counts **distinct days**, not log rows, so a double-tap
cannot inflate a count, and `unlogHabit` deletes by day-range so it clears both rows.
Adding a unique constraint would block multi-log count habits, which `metric_type` already
anticipates.

## 2. The period model

This is the core abstraction. Everything in the statistics module derives from it.

> **The schedule defines a period. The streak counts periods, not days.**

| Shape | Period | Target per period |
|---|---|---|
| Every day | one day | 1 |
| Specific days | one *required* day | 1 |
| N times a week | one ISO week (Mon–Sun) | N |

### 2.1 Normalisation

The module never trusts the raw jsonb. `schedule` is written by this UI, by the MCP server,
by agents, and by rows that predate any validation, so normalisation happens at the module
boundary rather than in the picker.

```ts
type NormalizedSchedule =
  | { kind: 'daily' }
  | { kind: 'days';    days: number[] }   // sorted, deduped, each 1..7, length 1..6
  | { kind: 'perWeek'; count: number };   // integer 1..6

function normalizeSchedule(raw: unknown): NormalizedSchedule
```

Rules, all falling back to `{ kind: 'daily' }`:

- null, non-object, malformed, or unrecognised `type`
- `type: 'daily'` with no `days`, an empty `days`, or all seven days listed
- `type: 'daily'` with `days` → keep integers in 1..7, dedupe, sort; empty after filtering → daily
- `type: 'per_week'` with a non-numeric or absent `count` → daily
- `type: 'per_week'` with `count >= 7` → daily (a 7×/week habit *is* daily)
- `type: 'per_week'` with `count < 1` → daily

This closes the `count: 9` case (target unreachable in a 7-day week, so `currentStreak`
would be permanently 0) and the `count: 0` case (division by zero), neither of which the
picker's 1–6 stepper can prevent for rows written by anything else.

### 2.2 The generator

```ts
type Period = {
  start: Date;    // inclusive, local midnight
  end: Date;      // exclusive, local midnight
  target: number;
  actual: number; // distinct days logged within [start, end)
  closed: boolean;// end <= now
};

function periods(
  schedule: NormalizedSchedule,
  createdAt: Date,
  logs: { loggedAt: Date }[],
  from: Date,
  to: Date,
): Period[]
```

Periods are returned oldest-first.

- **Only whole periods.** A period is emitted only if its entire `[start, end)` falls
  within the requested range. No pro-rated targets, so a partial ISO week at a window edge
  never produces an unreachable target.
- **Clamped to habit creation.** `from` is raised to the start of the period containing
  `createdAt`. A habit created yesterday has no periods for the preceding month, so it
  cannot report a 3% rate — and a *break* habit cannot accumulate phantom successful
  periods from before it existed.
- **Weeks are keyed by their Monday**, as a local-midnight date, never by a week number.
  `getFullYear()` disagrees with the ISO week-year across Dec 29 – Jan 3, so week-number
  keying would split a single week into two half-periods each carrying the full target.
- **Non-required days produce no period.** On a `days` schedule, a Tuesday for a
  Mon/Wed/Fri habit yields nothing, which is what makes it neutral everywhere downstream.
- `actual` counts **distinct local days** with at least one log, not raw rows.

### 2.3 Period score

One function carries both polarities, so no statistic divides by a target that may be zero.

```ts
function periodScore(p: Period, polarity: 'build' | 'break'): number
```

- **build** — `p.target > 0 ? Math.min(p.actual / p.target, 1) : (p.actual > 0 ? 1 : 0)`.
  Partial credit: a 2-of-3 week scores 0.67.
- **break** — `p.actual <= p.target ? 1 : 0`. The target is a **ceiling**: 0 for daily and
  specific-days, and `count` read as an allowance for per-week, which gives "takeaway at
  most twice a week" for free. Never divides.

A period **meets target** when `build: actual >= target` / `break: actual <= target`.

### 2.4 Statistics

Every statistic reads the period list and never inspects `schedule` again.

- **`currentStreak`** — walk backwards from the most recent period, counting consecutive
  periods that met target. Phrased on *the most recent period*, not on "today", because a
  specific-days habit has no period at all on a non-required day:

  - If the most recent period is **open** (`!closed`):
    - **build** — it counts toward the streak if it already meets target; otherwise it is
      **skipped** without breaking the run, because it is still open. This is the
      *streak survives until end of period* rule, and it is precisely what the
      `habit_stats` view gets wrong.
    - **break** — it is **always skipped**, never counted. A break habit satisfies its
      ceiling (`0 <= 0`) at 00:00 every day, so counting an open period would credit the
      streak before it was earned and then decrement it if the user logged later that day.
  - Every earlier period is closed and breaks the run if it did not meet target.

- **`bestStreak`** — longest run of target-meeting periods **within the fetched window**.
  Because this is window-bounded, the window differs by context (§3.3): the list view uses
  365 days, and the flyout fetches that habit's complete log history so its "Best" figure
  is genuinely all-time.

- **`rate30d`** — `mean(periodScore)` over **closed** periods ending within the last 30
  days, as a percentage. The open current period is excluded so a mid-week reading is not
  dragged down by a week still in progress.
  - daily → 30 closed day-periods
  - Mon/Wed/Fri → ~13 closed required days
  - 3×/week → the 4 complete ISO weeks ending last Sunday

- **`strength`** — EWMA with `alpha = 2/31`, matching the existing model's span, over
  **periods** rather than raw days, each contributing its `periodScore`. Output is
  identical to the current model for daily build habits; a perfect 3-of-3 week now scores
  1.0 rather than being penalised for four rest days.

- **`unit`** — `'day'` for daily and specific-days, `'week'` for per-week, so the UI renders
  `12d` vs `3w` without re-deriving it.

### 2.5 Two separate helpers for "does this day count"

These answer different questions and must not be conflated.

```ts
// For the Today page filter only. Takes raw jsonb because today_agenda
// supplies item_details.schedule, not a Habit row.
function isRequiredOn(rawSchedule: unknown, date: Date): boolean
```
True every day for `daily` and `perWeek`; true only for listed weekdays on `days`.

```ts
// For the row dots and the heatmap.
function dotState(
  schedule: NormalizedSchedule,
  polarity: 'build' | 'break',
  date: Date, today: Date, logged: boolean,
): 'done' | 'broke' | 'missed' | 'pending' | 'not-required' | 'future'
```

| Result | Condition |
|---|---|
| `future` | `date > today` |
| `done` | logged, build polarity |
| `broke` | logged, break polarity |
| `not-required` | `days` schedule and `date` not listed; **or** `perWeek` and not logged |
| `pending` | required, `date === today`, not logged |
| `missed` | required, `date < today`, not logged |

`pending` exists so today's unlogged dot is not painted as a miss before the day ends,
matching the streak rule. A `perWeek` habit therefore never renders a `missed` dot — no
individual day is ever required — and the week's standing is carried by the `2/3` fraction
in the streak slot (§5.4) and by the streak resetting when an unmet week closes.

### 2.6 Timezone

All period boundaries are computed in **local time**, and the module buckets a log by the
**local date of `logged_at`**. That invariant is what makes bucketing correct, and it holds
regardless of who wrote the row.

Noon anchoring on write (§3.1) serves a narrower purpose: `habit_stats` and `today_agenda`
both bucket by `(logged_at at time zone 'UTC')::date`, so anchoring at 12:00 local keeps
the SQL views agreeing with this module. Lisbon is UTC+0 in winter and UTC+1 in summer;
noon anchoring is safe for both.

### 2.7 Types

`src/lib/types.ts` is a single line — `export type Database = any` — so there are no
generated row types to import. `habit-stats.ts` defines its own minimal local input types
(the `Period` shape above, plus `{ loggedAt: Date }` for logs). That is what makes the
module pure and testable rather than coupled to Supabase.

## 3. Services and hooks

### 3.1 `src/services/habits.ts`

Currently broken: both existing functions target a non-existent `logged_date` column, and
`logHabit` omits `user_id` so the insert would fail RLS regardless.

| Function | Behaviour |
|---|---|
| `getHabits(opts?)` | Non-archived. `opts.includeInactive` defaults false; ordered by `created_at` |
| `getHabit(id)` | Single |
| `createHabit(data)` | Injects `user_id` via `supabase.auth.getUser()`, same as `createProject` |
| `updateHabit(id, data)` | Standard update |
| `archiveHabit(id)` | Sets `archived_at`. No hard delete, matching projects |
| `getHabitLogs(from, to)` | All habits, date range. Powers dots, summary and list statistics |
| `getHabitLogsFor(habitId)` | One habit, **unbounded**. Powers the flyout's all-time Best streak and heatmap paging |
| `logHabit(id, date?)` | Inserts with `user_id` and `logged_at` anchored at **12:00 local** on the target date |
| `unlogHabit(id, date?)` | Deletes with `gte(dayStart)` + `lt(dayStart + 1 day)` — **not** `.eq()`, which can never match a timestamp |

`unlogHabit` **hard-deletes**, unlike `archiveHabit` one row above. This is deliberate:
unlogging means the log never happened, so there is no history worth preserving, and both
existing views filter `archived_at is null` anyway, which would make a soft-deleted log
invisible but still present.

### 3.2 `src/hooks/use-habits.ts`

`useHabits`, `useHabit`, `useCreateHabit`, `useUpdateHabit`, `useArchiveHabit`,
`useHabitLogs(from, to)`, `useHabitLogsFor(habitId)`, plus the existing `useLogHabit` /
`useUnlogHabit` extended to accept a date.

The existing hooks have only `onSuccess`, which cannot deliver the optimistic behaviour
§5.2 promises. `useLogHabit` / `useUnlogHabit` need the full contract:

- `onMutate` — `cancelQueries` on `["habit-logs"]`, snapshot the cached logs, write the
  optimistic log in or out
- `onError` — restore the snapshot and raise a `Toast`
- `onSettled` — `invalidateQueries` on `["habits"]`, `["habit-logs"]` and `["today"]`

Other mutations invalidate the same three keys on success. The Today page reads the same
logs through `today_agenda`, which is why `["today"]` is included.

### 3.3 Query windows

Statistics must never depend on where the user has paged the heatmap, so the two windows
are separate queries with separate keys:

| Window | Key | Range | Feeds |
|---|---|---|---|
| Stats | `["habit-logs", from, to]` | today-anchored, 365 days, fixed | Summary strip, row dots, row streaks |
| Flyout | `["habit-logs", habitId]` | unbounded, single habit | Flyout stats bar, heatmap at any month |

Paging the heatmap back to March changes nothing about the list's numbers, because the
list never reads the flyout's query.

### 3.4 Why not the `habit_stats` view

Confirmed by reading `002_views.sql`. The view is wrong in four ways:

1. **`current_streak` returns 0 until today is logged.** The inner subquery requires
   `hd3.day = current_date` with a matching-polarity filter (lines 236–246), so it yields
   NULL and `count(*)` collapses to 0 whenever today is unlogged. A 12-day streak reads as
   0 all morning — exactly wrong for a page whose purpose is streaks.
2. **`longest_streak` is capped at the 90-day window.** `habit_daily` is built from a
   90-day `date_series` (lines 128–135), so a best streak quietly resets.
3. **`rate_30d` divides by a literal `30.0`** (lines 214–217) regardless of schedule, so a
   3×/week habit maxes out at ~43%.
4. The view carries a dead `streaks` CTE (lines 153–187) the final `select` never
   references, plus two correlated subqueries per habit.

The page already fetches raw logs for the week dots and heatmap, so computing statistics in
TypeScript costs nothing extra and yields a pure, unit-testable module. The view is left in
the database untouched; the MCP server may still read it.

## 4. Page structure and components

### 4.1 Route and navigation

Route at `src/app/(app)/habits/page.tsx`. `AppNav` gains one entry between Goals and the
More button:

```ts
{ href: "/habits", label: "Habits", icon: Repeat }
```

### 4.2 Page layout

Matching Projects and Tasks:

1. Page header — title + New button
2. `FilterBar` — filter by area, plus an **Active / All** filter defaulting to Active
3. Summary strip — four cards (§4.5)
4. Habit list — one `HabitRow` per habit
5. `QuickAdd` pinned at the bottom

### 4.3 Component split

`src/app/(app)/goals/page.tsx` has reached 968 lines with `GoalFlyout` declared inline at
line 30. Habits starts split rather than being refactored later:

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
├── lib/
│   ├── habit-stats.ts            new   pure, no Supabase, unit-tested
│   └── constants.ts              edit  polarity + metric pill maps
├── services/habits.ts            edit  fix + extend
└── hooks/use-habits.ts           edit  fix + extend
```

### 4.4 Reuse

- **As-is:** `AppNav`, `QuickAdd`, `FilterBar`, `Toast`, `EditableCell`, `NotePopover`
  (as the pattern for `SchedulePicker`)
- **`StatusPill` needs extending, not reusing.** Its `type` union is
  `"status" | "area" | "priority"`, and `getPillColor` → `getStatusColor` falls back to
  `var(--color-text-muted)` for unrecognised values (`constants.ts:72-78, 106-110`).
  `'build'`, `'break'`, `'boolean'` and `'count'` appear in none of the maps, so they would
  all render as identical grey pills. Add `polarity` and `metric` pill types with colour
  maps: build → success, break → danger, and neutral tones for the metric types.
- **Not `DataTable`** — habits have no sortable or resizable columns and the mockup is a
  list of fixed-shape rows. `HabitRow` is cheaper than bending `DataTable` to fit.
- **`FlyoutPanel` gains a `children` prop**, rendered after the field sections. It takes
  `fields`, `data` and `stats` today with no slot for arbitrary content, so there is
  nowhere to put the heatmap or strength bar. No existing caller is affected, and it gives
  Goals a route back onto the shared component instead of drifting further.

### 4.5 Summary strip

Four cards. All four are **unit-free**, because §2.4 makes streaks unit-dependent and a
"best streak" comparing a daily `12d` against a weekly `3w` has no defined meaning.

| Card | Value |
|---|---|
| Done today | `n / m` — habits whose current period is met, over habits with a period today |
| At risk | count of habits whose streak ≥ 3 and whose current period is open and unmet |
| 30-day rate | mean `rate30d` across visible habits |
| Strength | mean `strength` across visible habits |

## 5. Row interactions

### 5.1 Anatomy

Left to right: circle toggle, name with a schedule/area subtitle, seven week dots
(Mon–Sun), right-aligned streak slot.

### 5.2 Behaviour

- **The circle toggles today**, optimistically, via the `onMutate`/`onError`/`onSettled`
  contract in §3.2. It fills immediately, the streak and last week dot update from
  recomputed statistics, and a failed write restores the snapshot and raises a `Toast`. The
  circle stops propagation so it does not also open the flyout.
- **For a break habit the circle means "I did the thing I'm trying not to do."** Filling it
  is a *failure*, rendered in danger colour, not success. The subtitle carries the polarity
  pill so the affordance is not ambiguous.
- **Clicking the row anywhere else opens the flyout.**
- **QuickAdd** matches Projects and Tasks: typing a name and pressing Enter creates the
  habit with defaults (`build` / `daily` / `boolean`) and opens the flyout with the title
  focused. The `+` button does the same with an empty name.

### 5.3 Week dot states

Rendered from `dotState` (§2.5):

| State | Render |
|---|---|
| `done` | filled, success |
| `broke` | filled, danger |
| `missed` | filled, danger |
| `pending` | hollow, muted, accent ring (it is today) |
| `not-required` | small hollow dot, muted |
| `future` | hollow, muted |

Today always carries an accent ring drawn *over* whichever state applies.

### 5.4 Streak slot

Takes the unit of the habit's period:

- **daily / specific-days** — one line, `12d`. Muted grey at zero, matching the mockup's
  `streak none` state. Note that on a Mon/Wed/Fri habit `12d` counts twelve *required*
  days, which span about four weeks.
- **per-week** — two lines: `2/3` as the primary, turning accent once the target is met,
  with `3w` beneath. On a per-week habit the fraction is the fact wanted at a glance and
  the streak is secondary; the two lines mirror the name-and-subtitle pair on the left.

## 6. The flyout

Same slide-over geometry and escape-to-close behaviour as existing panels. Everything below
the metadata block is passed through the new `children` prop.

| Block | Contents | Editable |
|---|---|---|
| Metadata | Row 1: polarity, metric, area. Row 2: schedule, active | `EditableCell`, except schedule → `SchedulePicker` and active → §6.2 |
| Stats bar | Current streak, best streak (all-time), 30-day rate, strength | Read-only, from `habit-stats.ts` |
| Heatmap | One month, Mon-first, `←` `→` month paging | Click a past **required** cell to backfill or clear |
| Strength | EWMA bar, warning→success gradient, "100% = Automatic" | Read-only |
| Linked goal | Goal name, area and horizon, click through to Goals | Link / unlink |

Heatmap cells use the same `dotState` values as the week dots, so an off-day on a
Mon/Wed/Fri habit reads as neutral rather than as a hole in the month. Today gets an accent
outline over whichever state applies.

Clicking a `future` or `not-required` cell does nothing. Non-required cells are explicitly
inert because a log written there would be invisible to every statistic (§2.2 emits no
period for it) yet would render as `done` — a cell that lies about its own effect. Clicking
a past required cell calls `logHabit` / `unlogHabit` with that date, which is why both take
an optional date.

### 6.1 `SchedulePicker`

Follows the existing `NotePopover` pattern: click the value, a popover opens, clicking
outside saves.

- A select for the three shapes: *Every day* / *N times a week* / *Specific days*
- *N times a week* reveals a 1–6 stepper. Choosing 7 switches to *Every day*.
- *Specific days* reveals seven day chips, ISO order Mon→Sun. Selecting all seven switches
  to *Every day*; selecting none is rejected.

It writes the existing jsonb shapes, so `today_agenda`, `habit_stats` and the MCP server
continue reading exactly what they read today. The picker constrains only what this UI
writes — `normalizeSchedule` (§2.1) is what actually protects the statistics.

### 6.2 The `active` toggle

`active` is `boolean`, and `EditableCell`'s `type` union is `text|textarea|select|date|number`
with `FlyoutPanel.onSave` typed `(field, value: string)`. It is rendered as a `select` of
Yes/No mapped to boolean on save.

Because `getHabits()` filters on `active`, toggling it off would otherwise make the habit
vanish with no route back. §4.2's **Active / All** filter is what prevents that one-way
door; switching to All reveals inactive habits, which render at reduced opacity with the
log circle disabled.

## 7. Goal linking

### 7.1 Direction and existing plumbing

Linking already exists and already anticipates habits. `src/services/links.ts:39-61`:

```ts
linkKRToEntity(krId, dstType: "project" | "task" | "habit", dstId)
  → { src_type: "key_result", src_id: krId,
      dst_type: dstType,      dst_id: dstId,
      relation: "contributes_to" }
```

So the direction is **`src_type = 'key_result'`, `dst_type = 'habit'`** — the KR is the
source. `'habit'` is already in the accepted union; no service change is required.

The Goals page already renders a **disabled `+ Link habit` button**
(`goals/page.tsx:467-473`, titled "Coming soon"). The work is enabling it, not adding it:

1. Remove `disabled` and wire `onClick` to `setLinkSearch({ krId, type: "habit", query: "" })`
2. Widen `linkSearch.type` to include `"habit"`
3. Widen `filteredSearchResults` (`goals/page.tsx:184-192`), which currently sources only
   `projects` and `tasks`, to source habits when `type === "habit"`
4. Add a habit branch to the KR renderer (§7.3)
5. Use `getGoalForEntity('habit', habitId)` for the flyout's Linked goal block

**Push to Habit** creates a new habit from a manual KR and links it the same way.

### 7.2 No trigger change is needed

An earlier revision of this spec called for a `src_type <> 'habit'` guard on migrations 004
and 005. That was wrong on two counts, and the work item, along with two risks that
depended on it, is removed.

- Both trigger functions already filter `l.src_type = 'key_result'`, so a guard on
  `src_type` could never match a different row.
- Habits are excluded **by construction**. 004 installs triggers only
  `after update of status on projects` and `on tasks`; `habits` has no `status` column and
  no trigger, so it can never fire. 005 fires on `goals` and updates only `projects` where
  `dst_type = 'project'` and `tasks` where `dst_type = 'task'`; a KR linked to a habit
  matches neither `update`.

Marking a habit-backed KR done therefore does nothing to the habit, and nothing about a
habit can mark a KR done. That is the desired behaviour, already in place.

### 7.3 Habit-backed KRs render progress, not completion

A habit is never *done* — it is ongoing. The KR row currently renders both a check circle
and a progress bar (`goals/page.tsx:341-378`). For a habit-backed KR the check circle is
hidden and the progress bar is driven by the habit's `rate30d`.

This carries a cross-page data dependency that must be built, not assumed: the Goals page
fetches neither habits nor habit logs today. It needs `getHabits()` plus a `getHabitLogs`
call over the stats window, and it runs `habit-stats.ts` to derive the rate.

This is the one place the Habits work reaches into an existing page's logic rather than
adding alongside it.

## 8. Today page schedule filter

`today_agenda` emits **every** active habit (`002_views.sql:416, 433-435`), with the
comment *"app/agent filters by schedule"*. That filter has never been written.

This is invisible while every habit is daily, but becomes a visible bug the moment
specific-days schedules are editable — the Today page would show Mon/Wed/Fri habits on a
Tuesday. The view already emits `item_details.schedule` (line 425), so the fix is a
client-side filter using `isRequiredOn(item_details.schedule, today)` from §2.5. The view
itself is not changed.

**Known limitation:** the filter is a no-op for per-week habits. `isRequiredOn` returns
true every day for `perWeek` because any day may be used to hit the target, so a 3×/week
habit already completed three times stays on the Today list for the rest of the week.
Suppressing it would require the Today page to fetch the current week's logs, which
`today_agenda` does not carry; that second query is out of scope here.

## 9. Testing

### 9.1 Infrastructure

**The project has no test runner.** `package.json` scripts are `dev`/`build`/`start`/`lint`,
devDependencies contain no vitest or jest, and there are zero test files under `src/`. The
`mcp/` package has its own vitest setup, but the web app does not.

This work adds **vitest only** — no jsdom, no React Testing Library — plus a `test` script.
`habit-stats.ts` is deliberately pure and dependency-free (§2.7), so it needs no DOM
environment.

### 9.2 What is tested

`habit-stats.ts` carries all of the interesting logic and takes the coverage:

- **Normalisation** — `count: 9`, `count: 0`, `days: []`, all seven days, `days: [0]`
  (JavaScript convention), null, `{}`, and unrecognised `type` all fall back correctly
- **Period generation** for all three shapes, including a specific-days habit producing no
  period on a non-required day
- **Whole periods only** — a window edge cutting through an ISO week emits no partial period
- **Creation clamping** — a habit created yesterday reports no periods for last month, for
  both polarities
- **Week keying across a year boundary** — 2026-12-28 … 2027-01-03 is one period
- **Streak survives an open period** — a daily build habit logged through yesterday but not
  today reports the full streak, not 0. This is the headline bug in the SQL view.
- **Streak breaks on a closed unmet period** — the same habit reports 0 tomorrow
- **Open period never counts for break polarity** — a daily break habit does not gain a day
  at 00:00
- **Per-week streaks count weeks** — 3/3 for three consecutive weeks is `3w`, and a
  mid-week 1/3 neither counts nor breaks
- **Schedule-aware rate denominators** — daily 30 closed days, Mon/Wed/Fri ~13, 3×/week 4
  complete weeks
- **Strength parity** — a daily build habit's EWMA matches the existing view's model
- **Break habit scoring** — success on zero logs; per-week allowance behaviour; no division
  by a zero target in either `rate30d` or `strength`
- **Duplicate logs on one day** count once
- **Timezone** — a log at 00:30 local buckets to the correct local day
- **`dotState`** — all six results, including `pending` for today and `not-required` for a
  per-week unlogged day

Component behaviour (optimistic update and rollback, dot rendering) is **not** covered by
automated tests in this work; adding jsdom and RTL is a separate decision. It is verified
manually against the checklist in §10.

## 10. Manual verification

Run after implementation, before merge:

1. Log and unlog today on a daily habit; confirm the circle, last dot and streak all update
   and survive a refresh
2. Kill the network and tap the circle; confirm rollback and the error `Toast`
3. Backfill a past day from the heatmap; confirm the streak recomputes
4. Click a non-required heatmap cell on a Mon/Wed/Fri habit; confirm nothing happens
5. Switch a habit to 3×/week; confirm dots stop showing red, the slot shows `n/3`, and the
   streak reads in weeks
6. Set a habit inactive; confirm it disappears from Active and returns under All
7. Link a habit to a KR from Goals; confirm the KR shows a rate and no check circle
8. Mark that KR done; confirm the habit is unaffected
9. Confirm a Mon/Wed/Fri habit is absent from Today on a Tuesday

## 11. Decisions taken

| Decision | Choice |
|---|---|
| Flyout composition | `children` prop on `FlyoutPanel`, not a bespoke shell |
| Per-habit notes | Cut. Migration 006 is `area` only |
| Schedule editing | Build `SchedulePicker`; per-week habits are a real requirement |
| Statistics location | TypeScript module, not the `habit_stats` SQL view |
| Link direction | `src_type='key_result'`, `dst_type='habit'` — the existing convention |
| Trigger changes | None. Habits are already excluded by construction (§7.2) |
| `rate30d` window | Closed periods only; the open current period is excluded |
| `bestStreak` scope | Window-bounded: 365 days in the list, all-time in the flyout |
| Break-habit open period | Always skipped, never credited |
| Test scope | Vitest for the pure module; no jsdom/RTL, no component tests |
| Summary strip | Unit-free metrics only; "best streak" replaced by "at risk" |

## 12. Error and empty states

| Situation | Behaviour |
|---|---|
| No habits yet | Empty state in the list area with a line of copy and the QuickAdd field focused |
| `getHabits` / `getHabitLogs` error | Inline error row with a retry action; summary strip renders `—` |
| Loading | Skeleton rows matching `HabitRow` height; summary strip shows `—` |
| Log / unlog failure | Optimistic rollback + `Toast` (§3.2) |
| Heatmap backfill failure | Cell reverts + `Toast` |
| `SchedulePicker` save failure | Popover stays open, previous value restored, `Toast` |
| Link / unlink failure | `Toast`; KR list refetches |
| Habit with no logs at all | Streak `0`, rate `0%`, strength `0%`, empty heatmap — not `—` |

## 13. Risks

- **The Goals-page habit branch (§7.3) is the largest single piece of new integration.** It
  adds two queries and a statistics dependency to a 968-line file that currently knows
  nothing about habits. If it proves messy, habit ↔ goal linking can ship separately from
  the Habits page itself without blocking anything else in this spec.
- **`strength` parity with the existing view** is asserted for daily build habits but the
  view is not read, so drift would be invisible in production. The §9.2 test is the only
  guard.
- **`normalizeSchedule` silently downgrades bad data to daily.** A habit whose schedule was
  written incorrectly by an agent will look like it is working rather than raising an
  error. This is the right default for a personal app but means bad writes go unnoticed.
