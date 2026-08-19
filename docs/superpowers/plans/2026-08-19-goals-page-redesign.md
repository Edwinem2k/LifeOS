# Goals Page Redesign — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the tree-based Goals page with an area-grouped card layout featuring collapsible KRs, progress strip, bi-directional linking to projects/tasks, and goal flyout panel.

**Architecture:** Goals and KRs share the `goals` table (distinguished by `kind`). KR-to-entity links use the `links` table. A new `goal_progress` view computes effective progress from KR completion counts. The page groups goals by life area with a progress strip header. All linking originates from the Goals flyout.

**Tech Stack:** Next.js 16, React 19, TanStack Query v5, Supabase, Tailwind v4, Lucide icons.

**Spec:** `docs/superpowers/specs/2026-08-19-goals-page-redesign.md`

**No test framework configured** — verification is via `npm run build` (type/compile check) and manual dev server testing.

---

## File Structure

### New files
- `supabase/migrations/003_goals_redesign.sql` — view migrations
- `src/hooks/use-area-progress.ts` — progress strip data hook

### Modified files
- `src/lib/constants.ts` — fix GOAL_STATUSES, add HORIZONS
- `src/services/goals.ts` — add KR CRUD, update createGoal user_id pattern
- `src/services/links.ts` — add KR linking helpers
- `src/services/views.ts` — add getAreaProgress()
- `src/hooks/use-goals.ts` — add KR hooks, push-to-project/task hooks
- `src/hooks/use-goal-progress.ts` — update for new view columns
- `src/hooks/use-links.ts` — add mutation hooks
- `src/app/(app)/goals/page.tsx` — full rewrite
- `src/app/(app)/projects/page.tsx` — add Goal column
- `src/app/(app)/tasks/page.tsx` — add Goal column

---

## Chunk 1: Data Layer (Migration + Constants + Services + Hooks)

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/003_goals_redesign.sql`

- [ ] **Step 1: Write migration file**

```sql
-- 003_goals_redesign.sql
-- Replaces goal_progress view with KR-based progress calculation
-- Adds area_progress view for progress strip

-- Drop old view
drop view if exists goal_progress;

