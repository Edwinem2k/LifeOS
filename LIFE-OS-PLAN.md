# Life OS — Project Plan & System Specification

**Owner:** Axel · **Status:** v1 draft, August 2026
**Purpose of this document:** The founding spec for the Life OS build. Drop it into the repo root and reference it in `CLAUDE.md`. Every Claude Code session should read this first.

---

## 1. Vision

A single personal operating system that holds all structured life data — projects, tasks, goals, habits, activity logs, contacts, notes, lists — in **one Postgres database (Supabase)**, accessible three ways:

1. **A custom web app (PWA)** — slick, purpose-built UI (OVER1 as the design/code basis), usable on desktop and mobile, readable offline.
2. **Claude (Code + Desktop)** — full read/write via the Supabase MCP server.
3. **Hermes** — chat-based agent with the same MCP access.

Google Calendar and Google Drive remain systems-of-record for events and documents respectively; the Life OS mirrors references so everything is linkable and queryable in one place.

### Design principles (non-negotiable)

1. **Postgres is the single source of truth.** No feature ships whose data lives only in app state, localStorage, or a third-party tool (Calendar/Drive excepted — see §6).
2. **Everything links to everything.** A universal linking model connects any entity to any other. A person mentioned in a note is one click from becoming a CRM link.
3. **Chat parity.** Anything the UI can do, an agent can do via SQL/MCP. Design tables and views so an LLM can operate them without reading app code — clear naming, comments on tables/columns, sensible defaults.
4. **Schema-first.** UI is a projection of the schema, never the other way round. Migrations are versioned in the repo (`supabase/migrations/`).
5. **Build thin.** Don't rebuild what Google/Supabase already do well (calendar recurrence, file storage, auth).
6. **Ship in phases.** Each phase ends with a working, daily-usable system. Notion is retired area by area, not big-bang.
7. **Boring infrastructure.** Managed Supabase cloud (not self-hosted — self-hosting means ~15 Docker services and you own backups/upgrades). Frontend on Vercel or the Hetzner box. One user, no premature scaling.

---

## 2. Architecture Overview

The system has three layers. Read top to bottom: **you (or an agent) act at the top, data lives in the middle, external services feed the bottom.**

```
┌──────────────────────────────────────────────────────────────┐
│  LAYER 1 — HOW YOU INTERACT (all three are equal citizens)   │
│                                                              │
│   Web app (PWA)      Claude Code/Desktop      Hermes agent   │
│   the polished UI    build + power-user       chat on any    │
│   desktop & mobile   chat access              platform       │
└───────────┬──────────────────┬──────────────────┬────────────┘
            │    every read/write goes to the     │
            ▼    same database (app: supabase-js; ▼
┌─────────────────  agents: Supabase MCP)  ────────────────────┐
│  LAYER 2 — WHERE ALL DATA LIVES (Supabase cloud)             │
│                                                              │
│   Postgres = single source of truth                          │
│   (projects, tasks, goals, habits, logs, CRM, notes, lists,  │
│    links, dashboards)                                        │
│   + Auth (login)  + Realtime (live UI updates)               │
│   + Edge functions (the "robots": sync jobs, pipelines)      │
└───────────┬──────────────────────────────────────────────────┘
            │  edge functions exchange data with ▼
┌──────────────────────────────────────────────────────────────┐
│  LAYER 3 — EXTERNAL SERVICES (each keeps its day job)        │
│                                                              │
│   Google Calendar → events mirrored in                       │
│   Google Drive    → documents referenced, stored there       │
│   Granola         → meeting transcripts → CRM summaries      │
│   Cognee          → receives a memory feed (separate DB)     │
│   1Password       → holds every secret; nothing else does    │
└──────────────────────────────────────────────────────────────┘
```

The one sentence that explains the whole system: **everything you do — in the app, via Claude, or via Hermes — reads and writes the same Postgres tables, and background jobs keep those tables in sync with Google, Granola, and Cognee.**

