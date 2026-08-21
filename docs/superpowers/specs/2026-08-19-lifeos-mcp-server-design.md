# LifeOS MCP Server — Design Spec

**Date:** 2026-08-19
**Status:** Approved
**Owner:** Axel

## 1. Purpose

A custom MCP (Model Context Protocol) server that gives AI agents typed, safe read/write access to the LifeOS Supabase database. Three consumers share the same server code:

- **Hermes** (Hetzner VPS) — chat-based agent via Telegram
- **Claude Desktop** (local Windows machine) — desktop chat
- **Claude Code** (local Windows machine) — CLI development agent

The MCP server replaces the alternative of raw SQL via the Supabase MCP, providing structured tools with input validation, business logic enforcement, and audit logging.

## 2. Architecture

### Data flow

```
User (Telegram / Claude Desktop / Claude Code)
  -> Agent (Hermes / Claude Desktop / Claude Code)
    -> MCP stdio protocol
      -> lifeos-mcp server (Node.js child process)
        -> supabase-js (service role)
          -> Supabase Cloud Postgres (nhqxhntueexrzpyldvee.supabase.co)
```

### Key decisions

- **Stdio transport** — the MCP server is a local child process launched by each agent. No HTTP, no ports, no CORS, no auth between agent and MCP server.
- **Service role key** — bypasses RLS. The server enforces `user_id` filtering on every query via a constant loaded from `LIFEOS_USER_ID` env var. The server refuses to start if this var is missing or empty.
- **Actor via env var** — `LIFEOS_ACTOR` env var (e.g. `hermes`, `claude_desktop`, `claude_code`) determines who gets recorded in the `agent_actions` audit table. Same code, different config per deployment.
- **TypeScript** — compiled to JS for deployment. Type safety during development, plain Node.js at runtime.
- **`@modelcontextprotocol/sdk`** — official MCP SDK for the server implementation.
- **`supabase-js`** — Supabase client library for database access.
- **`zod`** — runtime input validation for all tool parameters.

### Startup validation