-- Recreate with KR-based progress
create or replace view goal_progress as
with kr_stats as (
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
  case
    when g.target_value > 0
      then round(least(100.0 * coalesce(g.current_value, 0) / g.target_value, 100), 1)
    else null
  end as direct_pct,
  coalesce(kr.kr_count, 0) as kr_count,
  coalesce(kr.kr_done_count, 0) as kr_done_count,
  kr.kr_pct,
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

-- Area progress for progress strip
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

- [ ] **Step 2: Apply migration to Supabase**

Run the SQL in Supabase SQL Editor (Dashboard → SQL Editor → paste and run), or via CLI:
```bash
cd C:\dev\LifeOS
npx supabase db push
```

- [ ] **Step 3: Verify views work**

In Supabase SQL Editor:
```sql
select * from goal_progress limit 5;
select * from area_progress;
```

- [ ] **Step 4: Commit**

```bash
cd C:\dev\LifeOS
git add supabase/migrations/003_goals_redesign.sql
git commit -m "$(cat <<'EOF'
feat: add KR-based goal_progress and area_progress views

Replaces old goal_progress view with KR completion counting.
Adds area_progress view for progress strip aggregation.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Fix constants

**Files:**
- Modify: `src/lib/constants.ts`

- [ ] **Step 1: Update GOAL_STATUSES to match DB enum**

Replace the existing GOAL_STATUSES array (lines 20-25) with:

```typescript
export const GOAL_STATUSES = [
  { value: "not_started", label: "Not Started", color: "var(--color-status-inbox)" },
  { value: "in_progress", label: "In Progress", color: "var(--color-status-in-progress)" },
  { value: "on_track", label: "On Track", color: "var(--color-accent-success)" },
  { value: "at_risk", label: "At Risk", color: "var(--color-accent-warning)" },
  { value: "done", label: "Done", color: "var(--color-status-done)" },
] as const;
```

Note: The old values `achieved` and `abandoned` never existed in the DB enum (`goal_status`), so no data migration is needed. The STATUS_MAP and `getStatusColor`/`getStatusLabel` helpers already handle the `goal:` prefix correctly — just updating the array values is sufficient.

- [ ] **Step 2: Add HORIZONS constant**

Add after GOAL_STATUSES:

```typescript
export const HORIZONS = [
  { value: "annual", label: "Annual" },
  { value: "q1", label: "Q1" },
  { value: "q2", label: "Q2" },
  { value: "q3", label: "Q3" },
  { value: "q4", label: "Q4" },
] as const;
```

No changes needed to `getStatusColor`/`getStatusLabel` — the existing STATUS_MAP pattern with `goal:${status}` prefix already works correctly.

- [ ] **Step 4: Verify build**

```bash
cd C:\dev\LifeOS && npm run build
```

- [ ] **Step 5: Commit**

```bash
cd C:\dev\LifeOS
git add src/lib/constants.ts
git commit -m "$(cat <<'EOF'
fix: align GOAL_STATUSES with DB enum, add HORIZONS constant

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Update services

**Files:**
- Modify: `src/services/goals.ts`
- Modify: `src/services/links.ts`
- Modify: `src/services/views.ts`

- [ ] **Step 1: Update goals.ts — add user_id auto-fetch and KR functions**

Add to `src/services/goals.ts`:

Replace the existing `createGoal` function to auto-fetch user_id (matching projects.ts pattern). Keep the typed signature:

```typescript
export async function createGoal(data: GoalInsert): Promise<Goal> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: created, error } = await supabase
    .from("goals")
    .insert({ ...data, user_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return created;
}
```

Add new functions after the existing ones:

```typescript
export async function createKeyResult(goalId: string, data: Partial<GoalInsert>): Promise<Goal> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: created, error } = await supabase
    .from("goals")
    .insert({
      ...data,
      user_id: user.id,
      kind: "key_result",
      parent_goal_id: goalId,
      status: "not_started",
    } as GoalInsert)
    .select()
    .single();
  if (error) throw error;
  return created;
}

export async function getKeyResultsForGoal(goalId: string): Promise<Goal[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .eq("parent_goal_id", goalId)
    .eq("kind", "key_result")
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getGoalsForEntities(
  entityType: "project" | "task",
  entityIds: string[]
): Promise<Record<string, { id: string; title: string }>> {
  if (entityIds.length === 0) return {};
  const supabase = createClient();
  // Get links where destination is one of our entities
  const { data: links, error: linkError } = await supabase
    .from("links")
    .select("src_id, dst_id")
    .eq("src_type", "key_result")
    .eq("dst_type", entityType)
    .eq("relation", "contributes_to")
    .in("dst_id", entityIds);
  if (linkError) throw linkError;
  if (!links?.length) return {};
  // Get KR parent goal IDs
  const krIds = links.map((l: any) => l.src_id);
  const { data: krs, error: krError } = await supabase
    .from("goals")
    .select("id, parent_goal_id")
    .in("id", krIds);
  if (krError) throw krError;
  // Get parent goals
  const goalIds = [...new Set((krs ?? []).map((kr: any) => kr.parent_goal_id).filter(Boolean))];
  if (goalIds.length === 0) return {};
  const { data: goals, error: goalError } = await supabase
    .from("goals")
    .select("id, title")
    .in("id", goalIds);
  if (goalError) throw goalError;
  // Build entity -> goal map
  const krToGoal: Record<string, any> = {};
  for (const kr of krs ?? []) {
    const goal = (goals ?? []).find((g: any) => g.id === kr.parent_goal_id);
    if (goal) krToGoal[kr.id] = goal;
  }
  const result: Record<string, { id: string; title: string }> = {};
  for (const link of links) {
    const goal = krToGoal[link.src_id];
    if (goal) result[link.dst_id] = goal;
  }
  return result;
}
```

- [ ] **Step 2: Update links.ts — add KR linking helpers**

Add to `src/services/links.ts`:

```typescript
export async function linkKRToEntity(
  krId: string,
  dstType: "project" | "task" | "habit",
  dstId: string
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("links")
    .insert({
      user_id: user.id,
      src_type: "key_result",
      src_id: krId,
      dst_type: dstType,
      dst_id: dstId,
      relation: "contributes_to",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function unlinkKR(linkId: string) {
  const supabase = createClient();
  const { error } = await supabase.from("links").delete().eq("id", linkId);
  if (error) throw error;
}

export async function getLinksForKR(krId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("links")
    .select("*")
    .eq("src_type", "key_result")
    .eq("src_id", krId)
    .eq("relation", "contributes_to");
  if (error) throw error;
  return data ?? [];
}

export async function getGoalForEntity(entityType: string, entityId: string) {
  const supabase = createClient();
  // Find link where this entity is the destination
  const { data: link, error: linkError } = await supabase
    .from("links")
    .select("src_id")
    .eq("dst_type", entityType)
    .eq("dst_id", entityId)
    .eq("src_type", "key_result")
    .eq("relation", "contributes_to")
    .maybeSingle();
  if (linkError) throw linkError;
  if (!link) return null;
  // Get the KR's parent goal
  const { data: kr, error: krError } = await supabase
    .from("goals")
    .select("parent_goal_id")
    .eq("id", link.src_id)
    .single();
  if (krError) throw krError;
  if (!kr?.parent_goal_id) return null;
  const { data: goal, error: goalError } = await supabase
    .from("goals")
    .select("id, title")
    .eq("id", kr.parent_goal_id)
    .single();
  if (goalError) throw goalError;
  return goal;
}
```

- [ ] **Step 3: Update views.ts — add getAreaProgress**

Add to `src/services/views.ts`:

```typescript
export async function getAreaProgress() {
  const supabase = createClient();
  const { data, error } = await supabase.from("area_progress").select("*");
  if (error) throw error;
  return data ?? [];
}
```

- [ ] **Step 4: Verify build**

```bash
cd C:\dev\LifeOS && npm run build
```

- [ ] **Step 5: Commit**

```bash
cd C:\dev\LifeOS
git add src/services/goals.ts src/services/links.ts src/services/views.ts
git commit -m "$(cat <<'EOF'
feat: add KR CRUD, linking helpers, and area progress service

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Update hooks

**Files:**
- Modify: `src/hooks/use-goals.ts`
- Modify: `src/hooks/use-goal-progress.ts`
- Modify: `src/hooks/use-links.ts`
- Create: `src/hooks/use-area-progress.ts`

- [ ] **Step 1: Update use-goals.ts — add KR hooks and push-to hooks**

Add to `src/hooks/use-goals.ts`:

```typescript
import { createKeyResult, getKeyResultsForGoal } from "@/services/goals";
import { createProject } from "@/services/projects";
import { createTask } from "@/services/tasks";
import { linkKRToEntity, unlinkKR as unlinkKRService } from "@/services/links";

export function useKeyResults(goalId: string | null) {
  return useQuery({
    queryKey: ["key-results", goalId],
    queryFn: () => getKeyResultsForGoal(goalId!),
    enabled: !!goalId,
  });
}

export function useCreateKeyResult() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ goalId, data }: { goalId: string; data: any }) =>
      createKeyResult(goalId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["goal-progress"] });
      qc.invalidateQueries({ queryKey: ["area-progress"] });
      qc.invalidateQueries({ queryKey: ["key-results"] });
    },
  });
}

export function usePushKRToProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ krId, title, area }: { krId: string; title: string; area: string }) => {
      const project = await createProject({ name: title, status: "idea", area } as any);
      await linkKRToEntity(krId, "project", project.id);
      return project;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["goal-progress"] });
      qc.invalidateQueries({ queryKey: ["area-progress"] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["links"] });
      qc.invalidateQueries({ queryKey: ["key-results"] });
    },
  });
}