**Flow summary:**
- All three access layers read/write the same Postgres tables. The web app uses supabase-js (with Row Level Security); agents use the Supabase MCP server.
- Edge functions handle async work: calendar sync, call-summary ingestion, entity extraction, dashboard rollup refresh.
- Realtime pushes DB changes to the web app, so an edit made via Claude appears in the UI within seconds — this is the "magic" moment of the system.
- Cognee subscribes to a curated slice of the data (notes, goals, CRM summaries) for cross-model memory. Cognee is a consumer, never a writer of record.
- 1Password holds all API keys and tokens. Nothing sensitive in Postgres or the repo.

---

## 3. Data Layer

### 3.1 Core schema (Phase 1 tables)

All tables get: `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at` (trigger-maintained), `archived_at` (soft delete — agents must filter `archived_at is null`).

| Table | Purpose | Key columns |
|---|---|---|
| `projects` | Top-level work containers | `name`, `description`, `status` (idea/active/paused/done), `priority`, `area` (enum matching your 7 life areas), `target_date`, `color`, `sort_order` |
| `tasks` | Actionable items | `project_id fk (nullable)`, `parent_task_id fk` (subtasks — arbitrary depth), `title`, `status` (new/in_progress/blocked/done), `priority`, `deadline`, `estimate_hours`, `completed_at`, `sort_order` |
| `goals` | Outcomes with measurable progress | `title`, `area`, `horizon` (year/quarter/month), `target_value numeric`, `current_value numeric`, `unit`, `parent_goal_id fk` (goal hierarchy), `due_date` |
| `habits` | Recurring behaviours | `name`, `schedule jsonb` (e.g. `{"type":"per_week","count":3}` or `{"type":"daily","days":[1,3,5]}`), `metric_type` (boolean/count/duration/value), `target_value`, `active` |
| `habit_logs` | One row per completion | `habit_id fk`, `logged_at`, `value numeric`, `note` |
| `activity_logs` | Freeform IRL activity records | `activity_type` (gym/yoga/kitesurf/run/...), `occurred_at`, `duration_min`, `details jsonb` (e.g. exercises, sets, reps, weights), `note` |
| `contacts` | CRM | `full_name`, `nickname`, `relationship`, `company`, `location`, `emails jsonb`, `phones jsonb`, `birthday`, `how_met`, `last_interaction_at` (trigger-maintained), `follow_up_interval_days` |
| `interactions` | CRM history | `contact_id fk`, `kind` (call/meeting/message/note), `occurred_at`, `summary`, `source` (manual/auto_call/agent), `raw_ref` (pointer to transcript in Drive) |
| `notes` | Morning pages, freeform notes | `title`, `body markdown`, `kind` (morning_pages/note/meeting/journal), `note_date` |
| `lists` | Named lists | `name`, `kind` (movies/books/shopping/custom), `icon` |
| `list_items` | List contents | `list_id fk`, `title`, `status` (open/done), `metadata jsonb` (author, year, url...), `sort_order` |
| `documents` | Drive references | `drive_file_id`, `title`, `mime_type`, `url` |
| `events` | Google Calendar mirror (read-mostly) | `gcal_event_id`, `title`, `starts_at`, `ends_at`, `calendar_id`, `synced_at` |

### 3.2 Universal linking (the keystone table)

```sql
create table links (
  id uuid primary key default gen_random_uuid(),
  src_type text not null,   -- 'task','project','goal','contact','note','habit','activity_log','event','document','list_item'
  src_id   uuid not null,
  dst_type text not null,
  dst_id   uuid not null,
  relation text default 'related',  -- 'related','blocks','mentions','contributes_to','attended','about'
  created_by text default 'user',   -- 'user','agent','pipeline'
  created_at timestamptz default now(),
  unique (src_type, src_id, dst_type, dst_id, relation)
);
```

This single table powers: tasks↔goals, notes↔contacts (mentions), activity_logs↔goals (gym session contributes to fitness goal), events↔projects, documents↔anything. The UI shows a "Linked items" panel on every entity detail view; agents can traverse it with two queries.