The server validates at startup and refuses to start if any are missing:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LIFEOS_USER_ID`
- `LIFEOS_ACTOR`

### User ID injection

A shared `supabase.ts` module exports the Supabase client and `USER_ID` constant. Every tool handler imports these and adds `.eq('user_id', USER_ID)` to queries and `.user_id = USER_ID` to inserts. This is the single enforcement point — no tool constructs queries without it.

## 3. Tools (42 total)

### 3.1 Tasks (5 tools)

**`list_tasks`**
- Params: `project` (string, optional), `status` (task_status, optional), `area` (life_area, optional), `include_done` (boolean, optional, default false)
- Returns: array of tasks with project name resolved, ordered by sort_order
- Filters `archived_at is null` always

**`create_task`**
- Params: `title` (string, required), `project` (string, optional — matched by name to project_id), `parent_task` (string, optional — matched by title to parent_task_id), `area` (life_area, optional), `priority` (priority_level, optional), `deadline` (date, optional), `notes` (string, optional), `status` (task_status, optional, default inbox)
- Business logic: if project is provided, inherits area/priority/deadline from project when not explicitly set
- Returns: created task

**`update_task`**
- Params: `id` (uuid) or `title` (string) to identify; any mutable field as optional params (title, notes, status, area, priority, deadline, project, parent_task, sort_order)
- If matched by title and multiple results, returns the matches and asks for clarification
- Returns: updated task (before + after)

**`complete_task`**
- Params: `id` (uuid) or `title` (string)
- Sets `status = 'done'`, `completed_at = now()`
- Returns: completed task

**`delete_task`**
- Params: `id` (uuid) or `title` (string)
- Soft delete: sets `archived_at = now()`
- Returns: confirmation

### 3.2 Projects (4 tools)

**`list_projects`**
- Params: `status` (project_status, optional), `area` (life_area, optional)
- Returns: projects with stats from `project_progress` view (total tasks, done, % complete, blocked, overdue)

**`create_project`**
- Params: `name` (string, required), `area` (life_area, required), `status` (project_status, optional, default idea), `priority` (priority_level, optional), `target_date` (date, optional), `description` (string, optional), `outcome` (string, optional), `success_check` (string, optional)
- Returns: created project

**`update_project`**
- Params: `id` (uuid) or `name` (string) to identify; any mutable field as optional params (name, description, status, priority, area, target_date, color, current_status, next_steps, notes, outcome, success_check)
- Returns: updated project (before + after)

**`delete_project`**
- Params: `id` (uuid) or `name` (string)
- Soft delete: sets `archived_at = now()`
- Returns: confirmation

### 3.3 Goals (4 tools)

**`list_goals`**
- Params: `area` (life_area, optional), `horizon` (goal_horizon, optional), `status` (goal_status, optional)
- Returns: goals with progress from `goal_progress` view (migration 003), grouped by area. View columns: `direct_pct`, `kr_count`, `kr_done_count`, `kr_pct`, `effective_pct`. Only returns `kind = 'goal'` rows (KRs are nested under their parent).

**`create_goal`**
- Params: `title` (string, required), `area` (life_area, required), `kind` (goal_kind, optional, default goal), `horizon` (goal_horizon, optional), `target_value` (number, optional), `unit` (string, optional), `parent_goal` (string, optional — matched by title to parent_goal_id), `due_date` (date, optional), `notes` (string, optional)
- Returns: created goal

**`update_goal`**
- Params: `id` (uuid) or `title` (string) to identify; any mutable field as optional params (title, status, area, horizon, target_value, current_value, unit, due_date, notes, progress_mode)
- Returns: updated goal (before + after)

**`delete_goal`**
- Params: `id` (uuid) or `title` (string)
- Soft delete
- Returns: confirmation

### 3.4 Habits (5 tools)

**`list_habits`**
- Params: `active_only` (boolean, optional, default true)
- Returns: habits with stats from `habit_stats` view (current streak, longest streak, 30/90-day rate, EWMA strength score)

**`log_habit`**
- Params: `habit` (string, matched by name), `value` (number, optional, default 1), `note` (string, optional), `logged_at` (timestamptz, optional, default now)
- Creates a `habit_logs` row
- Returns: logged entry with updated streak info

**`create_habit`**
- Params: `name` (string, required), `schedule` (jsonb, optional, default daily), `metric_type` (habit_metric_type, optional, default boolean), `polarity` (habit_polarity, optional, default build), `target_value` (number, optional)
- Returns: created habit

**`update_habit`**
- Params: `id` (uuid) or `name` (string) to identify; any mutable field
- Returns: updated habit

**`delete_habit`**
- Params: `id` (uuid) or `name` (string)
- Soft delete
- Returns: confirmation

### 3.5 Notes (4 tools)

**`list_notes`**
- Params: `kind` (note_kind, optional), `since` (date, optional), `search` (string, optional — searches title and body)
- Returns: notes ordered by created_at desc

**`create_note`**
- Params: `body` (string, required), `title` (string, optional), `kind` (note_kind, optional, default napkin), `note_date` (date, optional, default today)
- Returns: created note

**`update_note`**
- Params: `id` (uuid) or `title` (string) to identify; any mutable field
- Returns: updated note

**`delete_note`**
- Params: `id` (uuid) or `title` (string)
- Soft delete
- Returns: confirmation

### 3.6 Contacts (4 tools)

**`list_contacts`**
- Params: `search` (string, optional — searches full_name, nickname, company), `needs_followup` (boolean, optional — filters contacts past their follow_up_interval_days)
- Returns: contacts with last_interaction_at

**`create_contact`**
- Params: `full_name` (string, required), `nickname` (string, optional), `relationship` (string, optional), `company` (string, optional), `location` (string, optional), `emails` (jsonb array, optional), `phones` (jsonb array, optional), `birthday` (date, optional), `how_met` (string, optional), `follow_up_interval_days` (number, optional), `notes` (string, optional)
- Note: `emails` and `phones` are `jsonb` columns in the DB. The tool accepts arrays of strings and stores as jsonb.
- Returns: created contact

**`update_contact`**
- Params: `id` (uuid) or `full_name` (string) to identify; any mutable field
- Returns: updated contact

**`delete_contact`**
- Params: `id` (uuid) or `full_name` (string)
- Soft delete
- Returns: confirmation

### 3.7 Interactions (2 tools)

**`list_interactions`**
- Params: `contact` (string, matched by name), `kind` (interaction_kind, optional), `since` (date, optional)
- Returns: interactions ordered by occurred_at desc

**`create_interaction`**
- Params: `contact` (string, matched by name, required), `kind` (interaction_kind, required), `summary` (string, required), `occurred_at` (timestamptz, optional, default now), `source` (interaction_source, optional, default agent)
- Returns: created interaction

### 3.8 Lists (5 tools)

**`list_lists`**
- Params: none
- Returns: all lists with item counts and item_schema

**`create_list`**
- Params: `name` (string, required), `kind` (list_kind, optional, default custom), `description` (string, optional), `icon` (string, optional), `item_schema` (jsonb, optional, default [])
- Returns: created list

**`list_items`**
- Params: `list` (string, matched by name, required), `status` (list_item_status, optional)
- Returns: items with metadata, ordered by sort_order

**`create_list_item`**
- Params: `list` (string, matched by name, required), `title` (string, required), `metadata` (object, optional — keys validated against the list's item_schema; unknown keys are rejected, types are checked), `status` (list_item_status, optional, default open)
- Validation: fetches the list's `item_schema`, checks that all provided metadata keys exist in the schema and values match the declared type. Unknown keys are rejected with an error listing valid keys.
- Returns: created item

**`update_list_item`**
- Params: `id` (uuid) or `title` (string) + `list` (string) to identify; any mutable field (title, status, metadata, sort_order)
- Returns: updated item

### 3.9 Activity Logs (2 tools)

**`list_activities`**
- Params: `type` (activity_type, optional), `since` (date, optional)
- Returns: activity logs with workout_sets included for gym sessions

**`log_activity`**
- Params: `type` (activity_type, required), `occurred_at` (timestamptz, optional — tool defaults to now(); note: DB column has no default so the tool must always provide a value), `duration_min` (number, optional), `note` (string, optional), `details` (jsonb, optional — freeform activity details), `location` (string, optional — matched by name), `workout_sets` (array, optional — each: `exercise` string, `set_number` int, `reps` int, `weight_kg` number, `rpe` number, `note` string optional)
- Business logic: matches exercise names to `exercise_id` in the catalogue. If an exercise name is not found, inserts the set with `exercise_id = null` (FK is nullable) and returns a warning suggesting the exercise be added to the catalogue. Creates activity_log row first, then workout_sets referencing it.
- Returns: created activity with sets (and any exercise-resolution warnings)

### 3.10 Links (2 tools)

**`list_links`**
- Params: `entity_type` (string, required), `entity_id` (uuid) or `entity_name` (string, required) — finds links where this entity is src or dst
- Returns: linked entities with resolved names

**`create_link`**
- Params: `src_type` (string, required), `src` (string, matched by name, required), `dst_type` (string, required), `dst` (string, matched by name, required), `relation` (link_relation, required)
- Sets `created_by = 'agent'` (link_creator enum), `suggested = false`
- Returns: created link

### 3.11 Views / Aggregates (5 tools)

**`today_agenda`**
- Params: none
- Returns: data from `today_agenda` view — due/overdue tasks, scheduled habits, today's events, overdue follow-ups

**`project_progress`**
- Params: `project` (string, optional — if omitted, returns all)
- Returns: per-project stats from the view

**`area_progress`**
- Params: `area` (life_area, optional), `horizon` (goal_horizon, optional)
- Returns: per-area, per-horizon aggregated goal progress from the `area_progress` view (migration 003). Columns: `goal_count`, `avg_pct`.

**`weekly_review`**
- Params: `week` (date, optional — defaults to current week)
- Returns: summary stats from the `weekly_review` view, filtered to the matching week

**`exercises_available`**
- Params: `location` (string, optional — matched by name; if omitted, returns all locations)
- Returns: exercises available at the location from the `exercises_available` view

## 4. Cross-cutting concerns

### 4.1 Name-based entity resolution

Most tools accept entity names (not just UUIDs) for usability. Resolution rules:
- Case-insensitive `ILIKE '%term%'` substring match
- If exactly one match: use it
- If multiple matches: return the matches and ask for clarification
- If no match: return an error listing all entities of that type (for small tables) or suggest using a more specific term

This keeps Telegram conversations natural ("complete the tax filing task" instead of "complete task 7a3f...").

Implementation: a shared `resolve.ts` module with a generic `resolveByName(table, nameColumn, searchTerm)` function used by all tools.

### 4.2 Audit logging

Every write operation inserts a row into `agent_actions`:
```
user_id, actor (from LIFEOS_ACTOR env), action (insert/update/delete),
table_name, record_id, details (jsonb with before/after state)
```

### 4.3 Soft deletes

All delete operations set `archived_at = now()`. No hard deletes. All list operations filter `archived_at is null` by default.

### 4.4 Error handling

Tools return structured errors:
- `not_found` — entity doesn't exist or is archived
- `ambiguous` — multiple matches for a name, includes candidates
- `validation_error` — invalid enum value, missing required field, etc.
- `db_error` — Supabase error passed through

## 5. File structure

```
mcp/
  package.json          — deps: @modelcontextprotocol/sdk, @supabase/supabase-js, zod, dotenv
  tsconfig.json
  .env.example          — SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, LIFEOS_USER_ID, LIFEOS_ACTOR
  src/
    index.ts            — MCP server bootstrap, startup validation, tool registration
    supabase.ts         — Supabase client init, USER_ID constant, audit helper
    resolve.ts          — Name-based entity resolution (ILIKE matching)
    tools/
      tasks.ts          — list_tasks, create_task, update_task, complete_task, delete_task
      projects.ts       — list_projects, create_project, update_project, delete_project
      goals.ts          — list_goals, create_goal, update_goal, delete_goal
      habits.ts         — list_habits, log_habit, create_habit, update_habit, delete_habit
      notes.ts          — list_notes, create_note, update_note, delete_note
      contacts.ts       — list_contacts, create_contact, update_contact, delete_contact
      interactions.ts   — list_interactions, create_interaction
      lists.ts          — list_lists, create_list, list_items, create_list_item, update_list_item
      activities.ts     — list_activities, log_activity
      links.ts          — list_links, create_link
      views.ts          — today_agenda, project_progress, area_progress, weekly_review, exercises_available