export function usePushKRToTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ krId, title, area }: { krId: string; title: string; area: string }) => {
      const task = await createTask({ title, status: "inbox", area } as any);
      await linkKRToEntity(krId, "task", task.id);
      return task;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["goal-progress"] });
      qc.invalidateQueries({ queryKey: ["area-progress"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["links"] });
      qc.invalidateQueries({ queryKey: ["key-results"] });
    },
  });
}
```

- [ ] **Step 2: Update use-links.ts — add mutation hooks**

Add to `src/hooks/use-links.ts`:

```typescript
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { linkKRToEntity, unlinkKR as unlinkKRService } from "@/services/links";

export function useLinkKR() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ krId, dstType, dstId }: { krId: string; dstType: "project" | "task" | "habit"; dstId: string }) =>
      linkKRToEntity(krId, dstType, dstId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["goal-progress"] });
      qc.invalidateQueries({ queryKey: ["area-progress"] });
      qc.invalidateQueries({ queryKey: ["links"] });
      qc.invalidateQueries({ queryKey: ["key-results"] });
    },
  });
}

export function useUnlinkKR() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => unlinkKRService(linkId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      qc.invalidateQueries({ queryKey: ["goal-progress"] });
      qc.invalidateQueries({ queryKey: ["area-progress"] });
      qc.invalidateQueries({ queryKey: ["links"] });
      qc.invalidateQueries({ queryKey: ["key-results"] });
    },
  });
}
```

- [ ] **Step 3: Update use-goal-progress.ts — update for new view columns**

The existing hook returns the view data. The view columns have changed, but since types are `any`, the hook itself doesn't need code changes — it will return the new columns automatically. Just ensure the query key matches:

```typescript
// Verify this is the current content (no changes needed if so):
export function useGoalProgress() {
  return useQuery({
    queryKey: ["goal-progress"],
    queryFn: getGoalProgress,
  });
}
```

- [ ] **Step 4: Create use-area-progress.ts**

```typescript
import { useQuery } from "@tanstack/react-query";
import { getAreaProgress } from "@/services/views";

export function useAreaProgress() {
  return useQuery({
    queryKey: ["area-progress"],
    queryFn: getAreaProgress,
  });
}
```

- [ ] **Step 5: Verify build**

```bash
cd C:\dev\LifeOS && npm run build
```

- [ ] **Step 6: Commit**

```bash
cd C:\dev\LifeOS
git add src/hooks/use-goals.ts src/hooks/use-links.ts src/hooks/use-goal-progress.ts src/hooks/use-area-progress.ts
git commit -m "$(cat <<'EOF'
feat: add hooks for KR management, linking, and area progress

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 2: Goals Page UI

### Task 5: Build the new Goals page

**Files:**
- Modify: `src/app/(app)/goals/page.tsx` (full rewrite)

This is the largest task. The page has these sections:
1. Header with horizon tabs
2. Progress strip (Total + 7 areas)
3. Area sections with goal cards
4. Collapsible KR lists
5. Quick add per area
6. Flyout panel for goal editing

- [ ] **Step 1: Write the page skeleton with header and progress strip**

Rewrite `src/app/(app)/goals/page.tsx`:

