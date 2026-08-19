"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { Plus, ChevronDown, X, Check, Search, ArrowRight, Link2 } from "lucide-react";
import { EditableCell } from "@/components/app/EditableCell";
import {
  useGoals,
  useCreateGoal,
  useUpdateGoal,
  useCreateKeyResult,
  useKeyResults,
  usePushKRToProject,
  usePushKRToTask,
} from "@/hooks/use-goals";
import { useGoalProgress } from "@/hooks/use-goal-progress";
import { useAreaProgress } from "@/hooks/use-area-progress";
import { useLinkKR, useUnlinkKR, useLinksForKRs } from "@/hooks/use-links";
import { useProjects } from "@/hooks/use-projects";
import { useTasks } from "@/hooks/use-tasks";
import { ProgressRing } from "@/components/app/ProgressRing";
import { StatusPill } from "@/components/app/StatusPill";
import { toast } from "@/components/app/Toast";
import { GOAL_STATUSES, HORIZONS, LIFE_AREAS } from "@/lib/constants";

/* ------------------------------------------------------------------ */
/*  GoalFlyout                                                        */
/* ------------------------------------------------------------------ */

function GoalFlyout({
  goal,
  goals,
  progressMap,
  onClose,
}: {
  goal: any;
  goals: any[];
  progressMap: Record<string, any>;
  onClose: () => void;
}) {
  const updateGoal = useUpdateGoal();
  const createKR = useCreateKeyResult();
  const pushToProject = usePushKRToProject();
  const pushToTask = usePushKRToTask();
  const linkKR = useLinkKR();
  const unlinkKR = useUnlinkKR();
  const { data: projects } = useProjects();
  const { data: tasks } = useTasks();
  const { data: keyResultsData } = useKeyResults(goal.id);

  // Fetch links for all KRs to know which are linked
  const krIds = useMemo(
    () => (goals ?? [])
      .filter((g: any) => g.kind === "key_result" && g.parent_goal_id === goal.id)
      .map((g: any) => g.id),
    [goals, goal.id]
  );
  const { data: krLinks } = useLinksForKRs(krIds);
  const linkedKRIds = useMemo(() => {
    if (!krLinks) return new Set<string>();
    return new Set(krLinks.map((l: any) => l.src_id));
  }, [krLinks]);

  const [title, setTitle] = useState(goal.title);
  const [notes, setNotes] = useState(goal.notes ?? "");
  const [addingKR, setAddingKR] = useState(false);
  const [newKRTitle, setNewKRTitle] = useState("");
  const [linkSearch, setLinkSearch] = useState<{
    krId: string | null;
    type: "project" | "task";
    query: string;
  } | null>(null);

  const titleRef = useRef<HTMLInputElement>(null);

  // Get KRs from the goals list (they have kind='key_result' + parent_goal_id)
  const krs = useMemo(
    () =>
      (goals ?? []).filter(
        (g: any) => g.kind === "key_result" && g.parent_goal_id === goal.id
      ),
    [goals, goal.id]
  );

  const prog = progressMap[goal.id];
  const hasKRs = krs.length > 0;
  const krDone = krs.filter((kr: any) => kr.status === "done").length;

  useEffect(() => {
    if (goal.title === "New Goal" && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [goal.title]);

  // Sync when goal changes externally
  useEffect(() => {
    setTitle(goal.title);
    setNotes(goal.notes ?? "");
  }, [goal.id, goal.title, goal.notes]);

  const saveField = async (field: string, value: any) => {
    try {
      await updateGoal.mutateAsync({ id: goal.id, data: { [field]: value || null } });
    } catch {
      toast("Failed to save", "error");
    }
  };

  const handleAddKR = async () => {
    if (!newKRTitle.trim()) return;
    try {
      await createKR.mutateAsync({
        goalId: goal.id,
        data: { title: newKRTitle.trim() },
      });
      setNewKRTitle("");
      setAddingKR(false);
      toast("Key result added", "success");
    } catch {
      toast("Failed to add key result", "error");
    }
  };

  const toggleKR = async (kr: any) => {
    const newStatus = kr.status === "done" ? "not_started" : "done";
    try {
      await updateGoal.mutateAsync({ id: kr.id, data: { status: newStatus } });
    } catch {
      toast("Failed to update", "error");
    }
  };

  const handlePushToProject = async (krId: string, krTitle: string) => {
    try {
      await pushToProject.mutateAsync({
        krId,
        title: krTitle,
        area: goal.area ?? "",
      });
      toast("Project created and linked", "success");
    } catch {
      toast("Failed to create project", "error");
    }
  };

  const handlePushToTask = async (krId: string, krTitle: string) => {
    try {
      await pushToTask.mutateAsync({
        krId,
        title: krTitle,
        area: goal.area ?? "",
      });
      toast("Task created and linked", "success");
    } catch {
      toast("Failed to create task", "error");
    }
  };

  const handleLinkEntity = async (
    krId: string | null,
    dstType: "project" | "task",
    dstId: string,
    dstTitle: string
  ) => {
    try {
      let targetKrId = krId;
      // If no krId, create a KR first with the entity title
      if (!targetKrId) {
        const newKR = await createKR.mutateAsync({
          goalId: goal.id,
          data: { title: dstTitle },
        });
        targetKrId = newKR.id;
      }
      await linkKR.mutateAsync({ krId: targetKrId!, dstType, dstId });
      toast(`${dstType === "project" ? "Project" : "Task"} linked`, "success");
    } catch {
      toast("Failed to link", "error");
    }
    setLinkSearch(null);
  };

  const filteredSearchResults = useMemo(() => {
    if (!linkSearch) return [];
    const q = linkSearch.query.toLowerCase();
    const items =
      linkSearch.type === "project"
        ? (projects ?? []).map((p: any) => ({ id: p.id, title: p.name ?? p.title }))
        : (tasks ?? []).map((t: any) => ({ id: t.id, title: t.title }));
    return items.filter((i: any) => i.title?.toLowerCase().includes(q)).slice(0, 10);
  }, [linkSearch, projects, tasks]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-[480px] z-50 bg-elevated border-l border-border-default shadow-xl overflow-y-auto">
        <div className="p-6 space-y-6">
          {/* Header */}
          <div className="flex items-start gap-3">
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-card text-text-muted mt-0.5"
            >
              <X size={18} />
            </button>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                if (title !== goal.title) saveField("title", title);
              }}
              className="flex-1 text-lg font-semibold bg-transparent border-none outline-none text-text-primary"
            />
          </div>

          {/* Inline metadata row */}
          <div className="flex flex-wrap gap-x-4 gap-y-2 px-4 py-3 border-b border-border-default" style={{ backgroundColor: "#f0f0f0" }}>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-muted">Status</span>
              <EditableCell
                value={goal.status ?? "not_started"}
                onSave={(v) => saveField("status", v)}
                type="select"
                options={GOAL_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
                displayAs="pill"
                pillType="status"
                placeholder="None"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-muted">Area</span>
              <EditableCell
                value={goal.area ?? ""}
                onSave={(v) => saveField("area", v)}
                type="select"
                options={LIFE_AREAS.map((a) => ({ value: a.value, label: a.label }))}
                displayAs="pill"
                pillType="area"
                placeholder="None"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-muted">Horizon</span>
              <EditableCell
                value={goal.horizon ?? "annual"}
                onSave={(v) => saveField("horizon", v)}
                type="select"
                options={HORIZONS.map((h) => ({ value: h.value, label: h.label }))}
                placeholder="None"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-text-muted">Due</span>
              <EditableCell
                value={goal.due_date ?? ""}
                onSave={(v) => saveField("due_date", v)}
                type="date"
                placeholder="None"
              />
            </div>
          </div>

          {/* Progress section (only when no KRs) */}
          {!hasKRs && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">
                Progress
              </h3>
              <div className="flex gap-3">
                <label className="flex-1 space-y-1">
                  <span className="text-xs text-text-secondary">Target</span>
                  <input
                    type="number"
                    defaultValue={goal.target_value ?? ""}
                    onBlur={(e) =>
                      saveField(
                        "target_value",
                        e.target.value ? Number(e.target.value) : null
                      )
                    }
                    className="w-full text-sm px-2 py-1 rounded bg-card border border-border-default text-text-primary"
                  />
                </label>
                <label className="flex-1 space-y-1">
                  <span className="text-xs text-text-secondary">Current</span>
                  <input
                    type="number"
                    defaultValue={goal.current_value ?? ""}
                    onBlur={(e) =>
                      saveField(
                        "current_value",
                        e.target.value ? Number(e.target.value) : null
                      )
                    }
                    className="w-full text-sm px-2 py-1 rounded bg-card border border-border-default text-text-primary"
                  />
                </label>
                <label className="flex-1 space-y-1">
                  <span className="text-xs text-text-secondary">Unit</span>
                  <input
                    type="text"
                    defaultValue={goal.unit ?? ""}
                    onBlur={(e) => saveField("unit", e.target.value)}
                    className="w-full text-sm px-2 py-1 rounded bg-card border border-border-default text-text-primary"
                  />
                </label>
              </div>
            </div>
          )}

          {/* KR progress summary (when KRs exist) */}
          {hasKRs && (
            <div className="text-sm text-text-secondary">
              {krDone} / {krs.length} key results complete
            </div>
          )}

          {/* Key Results list */}
          <div className="space-y-1">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">
              Key Results
            </h3>
            {krs.map((kr: any) => {
              const krPct = kr.target_value > 0
                ? Math.round(Math.min(100, ((kr.current_value ?? 0) / kr.target_value) * 100))
                : kr.status === "done" ? 100 : 0;
              return (
                <div
                  key={kr.id}
                  className="group flex items-center gap-2 py-1.5 px-2 rounded hover:bg-card"
                >
                  {/* Check circle */}
                  <button
                    onClick={() => toggleKR(kr)}
                    className={`shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${
                      kr.status === "done"
                        ? "bg-accent-success border-accent-success text-white"
                        : "border-border-default text-transparent hover:border-accent-primary"
                    }`}
                  >
                    <Check size={12} />
                  </button>

                  {/* Title + linked badge */}
                  <span
                    className={`flex-1 text-sm ${
                      kr.status === "done"
                        ? "line-through text-text-muted"
                        : "text-text-primary"
                    }`}
                  >
                    {kr.title}
                    {linkedKRIds.has(kr.id) && (
                      <span className="ml-1.5 text-[0.6rem] px-1 py-0.5 bg-card border border-border-default rounded text-text-muted align-middle">
                        Linked
                      </span>
                    )}
                  </span>

                  {/* Progress bar */}
                  <div className="w-16 h-1.5 bg-card rounded-full overflow-hidden shrink-0">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${krPct}%`,
                        backgroundColor: kr.status === "done" ? "var(--color-accent-success)" : "var(--color-accent-primary)",
                      }}
                    />
                  </div>

                  {/* Hover actions — only show push/link for unlinked KRs */}
                  <div className="hidden group-hover:flex items-center gap-1">
                    {!linkedKRIds.has(kr.id) && (
                      <>
                        <button
                          onClick={() => handlePushToProject(kr.id, kr.title)}
                          className="text-[0.625rem] text-text-muted hover:text-accent-primary px-1"
                          title="Push to Project"
                        >
                          → Proj
                        </button>
                        <button
                          onClick={() => handlePushToTask(kr.id, kr.title)}
                          className="text-[0.625rem] text-text-muted hover:text-accent-primary px-1"
                          title="Push to Task"
                        >
                          → Task
                        </button>
                      </>
                    )}
                    <button
                      onClick={async () => {
                        try {
                          await updateGoal.mutateAsync({ id: kr.id, data: { archived_at: new Date().toISOString() } });
                          toast("Key result removed", "success");
                        } catch {
                          toast("Failed to remove", "error");
                        }
                      }}
                      className="text-[0.625rem] text-text-muted hover:text-accent-danger px-1"
                      title="Delete key result"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}

            {/* Add KR inline */}
            {addingKR ? (
              <div className="flex items-center gap-2 px-2 py-1">
                <input
                  autoFocus
                  type="text"
                  placeholder="Key result title..."
                  value={newKRTitle}
                  onChange={(e) => setNewKRTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAddKR();
                    if (e.key === "Escape") {
                      setAddingKR(false);
                      setNewKRTitle("");
                    }
                  }}
                  className="flex-1 text-sm px-2 py-1 rounded bg-card border border-border-default text-text-primary outline-none focus:border-accent-primary"
                />
              </div>
            ) : (
              <button
                onClick={() => setAddingKR(true)}
                className="flex items-center gap-1 text-xs text-text-muted hover:text-accent-primary px-2 py-1"
              >
                <Plus size={14} />
                Add key result
              </button>
            )}
          </div>

          {/* Link buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() =>
                setLinkSearch({ krId: null, type: "project", query: "" })
              }
              className="text-xs text-text-muted hover:text-accent-primary border border-border-default rounded px-2 py-1"
            >
              + Link project
            </button>
            <button
              onClick={() =>
                setLinkSearch({ krId: null, type: "task", query: "" })
              }
              className="text-xs text-text-muted hover:text-accent-primary border border-border-default rounded px-2 py-1"
            >
              + Link task
            </button>
            <button
              disabled
              title="Coming soon"
              className="text-xs text-text-muted border border-border-default rounded px-2 py-1 opacity-50 cursor-not-allowed"
            >
              + Link habit
            </button>
          </div>

          {/* Link search dropdown */}
          {linkSearch && (
            <div className="border border-border-default rounded bg-card p-2 space-y-1">
              <div className="flex items-center gap-2 px-2 py-1 border-b border-border-default">
                <Search size={14} className="text-text-muted" />
                <input
                  autoFocus
                  type="text"
                  placeholder={`Search ${linkSearch.type}s...`}
                  value={linkSearch.query}
                  onChange={(e) =>
                    setLinkSearch({ ...linkSearch, query: e.target.value })
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setLinkSearch(null);
                  }}
                  className="flex-1 text-sm bg-transparent outline-none text-text-primary"
                />
              </div>
              {filteredSearchResults.map((item: any) => (
                <button
                  key={item.id}
                  onClick={() =>
                    handleLinkEntity(
                      linkSearch.krId,
                      linkSearch.type,
                      item.id,
                      item.title
                    )
                  }
                  className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-page text-text-primary truncate"
                >
                  {item.title}
                </button>
              ))}
              {filteredSearchResults.length === 0 && (
                <p className="text-xs text-text-muted px-2 py-1">No results</p>
              )}
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">
              Notes
            </h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes !== (goal.notes ?? "")) saveField("notes", notes);
              }}
              rows={4}
              className="w-full text-sm px-3 py-2 rounded bg-card border border-border-default text-text-primary resize-y outline-none focus:border-accent-primary"
              placeholder="Add notes..."
            />
          </div>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  GoalsPage                                                         */
/* ------------------------------------------------------------------ */

export default function GoalsPage() {
  const { data: goals, isLoading, isError } = useGoals();
  const { data: progress } = useGoalProgress();
  const { data: areaProgressData } = useAreaProgress();
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();

  const [selectedHorizon, setSelectedHorizon] = useState("annual");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedKRs, setExpandedKRs] = useState<Set<string>>(new Set());

  // Progress map keyed by goal_id
  const progressMap = useMemo(
    () =>
      Object.fromEntries(
        (progress ?? []).map((p: any) => [p.goal_id ?? p.id, p])
      ),
    [progress]
  );

  // Area progress map aggregated by selected horizon (weighted average)
  const areaProgressMap = useMemo(() => {
    const map: Record<string, { avg_pct: number; goal_count: number }> = {};
    for (const row of areaProgressData ?? []) {
      if (selectedHorizon !== "annual" && row.horizon !== selectedHorizon) continue;
      const area = row.area;
      if (!area) continue;
      if (!map[area]) {
        map[area] = { avg_pct: 0, goal_count: 0 };
      }
      // Weighted average by goal count
      const existing = map[area];
      const totalCount = existing.goal_count + (row.goal_count ?? 0);
      if (totalCount > 0) {
        map[area] = {
          avg_pct:
            (existing.avg_pct * existing.goal_count +
              (row.avg_pct ?? 0) * (row.goal_count ?? 0)) /
            totalCount,
          goal_count: totalCount,
        };
      }
    }
    return map;
  }, [areaProgressData, selectedHorizon]);

  // Total progress: average of all area percentages
  const totalProgress = useMemo(() => {
    const areas = Object.values(areaProgressMap);
    if (areas.length === 0) return 0;
    return Math.round(areas.reduce((s, a) => s + a.avg_pct, 0) / areas.length);
  }, [areaProgressMap]);

  // Filtered goals: kind='goal', then by horizon tab
  const filteredGoals = useMemo(() => {
    const allGoals = (goals ?? []).filter((g: any) => g.kind === "goal");
    if (selectedHorizon === "annual") return allGoals;
    return allGoals.filter((g: any) => g.horizon === selectedHorizon || g.horizon === "annual");
  }, [goals, selectedHorizon]);

  // Group by area
  const goalsByArea = useMemo(() => {
    const map: Record<string, any[]> = {};
    for (const g of filteredGoals) {
      const area = g.area ?? "uncategorized";
      if (!map[area]) map[area] = [];
      map[area].push(g);
    }
    return map;
  }, [filteredGoals]);

  // Get KRs for a goal from the goals list
  const getKRsForGoal = (goalId: string) =>
    (goals ?? []).filter(
      (g: any) => g.kind === "key_result" && g.parent_goal_id === goalId
    );

  const toggleExpanded = (goalId: string) => {
    setExpandedKRs((prev) => {
      const next = new Set(prev);
      if (next.has(goalId)) next.delete(goalId);
      else next.add(goalId);
      return next;
    });
  };

  const handleQuickAdd = async (area: string) => {
    try {
      const newGoal = await createGoal.mutateAsync({
        title: "New Goal",
        kind: "goal",
        area,
        horizon: selectedHorizon === "annual" ? "annual" : selectedHorizon,
        status: "not_started",
      } as any);
      setSelectedId(newGoal.id);
      toast("Goal created", "success");
    } catch {
      toast("Failed to create goal", "error");
    }
  };

  const selected = (goals ?? []).find((g: any) => g.id === selectedId);
  const year = new Date().getFullYear();

  // --- Loading ---
  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold text-text-primary mb-1">
          {year} Goals
        </h1>
        <div className="space-y-4 mt-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-6 w-32 bg-card rounded animate-pulse" />
              {Array.from({ length: 2 }).map((_, j) => (
                <div
                  key={j}
                  className="h-16 bg-card rounded-md animate-pulse"
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- Error ---
  if (isError) {
    return (
      <div className="max-w-4xl mx-auto text-center py-16">
        <p className="text-accent-danger">
          Error loading goals. Check the browser console for details.
        </p>
      </div>
    );
  }

  const areasWithGoals = LIFE_AREAS.filter((a) => goalsByArea[a.value]);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-text-primary">
          {year} Goals
        </h1>
        <p className="text-sm text-text-secondary mt-1">
          {filteredGoals.length} goal{filteredGoals.length !== 1 ? "s" : ""}
        </p>

        {/* Horizon tabs */}
        <div className="flex gap-1 mt-4">
          {HORIZONS.map((h) => (
            <button
              key={h.value}
              onClick={() => setSelectedHorizon(h.value)}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                selectedHorizon === h.value
                  ? "bg-accent-primary text-white"
                  : "text-text-secondary hover:bg-card"
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>

      {/* Progress strip */}
      <div className="bg-elevated border border-border-default rounded-md p-4 mb-6">
        {/* Total bar */}
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs font-medium text-text-muted w-12">Total</span>
          <div className="flex-1 h-2 bg-card rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${totalProgress}%`,
                backgroundColor: "var(--color-text-primary)",
              }}
            />
          </div>
          <span className="text-xs font-medium text-text-primary w-10 text-right">
            {totalProgress}%
          </span>
        </div>

        {/* Area segments */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {LIFE_AREAS.map((area) => {
            const ap = areaProgressMap[area.value];
            const pct = Math.round(ap?.avg_pct ?? 0);
            return (
              <div key={area.value} className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: area.color }}
                />
                <span className="text-xs text-text-secondary truncate">
                  {area.label}
                </span>
                <div className="flex-1 h-1.5 bg-card rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: area.color,
                    }}
                  />
                </div>
                <span className="text-xs text-text-muted w-8 text-right">
                  {pct}%
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Empty state */}
      {filteredGoals.length === 0 && (
        <div className="text-center py-16 text-text-secondary">
          <p className="text-lg mb-2">No goals yet</p>
          <p className="text-sm text-text-muted">
            Add your first goal to get started.
          </p>
        </div>
      )}

      {/* Area sections */}
      {areasWithGoals.map((area) => {
        const areaGoals = goalsByArea[area.value] ?? [];
        const ap = areaProgressMap[area.value];
        const areaPct = Math.round(ap?.avg_pct ?? 0);

        return (
          <div key={area.value} className="mb-6">
            {/* Area header */}
            <div className="flex items-center gap-3 mb-3 pb-2.5 border-b-2 border-border-default">
              <div
                className="w-1 h-7 rounded-sm"
                style={{ backgroundColor: area.color }}
              />
              <h2 className="text-[1.125rem] font-bold tracking-tight text-text-primary flex-1">
                {area.label}
              </h2>
              <span className="text-xs text-text-muted font-medium">
                {areaGoals.length} goal{areaGoals.length !== 1 ? "s" : ""} · {areaPct}% avg
              </span>
            </div>

            {/* Goal cards */}
            <div className="space-y-2">
              {areaGoals.map((goal: any) => {
                const prog = progressMap[goal.id];
                const pct = Math.round(prog?.effective_pct ?? 0);
                const goalKRs = getKRsForGoal(goal.id);
                const krCount = goalKRs.length;
                const krDone = goalKRs.filter((kr: any) => kr.status === "done").length;
                const isExpanded = expandedKRs.has(goal.id);

                return (
                  <div
                    key={goal.id}
                    className="border border-border-default rounded-md bg-elevated overflow-hidden"
                  >
                    {/* Goal card row */}
                    <div
                      className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-card transition-colors"
                      onClick={() => setSelectedId(goal.id)}
                    >
                      <ProgressRing value={pct} size={40} strokeWidth={3} color={area.color} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">
                          {goal.title}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {krCount > 0 ? (
                            <span className="text-xs text-text-muted font-medium">
                              {krDone} / {krCount} key results
                            </span>
                          ) : goal.target_value ? (
                            <span className="text-xs text-text-muted font-medium">
                              {goal.current_value ?? 0} / {goal.target_value} {goal.unit ?? ""}
                            </span>
                          ) : null}
                          {goal.due_date && (
                            <span className="text-xs text-text-muted">
                              Due{" "}
                              {new Date(goal.due_date).toLocaleDateString(
                                "en-GB",
                                { month: "short", day: "numeric" }
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {goal.status && (
                          <StatusPill value={goal.status} type="status" />
                        )}
                        {krCount > 0 ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpanded(goal.id);
                            }}
                            className="p-1 text-text-muted hover:text-text-primary"
                          >
                            <ChevronDown
                              size={16}
                              className={`transition-transform ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                            />
                          </button>
                        ) : (
                          <span className="w-[26px]" />
                        )}
                      </div>
                    </div>

                    {/* Collapsible KR rows */}
                    {isExpanded && goalKRs.length > 0 && (
                      <div className="border-t border-border-default bg-card px-4 py-2 space-y-1">
                        {goalKRs.map((kr: any) => {
                          const krProg = progressMap[kr.id];
                          const krPct = Math.round(
                            krProg?.effective_pct ?? (kr.status === "done" ? 100 : 0)
                          );
                          return (
                            <div
                              key={kr.id}
                              className="flex items-center gap-2 py-1"
                            >
                              {/* Check circle (3 states) */}
                              <span
                                className={`shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                  kr.status === "done"
                                    ? "bg-accent-success border-accent-success text-white"
                                    : kr.status === "in_progress"
                                    ? "border-accent-primary"
                                    : "border-border-default"
                                }`}
                              >
                                {kr.status === "done" && <Check size={10} />}
                              </span>
                              <span
                                className={`flex-1 text-xs truncate ${
                                  kr.status === "done"
                                    ? "line-through text-text-muted"
                                    : "text-text-primary"
                                }`}
                              >
                                {kr.title}
                              </span>
                              {/* Mini progress bar */}
                              <div className="w-16 h-1.5 bg-page rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{
                                    width: `${krPct}%`,
                                    backgroundColor: "var(--color-accent-success)",
                                  }}
                                />
                              </div>
                              <span className="text-xs text-text-muted w-8 text-right">
                                {krPct}%
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Quick add button */}
              <button
                onClick={() => handleQuickAdd(area.value)}
                className="w-full flex items-center justify-center gap-1 py-2 border-2 border-dashed border-border-default rounded-md text-xs text-text-muted hover:text-accent-primary hover:border-accent-primary transition-colors"
              >
                <Plus size={14} />
                Add goal to {area.label}...
              </button>
            </div>
          </div>
        );
      })}

      {/* Quick add for areas with no goals */}
      {areasWithGoals.length === 0 &&
        LIFE_AREAS.map((area) => (
          <button
            key={area.value}
            onClick={() => handleQuickAdd(area.value)}
            className="w-full flex items-center justify-center gap-1 py-2 mb-2 border-2 border-dashed border-border-default rounded-md text-xs text-text-muted hover:text-accent-primary hover:border-accent-primary transition-colors"
          >
            <Plus size={14} />
            Add {area.label} goal
          </button>
        ))}

      {/* GoalFlyout */}
      {selected && (
        <GoalFlyout
          goal={selected}
          goals={goals ?? []}
          progressMap={progressMap}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