**Entity extraction pipeline (Phase 3):** when a note/interaction is saved, an edge function sends the text to Claude with the contact list; it returns suggested `mentions` links, written with `created_by='pipeline'` and a `suggested` flag. UI shows suggestions for one-tap confirm — never silently auto-link people.

### 3.3 Computed views (progress bars for free)

Postgres views solve the Notion progress-bar pain permanently:

- `project_progress` — per project: total tasks, done tasks, % complete, blocked count, overdue count.
- `goal_progress` — per goal: `current_value/target_value`, plus rollup from child goals and linked task completion.
- `habit_stats` — per habit: current streak, longest streak, 30/90-day completion rate, **habit strength score** (exponentially weighted moving average of completions, so one missed day a month ago barely hurts — the model Loop Habit Tracker made popular, better than raw streaks).
- `weekly_review` — one row per week: tasks completed, habits %, activities logged, interactions had, notes written. Feeds the review dashboard and a weekly agent-generated summary.

Views are the API contract for both dashboards and agents. UI never re-computes what a view can provide.

### 3.4 Dashboards as data

```sql
create table dashboards (id, name, layout jsonb);
-- layout: [{"widget":"habit_heatmap","habit_id":"...","w":2,"h":1,"x":0,"y":0}, ...]
```

Widget library (Phase 1–2): progress bar, number card (with trend arrow), habit heatmap (GitHub-style year grid), streak counter, line/bar chart over any view, task list snippet, goal tree, upcoming events, "needs follow-up" contacts. Dashboards are user-composable in the UI — and because layout is data, you can also ask Claude "add a kitesurfing sessions chart to my fitness dashboard."

### 3.5 Schema amendments from review (18 Aug 2026)

These override §3.1 where they conflict; the migration implements this version.

