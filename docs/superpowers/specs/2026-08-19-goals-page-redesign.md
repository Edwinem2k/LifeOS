# Goals Page Redesign — Design Spec

**Date:** 2026-08-19
**Status:** Draft
**Mockup:** `mockups/goals-v2.html`

## Summary

Replace the existing tree-based Goals page with a card-based layout grouped by life area. Goals contain key results (KRs) which can be manual or linked to projects/tasks/habits. All linking originates from the Goals side.

## Scope

### In scope
- New Goals page layout (area-grouped, progress strip, collapsible KRs)
- Goal flyout panel with unified KR list and linking
- "Push KR to Project/Task" action
- "Goal" column in Tasks and Projects tables
- Fix GOAL_STATUSES in constants.ts to match DB enum
- Update goal_progress view for KR-based calculation
- Soft-delete link behavior (delete either side → link removed, other side stays)

### Out of scope
- Habit tracker (future — but linking system designed to support it)
- Mobile-optimised Goals editing (desktop-first, responsive enough not to break)
- Quarterly review card
- Quarterly segment bars on goal cards
- Font change (Inter is already the app font via next/font)

## Data Model

### Existing tables (no changes needed)

**goals** — stores both goals and key results
```
id, user_id, title, kind ('goal' | 'key_result'), parent_goal_id,
area (life_area), horizon (goal_horizon: annual/q1/q2/q3/q4),
status (goal_status: not_started/in_progress/on_track/at_risk/done),
target_value, current_value, unit,
progress_mode ('manual'|'from_tasks'|'from_activity'|'from_habit'),
due_date, notes, created_at, updated_at, archived_at
```

**links** — connects KRs to projects/tasks (and future habits)
```
id, user_id, src_type, src_id, dst_type, dst_id,
relation (link_relation), suggested, created_by, created_at
unique(src_type, src_id, dst_type, dst_id, relation)
```

### Relationships

- **Goal → KR parentage**: via `parent_goal_id` in the `goals` table (KR rows have `kind='key_result'` and `parent_goal_id` pointing to the parent goal)
- **KR → Project/Task linkage**: via the `links` table (`src_type='key_result'`, `src_id=kr.id`, `dst_type='project'|'task'|'habit'`, `dst_id=entity.id`, `relation='contributes_to'`)

### Constants fix required

`src/lib/constants.ts` GOAL_STATUSES must be updated to match the DB enum:
```ts
// Current (wrong):
// achieved, abandoned
// Must become:
{ value: "not_started", label: "Not Started", color: "var(--color-status-inbox)" },
{ value: "in_progress", label: "In Progress", color: "var(--color-status-in-progress)" },
{ value: "on_track", label: "On Track", color: "var(--color-accent-success)" },
{ value: "at_risk", label: "At Risk", color: "var(--color-accent-warning)" },
{ value: "done", label: "Done", color: "var(--color-status-done)" },
```

### Migration file: `003_goals_redesign.sql`