```tsx
"use client";

import { useState, useMemo } from "react";
import { Plus, ChevronDown, ChevronRight, Link2, ArrowUpRight } from "lucide-react";
import { useGoals, useCreateGoal, useUpdateGoal, useCreateKeyResult, useKeyResults, usePushKRToProject, usePushKRToTask } from "@/hooks/use-goals";
import { useGoalProgress } from "@/hooks/use-goal-progress";
import { useAreaProgress } from "@/hooks/use-area-progress";
import { useLinkKR, useUnlinkKR } from "@/hooks/use-links";
import { useProjects } from "@/hooks/use-projects";
import { useTasks } from "@/hooks/use-tasks";
import { FlyoutPanel, FieldConfig } from "@/components/app/FlyoutPanel";
import { ProgressRing } from "@/components/app/ProgressRing";
import { StatusPill } from "@/components/app/StatusPill";
import { toast } from "@/components/app/Toast";
import { GOAL_STATUSES, HORIZONS, LIFE_AREAS } from "@/lib/constants";

const GOAL_FIELDS: FieldConfig[] = [
  {
    key: "status", label: "Status", type: "select", inline: true,
    options: GOAL_STATUSES.map((s) => ({ value: s.value, label: s.label })),
    displayAs: "pill", pillType: "status",
  },
  {
    key: "area", label: "Area", type: "select", inline: true,
    options: LIFE_AREAS.map((a) => ({ value: a.value, label: a.label })),
    displayAs: "pill", pillType: "area",
  },
  {
    key: "horizon", label: "Horizon", type: "select", inline: true,
    options: HORIZONS.map((h) => ({ value: h.value, label: h.label })),
  },
  { key: "due_date", label: "Due Date", type: "date", inline: true },
  { key: "target_value", label: "Target Value", type: "number", section: "Progress" },
  { key: "current_value", label: "Current Value", type: "number", section: "Progress" },
  { key: "unit", label: "Unit", type: "text", section: "Progress" },
  { key: "notes", label: "Notes", type: "textarea" },
];

export default function GoalsPage() {
  const { data: goals, isLoading, isError } = useGoals();
  const { data: progress } = useGoalProgress();
  const { data: areaProgress } = useAreaProgress();
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();

  const [selectedHorizon, setSelectedHorizon] = useState("annual");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedKRs, setExpandedKRs] = useState<Set<string>>(new Set());

  // Progress maps
  const progressMap = useMemo(() => {
    if (!progress) return {};
    return Object.fromEntries(progress.map((p: any) => [p.goal_id, p]));
  }, [progress]);

  const areaProgressMap = useMemo(() => {
    if (!areaProgress) return {};
    const map: Record<string, { avg_pct: number; goal_count: number }> = {};
    for (const ap of areaProgress as any[]) {
      // When "annual" tab is selected, aggregate across all horizons
      if (selectedHorizon === "annual" || ap.horizon === selectedHorizon || ap.horizon === "annual") {
        if (!map[ap.area]) map[ap.area] = { avg_pct: 0, goal_count: 0 };
        map[ap.area].avg_pct += (ap.avg_pct ?? 0) * (ap.goal_count ?? 0);
        map[ap.area].goal_count += ap.goal_count ?? 0;
      }
    }
    // Compute weighted average
    for (const area of Object.keys(map)) {
      if (map[area].goal_count > 0) {
        map[area].avg_pct = Math.round((map[area].avg_pct / map[area].goal_count) * 10) / 10;
      }
    }
    return map;
  }, [areaProgress, selectedHorizon]);

  const totalProgress = useMemo(() => {
    const areas = Object.values(areaProgressMap);
    if (areas.length === 0) return 0;
    const total = areas.reduce((sum, a) => sum + a.avg_pct, 0);
    return Math.round(total / areas.length);
  }, [areaProgressMap]);

  // Filter goals by horizon
  const filteredGoals = useMemo(() => {
    if (!goals) return [];
    return (goals as any[]).filter((g: any) => {
      if (g.kind !== "goal") return false;
      if (selectedHorizon === "annual") return true;
      return g.horizon === selectedHorizon || g.horizon === "annual";
    });
  }, [goals, selectedHorizon]);

  // Group by area
  const goalsByArea = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const g of filteredGoals) {
      const area = g.area ?? "work";
      if (!map[area]) map[area] = [];
      map[area].push(g);
    }
    return map;
  }, [filteredGoals]);

  const selected = useMemo(() => {
    if (!selectedId || !goals) return null;
    return (goals as any[]).find((g: any) => g.id === selectedId) ?? null;
  }, [selectedId, goals]);

  function toggleKR(goalId: string) {
    setExpandedKRs((prev) => {
      const next = new Set(prev);
      next.has(goalId) ? next.delete(goalId) : next.add(goalId);
      return next;
    });
  }

  function handleQuickAdd(area: string) {
    createGoal.mutate(
      { title: "New Goal", status: "not_started", area, horizon: selectedHorizon === "annual" ? "annual" : selectedHorizon } as any,
      { onSuccess: (created: any) => setSelectedId(created.id) }
    );
  }

  // Get KRs for a goal from the goals list (they have kind='key_result' and parent_goal_id)
  const getKRsForGoal = (goalId: string) => {
    if (!goals) return [];
    return (goals as any[]).filter((g: any) => g.kind === "key_result" && g.parent_goal_id === goalId);
  };

  if (isError) {
    return (
      <div className="max-w-[960px] mx-auto px-8 py-8 text-center">
        <p className="text-text-muted">Failed to load goals. Please try refreshing.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="max-w-[960px] mx-auto px-8 py-8">
        <div className="h-8 w-48 bg-card rounded animate-pulse mb-6" />
        <div className="h-20 bg-card rounded-lg animate-pulse mb-8" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="mb-6">
            <div className="h-6 w-32 bg-card rounded animate-pulse mb-3" />
            <div className="h-16 bg-elevated rounded-lg border border-border-default animate-pulse mb-2" />
            <div className="h-16 bg-elevated rounded-lg border border-border-default animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-[960px] mx-auto px-8 py-8">
      {/* Header */}
      <div className="flex items-end justify-between mb-7">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-text-primary">
            {new Date().getFullYear()} Goals
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Set in January · {filteredGoals.length} goal{filteredGoals.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-0.5 bg-card rounded-md p-0.5">
          {HORIZONS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setSelectedHorizon(tab.value)}
              className={`text-xs font-medium px-3.5 py-1.5 rounded transition-all ${
                selectedHorizon === tab.value
                  ? "bg-elevated text-text-primary shadow-sm"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Progress Strip */}
      <div className="flex gap-px bg-border-default rounded-lg overflow-hidden mb-10">
        {/* Total */}
        <div className="flex-1 bg-page py-3.5 px-3 text-center">
          <div className="text-[0.625rem] font-semibold uppercase tracking-wider text-text-secondary">
            Total
          </div>
          <div className="text-xl font-bold text-text-primary mt-1 tabular-nums">
            {totalProgress}%
          </div>
          <div className="h-[3px] rounded-full bg-card mt-2 overflow-hidden">
            <div
              className="h-full rounded-full bg-text-primary transition-all duration-500"
              style={{ width: `${totalProgress}%` }}
            />
          </div>
        </div>
        {/* Area segments */}
        {LIFE_AREAS.map((area) => {
          const ap = areaProgressMap[area.value];
          const pct = ap ? Math.round(ap.avg_pct) : 0;
          return (
            <div
              key={area.value}
              className="flex-1 bg-elevated py-3.5 px-2 text-center cursor-pointer hover:bg-card transition-colors"
            >
              <div className="text-[0.625rem] font-semibold uppercase tracking-wider text-text-secondary">
                <span
                  className="inline-block w-2 h-2 rounded-full mr-1 align-middle"
                  style={{ background: area.color }}
                />
                {area.label.length > 7 ? area.label.slice(0, 6) + "." : area.label}
              </div>
              <div className="text-xl font-bold text-text-primary mt-1 tabular-nums">
                {pct}%
              </div>
              <div className="h-[3px] rounded-full bg-card mt-2 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, background: area.color }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Area Sections */}
      {LIFE_AREAS.filter((area) => goalsByArea[area.value]?.length > 0).map((area) => {
        const areaGoals = goalsByArea[area.value] ?? [];
        const ap = areaProgressMap[area.value];
        return (
          <div key={area.value} className="mb-8">
            {/* Area Header */}
            <div className="flex items-center gap-3 mb-3 pb-2.5 border-b-2 border-border-default">
              <div className="w-1 h-7 rounded-sm" style={{ background: area.color }} />
              <h2 className="text-lg font-bold tracking-tight flex-1">{area.label}</h2>
              <span className="text-xs text-text-muted font-medium">
                {areaGoals.length} goal{areaGoals.length !== 1 ? "s" : ""}
                {ap ? ` · ${Math.round(ap.avg_pct)}%` : ""}
              </span>
            </div>

            {/* Goal Cards */}
            {areaGoals.map((goal: any) => {
              const prog = progressMap[goal.id];
              const pct = prog?.effective_pct ?? 0;
              const krs = getKRsForGoal(goal.id);
              const krCount = krs.length;
              const krDone = krs.filter((kr: any) => kr.status === "done").length;
              const isExpanded = expandedKRs.has(goal.id);

              return (
                <div
                  key={goal.id}
                  className="bg-elevated border border-border-default rounded-lg mb-2 overflow-hidden hover:shadow-sm transition-shadow"
                >
                  {/* Goal row */}
                  <div
                    className="flex items-center px-5 py-3.5 gap-4 cursor-pointer"
                    onClick={() => setSelectedId(goal.id)}
                  >
                    <ProgressRing value={pct} size={40} strokeWidth={3.5} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-text-primary">{goal.title}</div>
                      <div className="flex items-center gap-3 text-xs text-text-muted mt-0.5">
                        {krCount > 0 && (
                          <span className="font-medium text-text-secondary">
                            {krDone} / {krCount} key results
                          </span>
                        )}
                        {goal.due_date && <span>Due: {new Date(goal.due_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
                      </div>
                    </div>
                    {goal.status && <StatusPill value={goal.status} type="status" />}
                    <button
                      className={`text-text-muted transition-transform ${isExpanded ? "" : "-rotate-90"}`}
                      onClick={(e) => { e.stopPropagation(); toggleKR(goal.id); }}
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>

                  {/* Key Results */}
                  {isExpanded && krCount > 0 && (
                    <div className="border-t border-border-default bg-[#f5f5f4]">
                      {krs.map((kr: any) => {
                        const krPct = kr.target_value > 0
                          ? Math.round(Math.min(100, (kr.current_value ?? 0) / kr.target_value * 100))
                          : kr.status === "done" ? 100 : 0;
                        const isDone = kr.status === "done";
                        return (
                          <div
                            key={kr.id}
                            className="flex items-center gap-3 px-5 py-2.5 pl-[4.25rem] border-b border-black/[0.04] last:border-b-0 text-sm"
                          >
                            {/* Check circle */}
                            <div
                              className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                                isDone
                                  ? "bg-accent-success border-accent-success"
                                  : kr.status === "in_progress"
                                  ? "border-accent-primary"
                                  : "border-border-default"
                              }`}
                            >
                              {isDone && (
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2">
                                  <path d="M2 5l2 2 4-4" />
                                </svg>
                              )}
                            </div>
                            {/* Title */}
                            <span className={`flex-1 ${isDone ? "line-through text-text-muted" : "text-text-primary"}`}>
                              {kr.title}
                            </span>
                            {/* Progress bar */}
                            <div className="w-20 h-1 bg-[#e5e5e4] rounded-full overflow-hidden flex-shrink-0">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${krPct}%`,
                                  background: isDone ? "var(--color-accent-success)" : "var(--color-accent-primary)",
                                }}
                              />
                            </div>
                            {/* Value */}
                            <span className="text-xs font-semibold text-text-secondary min-w-[3.5rem] text-right tabular-nums">
                              {kr.target_value ? `${kr.current_value ?? 0} / ${kr.target_value}` : isDone ? "Done" : `${krPct}%`}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Quick Add */}
            <button
              className="flex items-center gap-2 w-full px-5 py-2.5 text-sm text-text-muted border border-dashed border-border-default rounded-md mt-1.5 hover:bg-elevated hover:text-text-secondary hover:border-text-muted transition-all"
              onClick={() => handleQuickAdd(area.value)}
            >
              <Plus size={14} />
              Add goal to {area.label}...
            </button>
          </div>
        );
      })}

      {/* Empty state */}
      {filteredGoals.length === 0 && !isLoading && (
        <div className="text-center py-16 text-text-muted">
          <p className="text-lg font-medium mb-2">No goals yet</p>
          <p className="text-sm">Add your first goal to get started.</p>
        </div>
      )}

      {/* Flyout Panel */}
      {selected && (
        <FlyoutPanel
          title={selected.title}
          titleField="title"
          fields={GOAL_FIELDS}
          data={selected}
          onSave={async (field, value) => {
            await updateGoal.mutateAsync({ id: selected.id, data: { [field]: value || null } });
          }}
          onClose={() => setSelectedId(null)}
          autoFocusTitle={selected.title === "New Goal"}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

```bash
cd C:\dev\LifeOS && npm run build
```

- [ ] **Step 3: Manual test on dev server**

```bash
cd C:\dev\LifeOS && npm run dev
```

Open http://localhost:3000/goals and verify:
- Header shows current year, horizon tabs work
- Progress strip shows Total + 7 areas
- Goals are grouped by area with prominent headers
- Progress rings show correct percentages
- KR toggle chevron expands/collapses
- Quick add creates a goal and opens flyout
- Flyout edits save correctly

- [ ] **Step 4: Commit**

```bash
cd C:\dev\LifeOS
git add src/app/\(app\)/goals/page.tsx
git commit -m "$(cat <<'EOF'
feat: rebuild Goals page with area-grouped cards and progress strip

Replaces tree view with card-based layout grouped by life area.
Progress strip with Total and per-area percentages. Collapsible
KR lists, quick add per area, flyout panel for editing.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Chunk 3: Flyout KR Management + Linking + Goal Column

### Task 6: Add KR management to the Goal flyout

The current flyout from Task 5 uses the standard FlyoutPanel for field editing. Now we need to add a custom KR section below it. Since FlyoutPanel doesn't support custom children, we'll build a custom flyout wrapper.

**Files:**
- Modify: `src/app/(app)/goals/page.tsx`

- [ ] **Step 1: Replace FlyoutPanel with custom GoalFlyout**

Replace the FlyoutPanel render at the bottom of the page with a custom component. Add this component definition above the `GoalsPage` export:

```tsx
function GoalFlyout({
  goal,
  onClose,
}: {
  goal: any;
  onClose: () => void;
}) {
  const updateGoal = useUpdateGoal();
  const createKR = useCreateKeyResult();
  const pushToProject = usePushKRToProject();
  const pushToTask = usePushKRToTask();
  const { data: allGoals } = useGoals();
  const { data: allProjects } = useProjects();
  const { data: allTasks } = useTasks();
  const linkKR = useLinkKR();
  const unlinkKR = useUnlinkKR();

  const [newKRTitle, setNewKRTitle] = useState("");
  const [showAddKR, setShowAddKR] = useState(false);
  const [linkingKR, setLinkingKR] = useState<{ krId: string; type: "project" | "task" } | null>(null);
  const [linkSearch, setLinkSearch] = useState("");

  // Get KRs from goals list
  const krs = useMemo(() => {
    if (!allGoals) return [];
    return (allGoals as any[]).filter(
      (g: any) => g.kind === "key_result" && g.parent_goal_id === goal.id
    );
  }, [allGoals, goal.id]);

  // No useLinks call here — link data for KR display is fetched per-KR when needed

  const hasKRs = krs.length > 0;

  async function handleSave(field: string, value: string) {
    await updateGoal.mutateAsync({ id: goal.id, data: { [field]: value || null } });
  }

  function handleAddKR() {
    if (!newKRTitle.trim()) return;
    createKR.mutate(
      { goalId: goal.id, data: { title: newKRTitle.trim() } },
      { onSuccess: () => { setNewKRTitle(""); setShowAddKR(false); } }
    );
  }

  function handlePushToProject(kr: any) {
    pushToProject.mutate(
      { krId: kr.id, title: kr.title, area: goal.area ?? "work" },
      { onSuccess: () => toast("Pushed to Projects", "success") }
    );
  }

  function handlePushToTask(kr: any) {
    pushToTask.mutate(
      { krId: kr.id, title: kr.title, area: goal.area ?? "work" },
      { onSuccess: () => toast("Pushed to Tasks", "success") }
    );
  }

  function handleLinkEntity(krId: string, dstType: "project" | "task", dstId: string) {
    linkKR.mutate(
      { krId, dstType, dstId },
      {
        onSuccess: () => {
          toast(`Linked ${dstType}`, "success");
          setLinkingKR(null);
          setLinkSearch("");
        },
      }
    );
  }

  const filteredLinkOptions = useMemo(() => {
    if (!linkingKR) return [];
    const items = linkingKR.type === "project" ? (allProjects ?? []) : (allTasks ?? []);
    const q = linkSearch.toLowerCase();
    return (items as any[])
      .filter((item: any) => {
        const name = item.name ?? item.title ?? "";
        return name.toLowerCase().includes(q);
      })
      .slice(0, 10);
  }, [linkingKR, allProjects, allTasks, linkSearch]);

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] max-w-full bg-elevated border-l border-border-default shadow-xl z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border-default">
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center bg-card rounded text-text-muted hover:text-text-primary"
        >
          ×
        </button>
        <input
          className="flex-1 text-lg font-semibold bg-transparent border-none outline-none text-text-primary"
          defaultValue={goal.title}
          onBlur={(e) => handleSave("title", e.target.value)}
          autoFocus={goal.title === "New Goal"}
        />
      </div>

      {/* Inline metadata */}
      <div className="flex gap-3 px-6 py-3 bg-[#f9f8f6] border-b border-border-default flex-wrap">
        {[
          { key: "status", label: "Status", options: GOAL_STATUSES, pillType: "status" as const },
          { key: "area", label: "Area", options: LIFE_AREAS, pillType: "area" as const },
          { key: "horizon", label: "Horizon", options: HORIZONS, pillType: undefined },
        ].map((field) => (
          <div key={field.key} className="flex flex-col gap-1 min-w-[100px]">
            <label className="text-[0.625rem] font-semibold uppercase tracking-wider text-text-muted">
              {field.label}
            </label>
            <select
              className="text-sm bg-elevated border border-border-default rounded px-2 py-1 text-text-primary"
              value={goal[field.key] ?? ""}
              onChange={(e) => handleSave(field.key, e.target.value)}
            >
              {field.options.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        ))}
        <div className="flex flex-col gap-1 min-w-[100px]">
          <label className="text-[0.625rem] font-semibold uppercase tracking-wider text-text-muted">
            Due Date
          </label>
          <input
            type="date"
            className="text-sm bg-elevated border border-border-default rounded px-2 py-1 text-text-primary"
            value={goal.due_date ?? ""}
            onChange={(e) => handleSave("due_date", e.target.value)}
          />
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {/* Progress (only when no KRs) */}
        {!hasKRs && (
          <div className="mb-5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Progress</h4>
            <div className="flex items-center gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs text-text-secondary">Target</span>
                <input
                  type="number"
                  className="w-20 text-sm bg-elevated border border-border-default rounded px-2 py-1"
                  value={goal.target_value ?? ""}
                  onChange={(e) => handleSave("target_value", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-text-secondary">Current</span>
                <input
                  type="number"
                  className="w-20 text-sm bg-elevated border border-border-default rounded px-2 py-1"
                  value={goal.current_value ?? ""}
                  onChange={(e) => handleSave("current_value", e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs text-text-secondary">Unit</span>
                <input
                  type="text"
                  className="w-20 text-sm bg-elevated border border-border-default rounded px-2 py-1"
                  value={goal.unit ?? ""}
                  onChange={(e) => handleSave("unit", e.target.value)}
                />
              </div>
            </div>
          </div>
        )}

        {/* KR progress summary (when KRs exist) */}
        {hasKRs && (
          <div className="mb-5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-1">Progress</h4>
            <p className="text-sm text-text-secondary">
              {krs.filter((kr: any) => kr.status === "done").length} / {krs.length} key results complete
            </p>
          </div>
        )}

        {/* Key Results */}
        <div className="mb-5">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">Key Results</h4>
          {krs.map((kr: any) => (
            <div key={kr.id} className="flex items-center gap-2 py-2 border-b border-black/[0.04] group">
              <div
                className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 cursor-pointer ${
                  kr.status === "done"
                    ? "bg-accent-success border-accent-success"
                    : "border-border-default hover:border-accent-primary"
                }`}
                onClick={() => {
                  const newStatus = kr.status === "done" ? "not_started" : "done";
                  updateGoal.mutate({ id: kr.id, data: { status: newStatus } });
                }}
              />
              <span className={`flex-1 text-sm ${kr.status === "done" ? "line-through text-text-muted" : ""}`}>
                {kr.title}
              </span>
              {/* Actions (visible on hover) */}
              <div className="hidden group-hover:flex items-center gap-1">
                <button
                  className="text-[0.625rem] text-accent-primary hover:underline"
                  onClick={() => handlePushToProject(kr)}
                  title="Push to Projects"
                >
                  → Project
                </button>
                <button
                  className="text-[0.625rem] text-accent-primary hover:underline"
                  onClick={() => handlePushToTask(kr)}
                  title="Push to Tasks"
                >
                  → Task
                </button>
                <button
                  className="text-[0.625rem] text-accent-primary hover:underline"
                  onClick={() => setLinkingKR({ krId: kr.id, type: "project" })}
                  title="Link existing"
                >
                  Link
                </button>
              </div>
            </div>
          ))}

          {/* Add KR */}
          {showAddKR ? (
            <div className="flex items-center gap-2 py-2">
              <input
                autoFocus
                className="flex-1 text-sm bg-transparent border-b border-border-default outline-none py-1"
                placeholder="Key result title..."
                value={newKRTitle}
                onChange={(e) => setNewKRTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddKR();
                  if (e.key === "Escape") { setShowAddKR(false); setNewKRTitle(""); }
                }}
              />
            </div>
          ) : (
            <div className="flex gap-2 mt-2 flex-wrap">
              <button
                className="text-sm text-accent-primary font-medium flex items-center gap-1"
                onClick={() => setShowAddKR(true)}
              >
                <Plus size={12} /> Add key result
              </button>
              <button
                className="text-xs text-accent-primary border border-dashed border-accent-primary rounded px-2 py-1"
                onClick={() => setLinkingKR({ krId: "", type: "project" })}
              >
                Link project
              </button>
              <button
                className="text-xs text-accent-primary border border-dashed border-accent-primary rounded px-2 py-1"
                onClick={() => setLinkingKR({ krId: "", type: "task" })}
              >
                Link task
              </button>
              <button
                className="text-xs text-text-muted border border-dashed border-border-default rounded px-2 py-1 cursor-not-allowed opacity-50"
                title="Coming soon"
                disabled
              >
                Link habit
              </button>
            </div>
          )}

          {/* Link search dropdown */}
          {linkingKR && (
            <div className="mt-2 border border-border-default rounded-lg bg-elevated p-3">
              <input
                autoFocus
                className="w-full text-sm border border-border-default rounded px-2 py-1.5 mb-2 outline-none"
                placeholder={`Search ${linkingKR.type}s...`}
                value={linkSearch}
                onChange={(e) => setLinkSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Escape") { setLinkingKR(null); setLinkSearch(""); } }}
              />
              <div className="max-h-40 overflow-y-auto">
                {filteredLinkOptions.map((item: any) => (
                  <button
                    key={item.id}
                    className="w-full text-left text-sm px-2 py-1.5 hover:bg-card rounded truncate"
                    onClick={() => {
                      // If linkingKR.krId is empty, we need to create a KR first then link
                      if (!linkingKR.krId) {
                        const title = item.name ?? item.title;
                        createKR.mutate(
                          { goalId: goal.id, data: { title } },
                          {
                            onSuccess: (created: any) => {
                              handleLinkEntity(created.id, linkingKR.type, item.id);
                            },
                          }
                        );
                      } else {
                        handleLinkEntity(linkingKR.krId, linkingKR.type, item.id);
                      }
                    }}
                  >
                    {item.name ?? item.title}
                  </button>
                ))}
                {filteredLinkOptions.length === 0 && (
                  <p className="text-xs text-text-muted px-2 py-1">No results</p>
                )}
              </div>
              <button
                className="text-xs text-text-muted mt-1"
                onClick={() => { setLinkingKR(null); setLinkSearch(""); }}
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {/* Notes */}
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-2">Notes</h4>
          <textarea
            className="w-full min-h-[80px] border border-border-default rounded-md p-3 text-sm resize-y bg-page text-text-primary"
            placeholder="Add notes about this goal..."
            defaultValue={goal.notes ?? ""}
            onBlur={(e) => handleSave("notes", e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
```

Then update the render in GoalsPage — replace the `<FlyoutPanel>` block with:

```tsx
{selected && <GoalFlyout goal={selected} onClose={() => setSelectedId(null)} />}
```

And remove the `FlyoutPanel` and `FieldConfig` imports since they're no longer used directly, as well as the `GOAL_FIELDS` constant.

- [ ] **Step 2: Add overlay backdrop**

Add a click-away backdrop before the GoalFlyout:

```tsx
{selected && (
  <>
    <div className="fixed inset-0 z-40" onClick={() => setSelectedId(null)} />
    <GoalFlyout goal={selected} onClose={() => setSelectedId(null)} />
  </>
)}
```

- [ ] **Step 3: Verify build**

```bash
cd C:\dev\LifeOS && npm run build
```

- [ ] **Step 4: Manual test**

```bash
cd C:\dev\LifeOS && npm run dev
```

Test:
- Open flyout by clicking a goal
- Status/Area/Horizon/Due Date fields work
- Progress fields show only when no KRs
- Add KR via "+ Add key result" (type, press Enter)
- Toggle KR done/not-done via check circle
- "→ Project" and "→ Task" buttons appear on hover
- Push to project creates a project and shows toast
- Link project/task opens search, selecting links it
- Link habit button is disabled
- Notes save on blur
- Click outside closes flyout

- [ ] **Step 5: Commit**

```bash
cd C:\dev\LifeOS
git add src/app/\(app\)/goals/page.tsx
git commit -m "$(cat <<'EOF'
feat: add custom GoalFlyout with KR management and linking

Unified KR list with add, push-to-project/task, and link-existing
functionality. Progress fields shown only for goals without KRs.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Add Goal column to Projects and Tasks tables

**Files:**
- Modify: `src/app/(app)/projects/page.tsx`
- Modify: `src/app/(app)/tasks/page.tsx`

- [ ] **Step 1: Add goal lookup hook**

Add to `src/hooks/use-goals.ts` (uses the `getGoalsForEntities` service function added in Task 3):

```typescript
import { getGoalsForEntities } from "@/services/goals";

export function useGoalsForEntities(entityType: "project" | "task", entityIds: string[]) {
  return useQuery({
    queryKey: ["entity-goals", entityType, entityIds],
    queryFn: () => getGoalsForEntities(entityType, entityIds),
    enabled: entityIds.length > 0,
  });
}
```

- [ ] **Step 2: Add Goal column to Projects page**

The Projects page uses `DataTable` with a `Column<any>[]` array. In `src/app/(app)/projects/page.tsx`:

1. Import: `import { useGoalsForEntities } from "@/hooks/use-goals";`

2. After `useProjects()`, add:
```typescript
const projectIds = useMemo(() => (projects ?? []).map((p: any) => p.id), [projects]);
const { data: projectGoals } = useGoalsForEntities("project", projectIds);
```

3. Add a "Goal" column object to the `columns` array after the "area" column:
```typescript
{
  key: "goal", header: "Goal", width: "120px",
  render: (row) => {
    const goal = projectGoals?.[row.id];
    return goal ? (
      <span className="text-xs px-1.5 py-0.5 bg-card rounded border border-border-default text-text-secondary truncate max-w-[100px] inline-block">
        {goal.title}
      </span>
    ) : null;
  },
},
```

- [ ] **Step 3: Add Goal column to Tasks page**

The Tasks page uses div-based custom table columns with a `ColWidths` type. In `src/app/(app)/tasks/page.tsx`:

1. Import: `import { useGoalsForEntities } from "@/hooks/use-goals";`

2. Add `goal: number` to the `ColWidths` type:
```typescript
type ColWidths = {
  task: number; status: number; priority: number; project: number; area: number; goal: number; deadline: number; notes: number;
};
```

3. Add default width in the `colWidths` initial state: `goal: 120`

4. After `useTasks()`, add:
```typescript
const taskIds = useMemo(() => (tasks ?? []).map((t: any) => t.id), [tasks]);
const { data: taskGoals } = useGoalsForEntities("task", taskIds);
```

5. Add "Goal" column header div after the "Area" header (matching existing pattern with resizable div headers):
```tsx
<div style={{ width: colWidths.goal }} className="...existing header classes...">
  Goal
</div>
```

6. Add Goal cell div in each row after the area cell (matching existing cell pattern):
```tsx
<div style={{ width: colWidths.goal }} className="...existing cell classes...">
  {taskGoals?.[node.id] ? (
    <span className="text-xs px-1.5 py-0.5 bg-card rounded border border-border-default text-text-secondary truncate max-w-[100px] inline-block">
      {taskGoals[node.id].title}
    </span>
  ) : null}
</div>
```

- [ ] **Step 4: Verify build**

```bash
cd C:\dev\LifeOS && npm run build
```

- [ ] **Step 5: Manual test**

Check Projects and Tasks pages — Goal column should show linked goal titles for any projects/tasks that have been linked via the Goals flyout.

- [ ] **Step 6: Commit**

```bash
cd C:\dev\LifeOS
git add src/hooks/use-goals.ts src/app/\(app\)/projects/page.tsx src/app/\(app\)/tasks/page.tsx
git commit -m "$(cat <<'EOF'
feat: add Goal column to Projects and Tasks tables

Shows linked goal title as a small pill. Data comes from
links table via KR parent_goal_id. Read-only.

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Final verification and deploy

- [ ] **Step 1: Full build check**

```bash
cd C:\dev\LifeOS && npm run build
```

- [ ] **Step 2: Full manual test on dev server**

```bash
cd C:\dev\LifeOS && npm run dev
```

Verify end-to-end:
1. Goals page loads with progress strip and area sections
2. Horizon tabs filter goals correctly
3. KRs expand/collapse under goal cards
4. Quick add creates goals in the correct area
5. Flyout opens, edits save, KRs can be added
6. Push to Project/Task creates entity and links
7. Link existing project/task works via search
8. Goal column shows in Tasks and Projects tables
9. Deleting a KR doesn't delete linked project (verify in Supabase)

- [ ] **Step 3: Push to GitHub**

```bash
cd C:\dev\LifeOS && git push
```

Vercel auto-deploys from main. Check the deployment at lifeos-beta-orcin.vercel.app.