```

## 6. Deployment

All three deployments load Supabase credentials via `dotenv` from a `.env` file. The `LIFEOS_ACTOR` env var is set per-deployment (via `.env` or MCP config env block).

### 6.1 Hermes (Hetzner VPS — 204.168.139.178)

1. Build: `npm run build` (compiles TS to JS in `dist/`)
2. Deploy: `rsync` or `scp` the `mcp/` directory to `/opt/lifeos-mcp/` on the VPS
3. Install deps: `cd /opt/lifeos-mcp && npm install --production`
4. Create `.env` with production values (keys from 1Password). Set file permissions: `chmod 600 .env`
5. Register: `hermes mcp add lifeos --command "node /opt/lifeos-mcp/dist/index.js"`
6. `.env` must contain: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LIFEOS_USER_ID`, `LIFEOS_ACTOR=hermes`

### 6.2 Claude Desktop (Windows)

Add to `%APPDATA%\Claude\claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "lifeos": {
      "command": "node",
      "args": ["C:\\dev\\LifeOS\\mcp\\dist\\index.js"],
      "env": {
        "LIFEOS_ACTOR": "claude_desktop"
      }
    }
  }
}
```
Supabase credentials and `LIFEOS_USER_ID` in `C:\dev\LifeOS\mcp\.env` (loaded by dotenv).