1. **`projects` gains:** `current_status text` ("changes often" — one-liner), `next_steps text`, `notes text`, and optionally `outcome text` + `success_check text` (OVER1's "contract" fields — recommended, they force clarity on what done means). The **task summary is NOT a stored column** — it's rendered live from `project_progress` (counts, % complete, blocked/overdue) so it can never go stale. UI: OVER1-style fly-out detail pane on row click, editable inline.
2. **`tasks` gains `area`** (same enum). On task creation under a project, the app/agent copies the project's area as default; editable per task; standalone tasks set it directly. Kept as a real column (not derived) precisely so it can diverge.
3. **`lists` hybrid model:** base columns stay minimal (`name`, `description`, `notes` on the list; `title`, `status`, `sort_order` on items). Each list gains an **`item_schema jsonb`** — an array of custom field definitions (`[{"key":"recommended_by","label":"Recommended by","type":"text"}, ...]`) — and `list_items.metadata` holds the values. The UI renders `item_schema` fields as real columns per list; agents read the schema first, then write conforming metadata. Seed schemas: books (author, recommended_by, year), movies/tv (year, where_to_watch), travel (country, season), shopping (qty, urgency), games (platform). New custom lists start empty and grow fields as needed — custom columns without table sprawl.
4. **`documents` auto-sync:** realistic and standard. v1: a scheduled edge function (every ~15 min) calls the Drive **Changes API** with a stored page token, scoped to designated Life OS folders — adds/updates/removes `documents` rows accordingly. v2: Drive push notifications (watch channels → webhook) for near-instant sync; channels expire and need renewal, which is why polling ships first. Deletions in Drive set `archived_at`, never hard-delete.
5. **`events` gains `category`** (work | fun | life_admin | birthday | health | travel | other) + `category_source` (gcal_color | rule | llm | manual). Resolution order: (a) if you colour-code in Google Calendar, mirror its `colorId` via a mapping table; (b) else cheap rules (calendar name, "birthday" keyword, known contacts); (c) else a low-cost LLM classifies by title/attendees; (d) manual override in UI always wins and is remembered. UI colours events by category everywhere they appear.
6. **`key_info` split rule:** if it grants access (passwords, PINs, recovery codes, card numbers, API keys) → 1Password, never Supabase. If it's reference data you'd read out loud (NIF, car plate, meter numbers, policy/account *numbers* without credentials, addresses) → `key_info`. Litmus test: agents can read `key_info` via MCP — anything you wouldn't paste into a chat goes to 1Password.
7. **Dashboards deferred to last** (see revised phasing) — schema (§3.4) stays in migration 001 so nothing blocks it later.
8. **Workbook review outcomes:** `tasks.estimate_hours` **removed**. `tasks.priority` and `tasks.deadline` follow the same inheritance pattern as `area`: on creation under a project they default from the project (priority from project priority, deadline from project `target_date`), editable per task, and standalone tasks set them directly. `projects.sort_order` confirmed — it persists manual drag-and-drop ordering of projects in list views. `projects.color` retained as optional: it's the project's accent colour used wherever the project appears visually (kanban cards, timeline bars, future map nodes); auto-assigned from a palette on creation, changeable, ignorable. UUIDs (`id` columns everywhere) are internal only and never shown in the UI — rows are always addressed by name/title on screen.

---

## 4. Component Specifications

Each module lists v1 (must ship in its phase) and Dream (build when the foundation is stable). Dream features are informed by best-in-class tools researched Aug 2026.

### 4.1 Projects & Tasks — *Phase 1*

**v1**
- Projects list view with inline progress bars, status, priority, task counts (from `project_progress`).
- Tasks: table view (OVER1-style: status pills, priority, project, subproject, deadline, hours) + kanban board grouped by status, drag-and-drop.
- Subtasks via `parent_task_id`, rendered as expandable rows; parent progress = child completion %.
- Quick-add row (press Enter to create — friction kills task capture).
- Filters: project, status, priority, deadline; saved filter presets.
- "Today" view: due/overdue tasks + scheduled habits + today's events in one screen. This becomes the daily home page.

**Dream**
- Natural-language quick add ("call João re: taxes Friday p1" → parsed task) via a small LLM edge function.
- Task dependencies (`links` with `relation='blocks'`) with blocked-state auto-derived.
- Time tracking per task; weekly time-by-area chart.
- Recurring tasks (template + spawn rule).
- OVER1-style Map view: visual node graph of projects/tasks/ideas — committed for Phase 5 (see §9); the `links` table already stores the graph, so this is pure UI.

### 4.2 Goals — *Phase 1*

**v1**
- Goal hierarchy: yearly → quarterly → monthly, per life area.
- **Tree UI:** goals listed with progress; expand a goal to reveal its key results; expand a key result to reveal linked projects and tasks. Key results and the project/task layer are collapsed by default, so the default view stays a clean goal list.
- Progress from three sources, mixable: manual `current_value`, linked-task completion %, linked habit/activity counts ("kitesurf 30 sessions this year" auto-counts `activity_logs`).
- Goal detail page: progress ring, linked tasks/habits/activities, trend line.

**Dream**
- Weekly review flow: agent drafts a review (what moved, what stalled, suggested focus) from `weekly_review`; you edit and save as a note.
- Goal check-in reminders when a goal has had no linked activity for N days.

### 4.3 Habits & Activity Logs — *Phase 2*

The area where Notion failed you hardest; the bar here is a dedicated habit app, not Notion.

**v1**
- One-tap logging from the Today view (a check-in taking >10 seconds won't happen — this is the #1 lesson from every habit-app comparison).
- Flexible schedules: daily, specific weekdays, N-times-per-week (a 3x/week gym habit must not show "missed" on rest days).
- GitHub-style calendar heatmap per habit and combined; streak counters (current + longest); habit strength score.
- Activity logs with structured `details jsonb` — gym sessions store exercises/sets/reps/weights, feeding the strength-coach concept later.
- Log via chat: "log gym: bench 4x8@70kg, squats 4x6@100kg" → Hermes/Claude writes `activity_logs` with parsed details.

**Dream**
- Per-exercise progression charts (est. 1RM trend) — the foundation of the AI strength coach.
- Correlation hints ("morning pages days correlate with higher task completion") — fun once ~6 months of data exists.
- Apple Health / Garmin import via periodic export job.

**Locations, equipment & exercise availability (trainer foundation)**

Equipment isn't a flat list — it's location-scoped, so the trainer knows what's possible *where*:

| Table | Key columns | Purpose |
|---|---|---|
| `locations` | `name` (Primary gym, Home, Travel), `kind` | Places you train |
| `equipment` | `location_id fk`, `name` (squat rack, dumbbells 2–30kg, cable machine...), `notes` | What's available at each location |
| `exercises` | `name`, `muscle_groups text[]`, `required_equipment text[]` (empty = bodyweight), `notes` | Canonical exercise catalogue (seeded, extendable) |

A view `exercises_available (location_id, exercise)` returns every exercise whose `required_equipment` is satisfied by that location's equipment (bodyweight always qualifies). `activity_logs` gains a `location_id`, and `workout_sets.exercise` becomes a FK into `exercises` — so the trainer's query is simply: "exercises available at Primary gym, ranked by what my programme needs next and what's stalling." Migration note: your Notion Equipment DB seeds `equipment` under the Primary gym location.

### 4.4 CRM — *Phase 3*

**v1**
- Contact profiles: relationship, how met, birthday, location, notes, linked everything.
- Interaction timeline per contact; manual quick-log ("had lunch with Fátima").
- Follow-up engine: per-contact cadence → "due to reconnect" dashboard widget (the one feature dedicated personal CRMs like Monica get right and Notion can't).
- Birthday/important-dates feed.

**Dream (the meeting auto-summary pipeline — revised: no Granola subscription)**

Building bot-free system-audio capture from scratch isn't worth it (native desktop audio capture + real-time ASR is a product in itself), but the open-source world has already built it. Options researched Aug 2026, all free and local (Whisper-based, no meeting bots, work with any platform):
- **Hyprnote/anarlog** — the closest Granola clone: local audio capture, on-device Whisper transcription, every meeting saved as a markdown file on disk you can sync or process however you want.
- **Meetily** — cross-platform (Windows/macOS/Linux) local capture + Whisper transcription with pluggable summarisation (bring your own Claude/OpenAI key); free open-source community edition.
- **Minutes** — records and transcribes locally, writes structured markdown, and exposes MCP tools so agents can query conversation history directly.

**Pipeline (identical shape to the Granola version, zero subscription):** local tool transcribes → transcript lands as markdown in a watched folder (or via MCP) → edge function/agent summarises with a cheap model → `interactions` row with `source='transcriber'`, attendees matched to `contacts`. Trial one tool in Phase 3 week 1; the pipeline doesn't care which produces the transcript. Paid Granola remains the fallback if local capture proves flaky.
- v1 fallback either way: paste any transcript into Claude/Hermes chat — the agent summarises and files it, same table, `source='agent'`.
- Entity extraction: names in notes/interactions surface as suggested contact links (see §3.2).
- Pre-meeting briefing: calendar event with a known contact → agent prepares "last 3 interactions + open loops" note.

### 4.5 Notes & Lists — *Phase 4 (lists earlier if trivial)*

**v1**
- Markdown editor; morning-pages mode (dated, opens fresh page, streak-tracked as a habit).
- `[[wiki-style]]` mentions that create `links` rows to contacts/projects/goals.
- Lists: simple CRUD, checkable items, metadata per kind (books get author; movies get year), "suggest something from my list" works via chat for free.

**Dream**
- Backlinks panel ("mentioned in…") on every entity.
- Voice notes → transcription → note (mobile PWA share target).
- Weekly agent digest of notes → surfaced tasks ("you wrote 'must renew car inspection' on Tuesday — create task?").

### 4.6 Calendar & Timelines — *Phase 4*

**v1**
- One-way sync Google Calendar → `events` (edge function on schedule + webhook). GCal stays the write-surface for scheduling.
- Timeline view: projects/goals with target dates rendered as horizontal bars alongside events.
- Today view integrates events.

**Dream**
- Two-way: create GCal events from tasks ("block 2h for X Thursday").
- Time-audit dashboard: calendar time by area vs. stated goal priorities.

### 4.7 Documents — *Phase 4*

**v1**: `documents` rows referencing Drive files; attach to any entity via `links`; open-in-Drive. **Dream**: Drive folder auto-watch per project; agent-generated docs saved to Drive and auto-linked.

---

## 5. Access Layers

### 5.1 Web app
- **Stack (pending OVER1 review):** Next.js + TypeScript + Tailwind + supabase-js. If OVER1 uses this or close, adopt its stack wholesale; the codebase's main value is the polished UI patterns (table views, pills, kanban, map view).
- **PWA:** installable on iOS/Android; service worker caches app shell + last-fetched data → **read-only offline** (decided). Writes require connectivity; queued-offline-writes are explicitly out of scope until proven necessary.
- **Auth:** Supabase Auth, single user, email+password or magic link. RLS on all tables (`user_id = auth.uid()`) from day one — cheap now, painful to retrofit, and required the moment your partner or an advisor agent gets scoped access.
- **Hosting:** Vercel (simplest) or Hetzner behind Caddy. DB is managed Supabase either way.

### 5.2 Agent access (Claude Code, Claude Desktop, Hermes)
- **Supabase MCP server** configured in all three. Agents get a dedicated Postgres role: full CRUD on app tables, no DDL (schema changes only via migrations in Claude Code sessions with your review).
- **`CLAUDE.md` in the repo** documents: schema conventions, the linking model, "always filter archived_at", how to write habit/activity logs, view names. This file is what makes chat parity real — invest in it.
- A `SYSTEM.md` equivalent gets loaded into Hermes so both agents share the same operating manual.

### 5.3 Cognee
- **Cognee stays on its own Supabase project/database — do not merge it with the Life OS DB.** Cognee owns and migrates its own schema; mixing it with app tables couples two independently-evolving systems and complicates backups and agent permissions. The Life OS DB is the record; Cognee is a derived memory layer.
- Periodic export job: goals, recent notes, CRM summaries, weekly reviews → Cognee, so any model/channel has ambient context. One-directional.

### 5.4 Model routing (which AI does what)

You have a Claude Max plan and OpenAI API access. Route by job value, not habit:

| Job | Model | Why |
|---|---|---|
| Building the system (Claude Code sessions) | Claude (Max plan) | Best coding agent you already pay for; zero marginal cost |
| Daily chat driving (Claude Desktop) | Claude (Max plan) | Included in Max |
| Hermes default model | Claude via Anthropic API, or a strong OpenAI model | Hermes is model-agnostic; quality matters for the morning workplan |
| Call summarisation (edge function) | OpenAI low-cost mini model | High-volume, low-difficulty; pennies per call |
| Entity extraction / NL quick-add parsing | OpenAI low-cost mini model | Same — structured extraction is easy for small models |
| Personal trainer recommendations | Claude | Reasoning over training history is the hard, high-value job |
| Weekly review / morning briefing drafts | Claude | Synthesis quality is the whole point |

Rule of thumb: **cheap models for pipelines (per-event, automated), Claude for judgment (things you'll read).** Keep model choice a config value per edge function so you can swap freely.

### 5.5 The morning briefing (Hermes flagship use case)

The end-state ask: each morning, Hermes produces a workplan. This is the integration test for the entire system, and Hermes is well suited: it supports MCP servers natively (client built in; local stdio and remote HTTP servers; per-server tool filtering) and has **built-in cron scheduling with delivery to any of its 20+ chat platforms** — so a scheduled morning message needs no extra infrastructure.

Recipe (Phase 4+, once data exists):
1. Cron trigger 07:30 → Hermes runs a "morning briefing" skill.
2. Reads via MCP: today's `events`, due/overdue `tasks`, scheduled `habits`, contacts with birthdays or overdue follow-ups, yesterday's habit gaps; plus Gmail for emails needing replies (Hermes-side connector).
3. Claude synthesises a prioritised plan referencing your goals ("gym today keeps the 3x/week streak; kitesurf goal is 2 sessions behind").
4. Delivered to your channel of choice; each item is actionable by replying ("done", "push to tomorrow" → writes back via MCP).

Design consequence today: keep views agent-friendly (a `today_agenda` view joining all of the above makes the briefing one query).

---

## 6. Build Phases

**Phase 0 — Foundation (now; no OVER1 code needed)**
1. Create Supabase project; enable MCP; store keys in 1Password.
2. Repo scaffold: `supabase/migrations/`, `CLAUDE.md`, this plan.
3. Write and apply migration 001: all §3.1 tables + `links` + triggers + RLS.
4. Migration 002: the four core views (§3.3).
5. Wire Supabase MCP into Claude Code and Claude Desktop; smoke-test CRUD by chat.
6. Export Notion Personal Workplan → import script → `projects`/`tasks` (map Priorities→area, Status→status).
7. **Definition of done:** you can manage your real task list entirely through Claude chat, with data in Postgres.

**Phase 1 — Projects, Tasks, Goals UI (first OVER1-based build)**
- Assess OVER1 stack; fork/adapt the *mechanics* (table interactions, kanban, quick-add, map view code), not the visual identity.
- **Own design system, built first:** before any screens, define the Life OS look — name/logo, colour palette, typography, spacing, light+dark themes, component styles — as design tokens (Tailwind config + a small component library). Every OVER1 screen adopted gets reskinned to these tokens, so the tool feels like yours from day one and restyling later is a token change, not a rewrite. Use a dedicated Claude Code design session (frontend-design pass) to develop 2–3 visual directions to choose from.
- Ship: projects list w/ progress + fly-out detail pane, tasks table + kanban + subtasks, Today view, goals tree with progress. Tasks without a project are first-class (Inbox + Today surface them; they can link straight to goals via `links`). **DoD:** Notion retired for work planning; daily driver is the web app + chat.

**Phase 2 — Habits & Activity Logs**
- Habit engine, heatmaps, streaks, strength score, one-tap Today check-ins, chat logging of gym sessions. **DoD:** dedicated habit apps and Notion tracker retired.

**Phase 3 — CRM**
- Contacts, interactions, follow-up engine, local-transcription pipeline, entity-extraction suggestions. **DoD:** every meaningful conversation logged in <30 seconds via chat.

**Phase 4 — Notes, Lists, Calendar mirror (with category colours), Documents (with Drive auto-sync), PWA offline polish**
- **DoD:** Notion fully retired; system is the single home screen for life admin.

**Phase 5 — Custom dashboards (deliberately last, per review)**
- Widget library + composable dashboard builder over the views that now hold months of real data. **DoD:** at least one dashboard you check daily and one weekly-review dashboard.

**Phase 6+ (dream backlog):** map/graph view, strength coach, correlations, two-way calendar, pre-meeting briefings, advisor agents, health-data import, markdown export.

---

## 7. Non-Functional Requirements

- **Backups:** Supabase daily backups + weekly `pg_dump` to Drive via scheduled job. Test a restore once.
- **Migrations:** every schema change is a numbered migration file, applied via Supabase CLI. No console-only changes.
- **Observability:** simple `agent_actions` audit table (who/what/when for agent writes) — invaluable when debugging "who changed this task".
- **Performance:** single-user scale; indexes on all FKs, `(src_type,src_id)` and `(dst_type,dst_id)` on `links`, `logged_at`/`occurred_at` on log tables.
- **Security:** RLS everywhere; agent role without DDL; secrets in 1Password; no PII in repo.
- **Scalability path:** if a second user (partner) joins, RLS already isolates by `user_id`; shared entities become a `workspace_id` migration, not a rewrite.

---

## 8. First Claude Code Session — Task List

Paste this as the opening prompt:

> Read LIFE-OS-PLAN.md in full. §3.5 (schema amendments) and §4.3 (locations/equipment/exercises) override §3.1 where they differ. Execute Phase 0:
> 1. Scaffold the repo (supabase config, migrations dir, CLAUDE.md stub documenting schema conventions from §3 incl. §3.5, the linking model, and agent rules from §5.2).
> 2. Write migration 001: all tables from §3.1 as amended by §3.5 (projects with current_status/next_steps/notes/outcome/success_check; tasks with area/priority/deadline inheritance defaults and NO estimate_hours; lists with item_schema; events with category/category_source; key_info) plus the §4.3 trainer tables (locations, equipment, exercises, workout_sets with exercise FK), the links table, updated_at triggers, and RLS policies (user_id on every table).
> 3. Write migration 002: views from §3.3 (project_progress, goal_progress, habit_stats with EWMA strength score, weekly_review) plus exercises_available and today_agenda (§5.5).
> 4. Write `scripts/import_notion.ts` for the Tasks & Projects, Goals, Habits + Habit Log, Workout Log, Contacts, lists, Key Information, and Key Documents CSV exports, using the mapping in the schema workbook's "Notion mapping" tab (statuses/areas/horizons carry over 1:1; Blocked By/Blocking → links relation='blocks'; Goals' Projects/Habits relations → links relation='contributes_to'; Equipment DB → equipment under a seeded "Primary gym" location; Piglet Work stays in Notion for now).
> 5. Seed data: 2 projects, 5 tasks, 2 habits with logs, 1 goal with a key result, 1 location with equipment and 10 catalogue exercises — enough to verify every view.
> 6. Output the exact Supabase MCP config snippets for Claude Desktop and Hermes (mcp_servers key), using a dedicated agent role with CRUD but no DDL.
> Ask before any design decision not covered by the plan.

## 9. Design Notes & Resolved Decisions

**Resolved (researched Aug 2026):**
- **Hermes MCP: confirmed.** Hermes has a built-in MCP client (local stdio + remote HTTP servers, OAuth for hosted connectors, per-server tool filtering; config under the top-level `mcp_servers:` key). Point it at the Supabase MCP server with a scoped role. Its built-in cron + multi-platform delivery covers the morning briefing with no extra infrastructure.
- **Transcript source: Granola** via Zapier trigger (full transcript included) → edge function. Business plan (~$14/mo) required for Zapier; free-tier MCP excludes transcripts. Fallback: paste into chat.
- **Cognee: separate Supabase project** (already running) — keep it that way; see §5.3.
- **Obsidian:** not a system component — it would add a second store and violate "Postgres is the source of truth". But adopt its two good ideas: (1) note bodies are plain markdown, so any LLM reads them natively via MCP; (2) add a one-way nightly export of notes to a local markdown folder (Phase 5) if you ever want Obsidian as a *viewer* or grep-able archive. Morning pages live in `notes`, not in a vault.
- **Map/workflow view (OVER1): committed, Phase 5.** The `links` table already stores the full graph, so the map is a rendering layer, not a data feature. Improvements over OVER1's version: filter by area/project, node types styled by entity (goal/project/task/idea), progress shown on nodes, click-through to detail.
- **Multi-user: designed-in from day one.** Every table carries `user_id` with RLS; Supabase Auth handles signup. Solo mode until needed; partner signup later is configuration, not migration (shared workspaces would be one additional migration).
- **Life areas: carried over from Notion** — Money, Health, Growth, Work, Relationships, Play, Environment (confirmed by workspace audit).

**Still open:**

| # | Decision | Leaning | Decide by |
|---|---|---|---|
| 1 | Adopt OVER1 stack wholesale vs. reuse UI patterns in fresh scaffold | Assess codebase (sql/, src/, AGENT-RULES.md) in Claude Code | Phase 1 start |
| 2 | Frontend hosting: Vercel vs Hetzner | Vercel for speed | Phase 1 |
| 3 | Equipment DB destination (list vs key_info) | Flag in schema review | Phase 0 |
| 4 | Piglet Work DB — migrate or leave in Notion until departure completes | Leave for now | Phase 1 |
