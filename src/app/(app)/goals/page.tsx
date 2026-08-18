"use client";

import { useState, useMemo } from "react";
import { useGoals, useUpdateGoal } from "@/hooks/use-goals";
import { useGoalProgress } from "@/hooks/use-goal-progress";
import { FlyoutPanel, type FieldConfig } from "@/components/app/FlyoutPanel";
import { StatusPill } from "@/components/app/StatusPill";
import { ProgressRing } from "@/components/app/ProgressRing";
import { GOAL_STATUSES, LIFE_AREAS } from "@/lib/constants";
import { ChevronRight, ChevronDown } from "lucide-react";

const HORIZONS = [
  { value: "annual", label: "Annual" },
  { value: "q1", label: "Q1" },
  { value: "q2", label: "Q2" },
  { value: "q3", label: "Q3" },
  { value: "q4", label: "Q4" },
];

const GOAL_FIELDS: FieldConfig[] = [
  { key: "title", label: "Title", type: "text" },
  {
    key: "status", label: "Status", type: "select",
    options: GOAL_STATUSES.map(s => ({ value: s.value, label: s.label })),
    displayAs: "pill", pillType: "status",
  },
  {
    key: "area", label: "Area", type: "select",
    options: LIFE_AREAS.map(a => ({ value: a.value, label: a.label })),
    displayAs: "pill", pillType: "area",
  },
  {
    key: "horizon", label: "Horizon", type: "select",
    options: HORIZONS,
  },
  { key: "target_value", label: "Target Value", type: "number" },
  { key: "current_value", label: "Current Value", type: "number" },
  { key: "unit", label: "Unit", type: "text" },
  { key: "due_date", label: "Due Date", type: "date" },
  { key: "notes", label: "Notes", type: "textarea" },
];

type GoalNode = any & { children: GoalNode[] };

function buildGoalTree(goals: any[]): GoalNode[] {
  const map = new Map<string, GoalNode>();
  const roots: GoalNode[] = [];

  for (const g of goals) {
    map.set(g.id, { ...g, children: [] });
  }

  for (const node of map.values()) {
    if (node.parent_goal_id && map.has(node.parent_goal_id)) {
      map.get(node.parent_goal_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

function GoalRow({
  goal,
  progressMap,
  depth,
  onSelect,
}: {
  goal: GoalNode;
  progressMap: Record<string, any>;
  depth: number;
  onSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = goal.children.length > 0;
  const prog = progressMap[goal.id];
  const pct = prog?.direct_pct ?? prog?.linked_tasks_pct ?? 0;

  return (
    <>
      <div
        className="flex items-center gap-3 py-3 px-4 hover:bg-card rounded-sm cursor-pointer"
        style={{ paddingLeft: `${16 + depth * 24}px` }}
        onClick={() => onSelect(goal.id)}
      >
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="p-0.5 text-text-muted hover:text-text-primary"
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <span className="w-5" />
        )}
        <ProgressRing value={pct} size={36} strokeWidth={3} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary truncate">
            {goal.title}
          </p>
          {goal.unit && (
            <p className="text-xs text-text-secondary">
              {goal.current_value ?? 0}/{goal.target_value ?? "?"} {goal.unit}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {goal.area && <StatusPill value={goal.area} type="area" />}
          {goal.horizon && (
            <span className="text-xs text-text-muted capitalize">{goal.horizon}</span>
          )}
          {goal.status && <StatusPill value={goal.status} type="status" />}
        </div>
      </div>
      {expanded &&
        goal.children.map((child: GoalNode) => (
          <GoalRow
            key={child.id}
            goal={child}
            progressMap={progressMap}
            depth={depth + 1}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

export default function GoalsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: goals, isLoading, isError } = useGoals();
  const { data: progress } = useGoalProgress();
  const updateGoal = useUpdateGoal();

  const progressMap = useMemo(
    () => Object.fromEntries((progress ?? []).map((p: any) => [p.goal_id ?? p.id, p])),
    [progress]
  );

  const tree = useMemo(() => buildGoalTree(goals ?? []), [goals]);
  const selected = (goals ?? []).find((g: any) => g.id === selectedId);

  if (isLoading) {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-4">Goals</h1>
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-14 bg-card rounded-sm animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        <h1 className="text-2xl font-semibold mb-4">Goals</h1>
        <div className="text-center py-12 text-accent-danger">
          Error loading goals. Check the browser console for details.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Goals</h1>

      {tree.length === 0 ? (
        <div className="text-center py-12 text-text-secondary">No goals yet</div>
      ) : (
        <div className="border border-border-default rounded-md bg-elevated divide-y divide-border-default">
          {tree.map((goal) => (
            <GoalRow
              key={goal.id}
              goal={goal}
              progressMap={progressMap}
              depth={0}
              onSelect={setSelectedId}
            />
          ))}
        </div>
      )}

      {selected && (
        <FlyoutPanel
          title={selected.title}
          fields={GOAL_FIELDS}
          data={selected}
          onSave={async (field, value) => {
            await updateGoal.mutateAsync({
              id: selected.id,
              data: { [field]: value || null },
            });
          }}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