This is a new migration file (do not edit `002_views.sql` — it's already applied). The old `goal_progress` view output columns (`linked_tasks`, `linked_tasks_done`, `linked_tasks_pct`, `child_goals`, `child_goals_done`, `avg_child_progress`) are all dropped and replaced with KR-based columns. Any existing code consuming the old view must be updated.

**Design note:** KR progress uses binary done/not-done counting, not weighted averages. A KR at 90% progress but not marked `done` contributes 0% to the goal. This keeps the progress ring simple and action-oriented — finish KRs to see progress move.

#### Replace goal_progress view

```sql
create or replace view goal_progress as
with kr_stats as (
  -- KRs are child rows in goals table with kind='key_result'
  select
    g.parent_goal_id as goal_id,
    count(g.id)::int as kr_count,
    count(g.id) filter (where g.status = 'done')::int as kr_done_count,
    case
      when count(g.id) = 0 then null
      else round(100.0 * count(g.id) filter (where g.status = 'done') / count(g.id), 1)
    end as kr_pct
  from goals g
  where g.kind = 'key_result'
    and g.parent_goal_id is not null
    and g.archived_at is null
  group by g.parent_goal_id
)
select
  g.id as goal_id,
  g.user_id,
  g.title,
  g.kind,
  g.area,
  g.horizon,
  g.status as goal_status,
  g.target_value,
  g.current_value,
  g.unit,
  g.progress_mode,
  -- direct progress % (manual: current_value / target_value)
  case
    when g.target_value > 0
      then round(least(100.0 * coalesce(g.current_value, 0) / g.target_value, 100), 1)
    else null
  end as direct_pct,
  -- KR-based progress
  coalesce(kr.kr_count, 0) as kr_count,
  coalesce(kr.kr_done_count, 0) as kr_done_count,
  kr.kr_pct,
  -- effective: use KR progress when KRs exist, else direct
  case
    when coalesce(kr.kr_count, 0) > 0 then kr.kr_pct
    else case
      when g.target_value > 0
        then round(least(100.0 * coalesce(g.current_value, 0) / g.target_value, 100), 1)
      else case when g.status = 'done' then 100.0 else 0.0 end
    end
  end as effective_pct
from goals g
left join kr_stats kr on kr.goal_id = g.id
where g.kind = 'goal'
  and g.archived_at is null;
```

#### New view: area_progress

```sql
create or replace view area_progress as
select
  gp.user_id,
  gp.area,
  gp.horizon,
  count(gp.goal_id)::int as goal_count,
  round(avg(coalesce(gp.effective_pct, 0)), 1) as avg_pct
from goal_progress gp
group by gp.user_id, gp.area, gp.horizon;
```

**Horizon filtering:** The progress strip can query `area_progress` filtered by the selected horizon tab. When "Annual" is selected, query without horizon filter to show all-horizon aggregates (sum client-side or use a separate unfiltered query).

## Page Layout

### Header
- Title: "2026 Goals" (dynamic from current year)
- Subtitle: "Set in January · Next review: [date]"
- Horizon tabs: Annual | Q1 | Q2 | Q3 | Q4
  - Filtering: selecting a quarter shows goals with that horizon + annual goals
  - "Annual" (default) shows all goals

### Progress Strip
- Horizontal bar spanning full width, 8 segments
- First segment: **Total** (average of all area percentages, dark bar using `var(--color-text-primary)`)
- Remaining 7: one per life area with colored dot, %, and mini progress bar
- Data from area_progress view
- Clicking an area scrolls to that section (nice-to-have)

### Area Sections
- One section per life area (7 total), always visible (not collapsible)
- Header: colored left bar (4px) | Area name (Inter 700, 1.125rem) | "X goals · Y% avg" | border-bottom 2px
- Only show areas that have at least one goal
- Goal cards listed under each area header

### Goal Cards
- Row layout: progress ring | title + meta | status pill | KR toggle chevron
- Progress ring: 40px, colored per area, shows effective_pct
- Meta line: "X / Y key results" + "Due: [date]"
- Status pill: reuse StatusPill component with goal statuses
- Chevron: toggles KR visibility (collapsed by default)

### Key Results (nested under goal card)
- Grey background (#f5f5f4), border-top separator
- Each KR row: check circle | title | link tags (if any) | progress bar | value
- Link tags appear right after title, before progress bar (ensures bars align)
- Check circle states: empty (not started), partial/blue border (in progress), green filled (done)
- Linked KRs show a small icon/tag indicating linked entity type (project/task/habit)
- Completed KRs: strikethrough title, green check

### Quick Add
- Dashed border button at bottom of each area section
- Text: "Add goal to [Area]..."
- Click → creates new goal with area pre-set → opens flyout with title focused

### Loading / Empty / Error States
- **Loading**: skeleton rows matching goal card height (reuse existing skeleton pattern)
- **Empty** (no goals at all): centered message "No goals yet. Add your first goal to get started."
- **Empty area**: area section hidden (only show areas with goals)
- **Progress strip loading**: grey placeholder blocks
- **Error**: toast notification (existing pattern)

## Goal Flyout Panel

Follows existing FlyoutPanel pattern (480px, right slide-out).

### Header
- Close button | Editable title (auto-focus on new goals)

### Inline Metadata Row (grey background)
- **Status**: dropdown with StatusPill styling (not_started, in_progress, on_track, at_risk, done)
- **Area**: dropdown with area pill styling (7 life areas)
- **Horizon**: dropdown with same styling (annual, q1-q4)
- **Due Date**: DatePicker component (same as Tasks/Projects)
- All dropdowns use same visual pattern as Tasks/Projects flyouts

### Progress Section
- Only visible when goal has NO key results
- Fields: Target value, Current value, Unit
- When KRs exist: show computed "X / Y key results complete" (read-only)

### Key Results Section (unified list)
- Single list containing both manual KRs and linked items
- Each KR row: check circle | title | type indicator (manual / linked project / linked task / linked habit) | progress | actions (edit, unlink/delete)
- **"+ Add key result"** button → adds inline row, enter to save
- **"+ Link project"** button → opens search dropdown of existing projects → selecting one creates a link and adds to KR list
- **"+ Link task"** button → same pattern with tasks
- **"+ Link habit"** button → disabled/placeholder for now, greyed out with "Coming soon" tooltip
- **"Push to Project"** action on manual KRs → creates a new project with KR title, auto-links, KR stays
- **"Push to Task"** action on manual KRs → creates a new task with KR title, auto-links, KR stays

### Notes Section
- Textarea, auto-save on blur (same as Tasks/Projects)

## Linking Mechanics

### Data flow
- All links stored in `links` table: `src_type='key_result'`, `src_id=kr.id`, `dst_type='project'|'task'|'habit'`, `dst_id=entity.id`, `relation='contributes_to'`
- KR progress for linked items: derived from the linked entity's status (done = 100%, in_progress = 50%, etc.) or from project_progress view
- user_id must be passed when creating links (fetch from auth.getUser() in the hook)

### Deleting behavior
- **Delete a linked project/task**: link row deleted, KR stays as manual KR. Toast: "Project deleted — KR unlinked"
- **Delete a KR with linked project/task**: link row deleted, project/task stays. No cascade.
- **Unlink** (from flyout): just removes link row, both entities stay

### "Push to Project/Task"
1. User clicks "Push to Project" on a manual KR
2. Hook fetches user_id from auth.getUser()
3. System creates a new project with title = KR title, area = goal's area, status = 'idea', user_id
4. System creates a link row: src_type='key_result', src_id=kr.id, dst_type='project', dst_id=new_project.id, relation='contributes_to', user_id
5. KR now shows as linked in the list
6. Same flow for "Push to Task" (status = 'inbox')

## Tasks/Projects Table Changes

### New "Goal" column
- Shows in both Tasks and Projects DataTable
- Displays: small pill/tag with the linked goal title, or empty if none
- Read-only in the table (linking only happens from Goals side)
- Data: join through links table where dst_type='project'|'task' and src_type='key_result', then get the KR's parent goal title
- Column position: after "Area" column

## Services & Hooks

### Service updates
- `goals.ts`: update `createGoal()` to auto-fetch user_id from auth.getUser() (matching projects.ts/tasks.ts pattern). Add `createKeyResult()`, `getKeyResultsForGoal()`
- `links.ts`: add `linkKRToEntity(userId, krId, dstType, dstId)`, `unlinkKR(linkId)`, `getLinkedEntityForKR(krId)`
- `projects.ts`: add `getGoalForProject(projectId)` (via links table join)
- `tasks.ts`: add `getGoalForTask(taskId)` (via links table join)

### Hook updates
- `use-goals.ts`: add `useCreateKeyResult()`, `useKeyResults(goalId)`
- `use-links.ts`: add `useLinkKR()`, `useUnlinkKR()`, `usePushKRToProject()`, `usePushKRToTask()`
- `use-goal-progress.ts`: update to use new view columns (kr_count, kr_done_count, effective_pct)
- New: `use-area-progress.ts` for progress strip data

### Query invalidation strategy
- `useCreateKeyResult`: invalidate `["goals"]`, `["goal-progress"]`, `["area-progress"]`
- `useLinkKR`: invalidate `["goals"]`, `["goal-progress"]`, `["area-progress"]`, `["links"]`
- `useUnlinkKR`: same as useLinkKR
- `usePushKRToProject`: invalidate `["goals"]`, `["goal-progress"]`, `["area-progress"]`, `["projects"]`, `["links"]`
- `usePushKRToTask`: invalidate `["goals"]`, `["goal-progress"]`, `["area-progress"]`, `["tasks"]`, `["links"]`
- `useUpdateGoal`: invalidate `["goals"]`, `["goal-progress"]`, `["area-progress"]`

## Component Structure

```
goals/page.tsx
├── ProgressStrip (total + 7 areas)
├── AreaSection[] (one per area with goals)
│   ├── AreaHeader (color bar, title, summary)
│   ├── GoalCard[] (ring, title, status, chevron)
│   │   └── KeyResultList (collapsible)
│   │       └── KeyResultRow[] (check, title, links, bar, value)
│   └── QuickAdd
└── FlyoutPanel (goal detail)
    ├── MetadataRow (status, area, horizon, due date)
    ├── ProgressFields (only when no KRs)
    ├── KeyResultsSection (unified list + add/link buttons)
    └── NotesSection
```
