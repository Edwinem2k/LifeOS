# Life OS Phase 1 — Design Specification

**Date:** 2026-08-18
**Status:** Approved
**Scope:** Next.js app scaffold, design system, data layer, Projects/Tasks/Goals UI, Today view

## 1. Context

Life OS is a personal operating system replacing Notion. The database layer (Supabase) is complete with 21 tables, 6 views, RLS, and MCP access for agents. Phase 1 builds the first web UI — the daily-driver app for managing projects, tasks, and goals.

The OVER1 codebase (a friend's task manager built on the same stack) was assessed. Decision: cherry-pick UI patterns (table scroller, fly-out panel, toast, dialogs, inline editing, progress rings) into a fresh scaffold with a proper data layer.

## 2. Stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Next.js 15 (App Router, React 19, TypeScript) | Same as OVER1; modern, SSR-ready |
| Styling | Tailwind CSS 4 + CSS custom properties for tokens | Utility-first, token-driven theming |
| Components | shadcn/ui (Radix primitives, owned source) | Accessible, customisable, no black boxes |
| Data fetching | TanStack Query + thin Supabase service layer | Caching, optimistic updates, cross-entity invalidation |
| Icons | Lucide React | Consistent, tree-shakeable |
| Database | Supabase (supabase-js client) | Already deployed with schema |
| Auth | Supabase Auth (email + password) | Single user, RLS-ready |

## 3. Visual Direction

**Palette:** Parchment & Terracotta (warm, calm, personal)

| Token | Value | Usage |
|---|---|---|
| `--bg-page` | `#faf8f4` | Page background |
| `--bg-card` | `#f2ede5` | Card/surface background |
| `--bg-elevated` | `#ffffff` | Elevated elements (modals, popovers) |
| `--border` | `#e8e2d8` | Borders, dividers |
| `--text-primary` | `#2c2520` | Headings, body text |
| `--text-secondary` | `#a0958a` | Labels, muted text |
| `--text-muted` | `#c4b8a8` | Placeholders, disabled |
| `--accent-primary` | `#c4785a` | Terracotta — primary actions, active nav |
| `--accent-success` | `#6b9e6e` | Olive green — done, streaks, progress |
| `--accent-warning` | `#c49a5a` | Amber — in-progress, caution |
| `--accent-danger` | `#d4493a` | Warm red — overdue, errors, blocked |
| `--accent-info` | `#7a8f9e` | Blue-grey — informational |
| `--radius-sm` | `6px` | Buttons, inputs, pills |
| `--radius-md` | `10px` | Cards, panels |
| `--radius-lg` | `14px` | Larger containers |

**Dark mode:** Deferred. Tokens are CSS variables so retrofitting is a variable swap.

**Typography:** Inter (system fallback). Weights: 400 (body), 500 (labels), 600 (headings), 700 (hero).

## 4. Project Structure

```
src/
  app/
    (app)/                  # Authenticated layout group
      layout.tsx            # App shell: top nav + main content area
      page.tsx              # Today view (/ route)
      projects/page.tsx     # Projects list
      tasks/page.tsx        # Tasks table + kanban
      goals/page.tsx        # Goals tree
    login/page.tsx          # Auth page
    layout.tsx              # Root layout (providers, fonts, metadata)
  components/
    ui/                     # shadcn/ui primitives
    app/                    # App-specific composites
      AppNav.tsx            # Top navigation bar
      FlyoutPanel.tsx       # Generic slide-in detail pane
      DataTable.tsx         # Generic frozen-column scrollable table
      EditableCell.tsx      # Click-to-edit with onSave callback
      ProgressRing.tsx      # SVG donut progress
      StatusPill.tsx        # Coloured status badge
      FilterBar.tsx         # Search + filter pills toolbar
      QuickAdd.tsx          # Inline add row
      Toast.tsx             # Global toast notifications
  services/                 # Supabase call wrappers
    projects.ts
    tasks.ts
    goals.ts
    links.ts
    views.ts                # project_progress, goal_progress, today_agenda
  hooks/                    # TanStack Query hooks
    use-projects.ts
    use-tasks.ts
    use-goals.ts
    use-today.ts
    use-project-progress.ts
    use-goal-progress.ts
  lib/
    supabase-client.ts      # Browser Supabase client
    supabase-server.ts      # Server-side Supabase client
    query-provider.tsx      # TanStack QueryClientProvider wrapper
    types.ts                # Generated DB types
    constants.ts            # Enum labels, area colours, status mappings
  styles/
    tokens.css              # CSS custom properties
  middleware.ts              # Auth redirect for unauthenticated requests
```

## 5. Data Layer

### Pattern

```
Component -> hook (TanStack Query) -> service function -> supabase-js -> Postgres
```

Components never import supabase directly.

### Service layer (`services/`)

Each file exports typed async functions:

```ts
// services/projects.ts
export async function getProjects(): Promise<Project[]>
export async function getProject(id: string): Promise<Project>
export async function createProject(data: ProjectInsert): Promise<Project>
export async function updateProject(id: string, data: ProjectUpdate): Promise<Project>
export async function archiveProject(id: string): Promise<void>
```

All functions:
- Filter `archived_at is null` by default
- Include `user_id` from the auth session
- Return typed data (from generated types)
- Throw on error (TanStack Query catches and exposes via `error`)

### Hook layer (`hooks/`)

Each file wraps service functions with TanStack Query:

```ts
// hooks/use-projects.ts
export function useProjects(filters?) {
  return useQuery({ queryKey: ['projects', filters], queryFn: () => getProjects(filters) })
}
export function useCreateProject() {
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] })
  })
}
```

Cross-entity invalidation: completing a task invalidates both `['tasks']` and `['project-progress']`.

### Realtime

TanStack Query's `refetchOnWindowFocus` handles most staleness. For agent-written data appearing promptly, subscribe to a Supabase Realtime channel on key tables (projects, tasks, goals) and call `queryClient.invalidateQueries()` on changes. This is additive — implement after core CRUD works.

### Loading and error states

- Loading: skeleton placeholders matching the content layout (not spinners)
- Error: inline error message with retry button; no full-page error screens
- Mutations: optimistic updates with rollback on error + toast notification

### Type generation

Run `npx supabase gen types typescript` to produce DB types. Import as `Database` type. Derive row/insert/update types per table.

## 6. Navigation

Top bar layout:
- Left: "Life OS" wordmark
- Centre/right: **Today** | **Projects** | **Tasks** | **Goals** | **More** (dropdown)
- Active item: terracotta underline

"More" dropdown holds items as they ship in later phases: Habits (Phase 2), CRM (Phase 3), Notes, Lists (Phase 4).

Responsive: on mobile, nav collapses to a bottom tab bar with the same priority items.

## 7. Pages

### 7.1 Today (home route `/`)

The daily home screen. Single scrollable column.

**Sections:**
1. Greeting: "Good morning, Axel" + date + summary counts
2. Due/overdue tasks (from `today_agenda` view, item_type='task')
3. Today's habits with logged-today status (item_type='habit')
4. Today's events (item_type='event')
5. Overdue follow-ups (item_type='follow_up') — hidden until CRM ships

Each task: checkbox + title + project pill + priority. Check completes it (optimistic).
Each habit: name + tap-to-log (optimistic). Shows streak count.

### 7.2 Projects (`/projects`)

**List view** with columns: name, status pill, area badge, priority, progress bar + % (from `project_progress`), target date.

Click a row → **fly-out panel** slides in from the right. Panel shows editable fields: name, description, current_status, next_steps, outcome, success_check, status, priority, area, target_date, colour. Inline edit on blur (save callback pattern). Task count summary from `project_progress`.

Toolbar: search + filter by status, area.

### 7.3 Tasks (`/tasks`)

**Table view** (default): frozen title column, horizontal scroll for other columns. Columns: title (frozen), status, priority, project, area, deadline.

- **Filter bar**: search + pills for status, project, area, priority
- **Quick-add row**: bottom of table, Enter to create
- **Subtasks**: expandable rows under parent tasks (indent + collapse toggle)
- **Kanban toggle**: switch to board grouped by status, cards draggable between columns
- **Kanban column mapping**: the 7 task statuses map to 4 kanban columns: **To Do** (inbox, next_action), **In Progress** (in_progress, waiting_for), **Blocked** (blocked), **Done** (done). Someday tasks are excluded from the kanban board (filtered out, accessible via table view filter).
- **Standalone tasks**: tasks without a project show "—" in the project column. They appear in Inbox and Today views and can link to goals directly.
- **Subtask depth**: table view renders up to 3 levels of nesting. Deeper subtasks are accessible by clicking into the parent.
- **Fly-out field types**: status (dropdown), priority (dropdown), area (dropdown), project (dropdown), deadline (date picker), title and notes (text input/textarea).

Click task title → fly-out panel with full details.

### 7.4 Goals (`/goals`)

**Tree view**: top-level goals listed with progress ring and area badge.

- Expand goal → key results (with their own progress)
- Expand key result → linked projects and tasks (from `links` table)
- All collapsed by default for a clean overview

Progress data from `goal_progress` view. Progress ring colour based on % and status.

## 8. Ported OVER1 Components

These are extracted from `C:\dev\LifeOS\Getover1\over1-master\src\`, cleaned up, converted to TypeScript where needed, and restyled with Life OS tokens:

| Component | Source | Changes |
|---|---|---|
| DataTable (TableScroller) | `desktop/components/TableScroller.tsx` | Genericise column config, restyle |
| FlyoutPanel (ProjectPanel) | `desktop/components/ProjectPanel.tsx` | Accept field config + onSave callback |
| Toast | `components/Toast.tsx` | Restyle colours |
| Dialogs (confirm/prompt) | `desktop/components/dialogs.ts` | Restyle |
| EditableCell | `components/EditableCell.tsx` | Remove Supabase coupling, accept onSave |
| ProgressRing (Donut) | `desktop/pages/DashboardPage.tsx` | Extract, restyle |
| StatusPill | `app/globals.css` (CSS classes) | Map to new token colours |
| FilterBar (TableControls) | `desktop/components/TableControls.tsx` | Genericise, restyle |

## 9. Auth

Supabase Auth with email + password. Single user. Middleware redirects unauthenticated requests to `/login`. RLS enforces `user_id = auth.uid()` on all queries.

## 10. Not In Scope (Phase 1)

- Dedicated Habits page, heatmaps, and streaks dashboard (Phase 2). Note: the Today view includes basic habit check-ins (tap-to-log, streak count) as these are part of the daily home screen per the plan.
- CRM, Notes, Lists, Calendar, Documents, Dashboards
- Dark mode
- PWA offline mode
- Map/graph view
- Recurring tasks
- Time tracking
- Mobile-specific layouts (responsive CSS only)

## 11. Definition of Done

- Projects, tasks, and goals manageable via the web app
- Progress bars, status pills, and tree views render correctly from DB views
- Fly-out panels allow inline editing
- Today view shows a useful daily overview
- Data written via Claude MCP appears in the UI (Supabase Realtime or refetch)
- Notion retired for work planning
