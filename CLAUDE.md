# Life OS — Agent Operating Manual

Read `LIFE-OS-PLAN.md` for the full system spec. This file is the quick-reference
for any agent (Claude Code, Claude Desktop, Hermes) operating on this database.

## Schema Conventions

### Standard columns (every table)
- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null` — RLS enforced, always filter by this
- `created_at timestamptz default now()`
- `updated_at timestamptz default now()` — trigger-maintained
- `archived_at timestamptz` — soft delete; **always filter `where archived_at is null`** unless explicitly asked to show archived items

### Enums

**life_area**: money, health, growth, work, relationships, play, environment

**project_status**: idea, active, paused, done

**task_status**: inbox, next_action, in_progress, waiting_for, blocked, someday, done

**goal_kind**: goal, key_result

**goal_status**: not_started, in_progress, on_track, at_risk, done

**goal_horizon**: annual, q1, q2, q3, q4

**habit_polarity**: build, break

**habit_metric_type**: boolean, count, duration, value

**activity_type**: gym, yoga, kitesurf, run, walk, other

**interaction_kind**: call, meeting, message, note

**interaction_source**: manual, transcriber, agent

**note_kind**: morning_pages, note, meeting, journal, napkin

**list_kind**: travel, movies, tv, books, games, shopping, custom

**list_item_status**: open, done

**link_relation**: related, blocks, mentions, contributes_to, attended, about

**event_category**: work, fun, life_admin, birthday, health, travel, other

**event_category_source**: gcal_color, rule, llm, manual

### Key tables

| Table | Purpose |
|---|---|
| projects | Top-level work containers with status, area, priority |
| tasks | Actionable items; `project_id` (nullable), `parent_task_id` for subtasks |
| goals | Outcomes with measurable progress; `kind` = goal or key_result |
| habits | Recurring behaviours with flexible schedules |
| habit_logs | One row per habit completion |
| activity_logs | Freeform activity records (gym, kitesurf, etc.) |
| workout_sets | Per-set gym data linked to activity_logs |
| locations | Places you train |
| equipment | What's available at each location |
| exercises | Canonical exercise catalogue |
| contacts | CRM profiles |
| interactions | CRM interaction history |
| notes | Markdown notes, morning pages, journal |
| lists | Named lists (movies, books, travel, etc.) |
| list_items | List contents with per-list custom fields via metadata |
| key_info | Non-secret reference data (NIF, car plate, etc.) |
| documents | Google Drive file references |
| events | Google Calendar mirror (read-mostly) |
| links | Universal linking — connects any entity to any other |
| dashboards | User-composable dashboard layouts |

### The linking model (`links` table)

The `links` table is the keystone of the system. It connects any entity to any other:

```
src_type + src_id  --(relation)-->  dst_type + dst_id
```

**Relations and their meaning:**
- `related` — general association
- `blocks` — src blocks dst (task dependencies)
- `mentions` — src mentions dst (notes mentioning contacts)
- `contributes_to` — src contributes to dst (habits/projects contributing to goals)
- `attended` — person attended event
- `about` — document/note is about entity

**`suggested` flag**: when true, the link was proposed by a pipeline and awaits user confirmation. Never auto-confirm pipeline links involving people.

**`created_by`**: `user`, `agent`, or `pipeline`

### Inheritance defaults (tasks)

When creating a task under a project:
- `area` defaults from project's area (editable per task)
- `priority` defaults from project's priority (editable per task)
- `deadline` defaults from project's target_date (editable per task)

Standalone tasks set these directly.

### Lists hybrid model

Each list has an `item_schema jsonb` defining custom fields:
```json
[{"key": "recommended_by", "label": "Recommended by", "type": "text"}]
```
`list_items.metadata` stores values conforming to the list's schema. Read the list's `item_schema` first, then write conforming metadata.

### Events categorisation

Events have `category` and `category_source`. Resolution order:
1. `gcal_color` — mapped from Google Calendar colorId
2. `rule` — keyword/calendar-name rules
3. `llm` — classified by model
4. `manual` — user override (always wins, remembered)

## Agent rules

1. **Always filter `archived_at is null`** unless asked for archived items.
2. **Use views** (`project_progress`, `goal_progress`, `habit_stats`, `weekly_review`, `exercises_available`, `today_agenda`) — never recompute what a view provides.
3. **Never DDL.** Schema changes go through migrations only, reviewed by the user.
4. **Write links** when connecting entities. Use the correct `relation` value.
5. **Respect `item_schema`** when writing list item metadata.
6. **Set `created_by = 'agent'`** on links you create.
7. **key_info contains NO secrets.** If it grants access, it belongs in 1Password.
8. **UUIDs are internal.** Refer to entities by name/title in conversation.
9. **Habit logs**: use `value = 1` for boolean habits. For break-habits (polarity = 'break'), logging means the bad thing happened (streak = days without a log).
10. **Activity logs + workout_sets**: create the activity_log row first, then workout_sets referencing it. Always set `exercise_id` FK on workout_sets when the exercise exists in the catalogue.

## Computed views

- `project_progress` — per project: total tasks, done, % complete, blocked, overdue
- `goal_progress` — per goal: current_value/target_value, child rollup, linked task %
- `habit_stats` — per habit: current streak, longest streak, 30/90-day rate, EWMA strength score
- `weekly_review` — per week: tasks completed, habits %, activities, interactions, notes
- `exercises_available` — per location: exercises whose required_equipment is satisfied
- `today_agenda` — today's events + due tasks + scheduled habits + overdue follow-ups

## Project structure

```
supabase/migrations/   — numbered SQL migrations
scripts/               — import and utility scripts
LIFE-OS-PLAN.md        — full system spec
CLAUDE.md              — this file
```