### 6.3 Claude Code

Add to project MCP config (`.claude/settings.json` or via `claude mcp add`):
```json
{
  "mcpServers": {
    "lifeos": {
      "command": "node",
      "args": ["C:\\dev\\LifeOS\\mcp\\dist\\index.js"],
      "env": {
        "LIFEOS_ACTOR": "claude_code"
      }
    }
  }
}
```
Supabase credentials and `LIFEOS_USER_ID` in `C:\dev\LifeOS\mcp\.env` (loaded by dotenv).

## 7. Dependencies

- `@modelcontextprotocol/sdk` — MCP server SDK
- `@supabase/supabase-js` — database client
- `zod` — runtime input validation for tool parameters
- `dotenv` — env var loading
- `typescript` (dev) — compilation

## 8. Security

- The service role key **must never be committed to the repo**. `.env` is in `.gitignore`. On the VPS, `.env` file permissions are `chmod 600`.
- `LIFEOS_USER_ID` is validated at startup — if missing or empty, the server exits with a clear error message. This prevents a misconfigured server from reading/writing data for all users.
- The service role key is the most sensitive credential. It lives in 1Password and is deployed manually to each environment's `.env`.

## 9. Out of scope for v1

- HTTP/SSE transport (stdio only)
- Key info table access (sensitive reference data — add deliberately later)
- Workout exercise catalogue management (CRUD on exercises/equipment/locations — read-only via `exercises_available` is included)
- Dashboard CRUD
- Document/event management (no Google sync yet)
- Batch operations
- Real-time subscriptions / notifications
- Failed operation audit logging (only successful writes are logged in v1)
