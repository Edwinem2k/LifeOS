"use client";

import { useState, useMemo, useRef, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTasks, useCreateTask, useUpdateTask, useCompleteTask } from "@/hooks/use-tasks";
import { useProjects } from "@/hooks/use-projects";
import { useGoalsForEntities } from "@/hooks/use-goals";
import { FilterBar, SearchPill, FilterPill } from "@/components/app/FilterBar";
import { FlyoutPanel, type FieldConfig } from "@/components/app/FlyoutPanel";
import { StatusPill } from "@/components/app/StatusPill";
import { EditableCell } from "@/components/app/EditableCell";
import { NotePopover } from "@/components/app/NotePopover";
import { DatePicker } from "@/components/app/DatePicker";
import { TASK_STATUSES, LIFE_AREAS, PRIORITIES, KANBAN_COLUMNS } from "@/lib/constants";
import { QuickAdd } from "@/components/app/QuickAdd";
import { ChevronRight, ChevronDown, List, LayoutGrid, Check, Plus, GripVertical, ArrowUp, ArrowDown } from "lucide-react";

type TaskNode = any & { children: TaskNode[]; depth: number };

function buildTree(tasks: any[]): TaskNode[] {
  const map = new Map<string, TaskNode>();
  const roots: TaskNode[] = [];
  for (const t of tasks) map.set(t.id, { ...t, children: [], depth: 0 });
  for (const node of map.values()) {
    if (node.parent_task_id && map.has(node.parent_task_id)) {
      const parent = map.get(node.parent_task_id)!;
      node.depth = Math.min(parent.depth + 1, 3);
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function getDeadlineStyle(deadline: string | null, status: string) {
  if (!deadline || status === "done") return { color: "var(--color-text-secondary)" };
  const now = new Date();
  const d = new Date(deadline);
  const daysUntil = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysUntil < 0) return { color: "var(--color-accent-danger)", fontWeight: 500 };
  if (daysUntil <= 7) return { color: "var(--color-accent-warning)", fontWeight: 500 };
  return { color: "var(--color-accent-success)" };
}

function TaskCheckbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      className={`group w-4 h-4 rounded border flex items-center justify-center shrink-0 mr-1 transition-all cursor-pointer ${
        checked
          ? "bg-accent-primary border-accent-primary"
          : "border-text-muted/40 hover:border-accent-primary"
      }`}
    >
      {checked ? (
        <Check size={11} className="text-white" strokeWidth={3} />
      ) : (
        <Check size={11} className="text-accent-primary opacity-0 group-hover:opacity-60" strokeWidth={3} />
      )}
    </button>
  );
}

type ViewMode = "table" | "kanban";
type SortDir = "asc" | "desc";

type ColWidths = {
  task: number; status: number; priority: number; project: number; area: number; goal: number; deadline: number; notes: number;
};

export default function TasksPage() {
  return (
    <Suspense>
      <TasksPageInner />
    </Suspense>
  );
}

function TasksPageInner() {
  const searchParams = useSearchParams();
  const [view, setView] = useState<ViewMode>("table");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>(() => { const s = searchParams.get("status"); return s ? [s] : []; });
  const [areaFilter, setAreaFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState<string[]>(() => { const p = searchParams.get("project"); return p ? [p] : []; });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [draggedKanbanId, setDraggedKanbanId] = useState<string | null>(null);
  const [doneAutoExcluded, setDoneAutoExcluded] = useState(true);

  const [colWidths, setColWidths] = useState<ColWidths>({
    task: 280, status: 120, priority: 100, project: 180, area: 120, goal: 120, deadline: 120, notes: 44,
  });
  const resizingRef = useRef<{ key: keyof ColWidths; startX: number; startW: number } | null>(null);
  const didResizeRef = useRef(false);
  const quickAddRef = useRef<HTMLInputElement>(null);

  const { data: tasks, isLoading } = useTasks();
  const { data: projects } = useProjects();
  const taskIds = useMemo(() => (tasks ?? []).map((t: any) => t.id), [tasks]);
  const { data: taskGoals } = useGoalsForEntities("task", taskIds);
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const completeTask = useCompleteTask();

  const projectMap = useMemo(
    () => Object.fromEntries((projects ?? []).map((p: any) => [p.id, p.name])),
    [projects]
  );

  const filtered = useMemo(() => {
    let list = tasks ?? [];
    if (statusFilter.length === 0 && doneAutoExcluded) list = list.filter((t: any) => t.status !== "done");
    if (search) { const q = search.toLowerCase(); list = list.filter((t: any) => t.title?.toLowerCase().includes(q)); }
    if (statusFilter.length > 0) list = list.filter((t: any) => statusFilter.includes(t.status));
    if (areaFilter.length > 0) list = list.filter((t: any) => areaFilter.includes(t.area));
    if (priorityFilter.length > 0) list = list.filter((t: any) => priorityFilter.includes(t.priority));
    if (projectFilter.length > 0) list = list.filter((t: any) => projectFilter.includes(t.project_id));
    return list;
  }, [tasks, search, statusFilter, areaFilter, priorityFilter, projectFilter, doneAutoExcluded]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const list = [...filtered];
    const priorityOrder = ["high", "medium", "low"];
    const statusOrder = TASK_STATUSES.map((s) => s.value);

    function getSortValue(item: any, key: string): any {
      if (key === "priority") return priorityOrder.indexOf(item.priority ?? "medium");
      if (key === "status") return statusOrder.indexOf(item.status ?? "inbox");
      if (key === "project") return projectMap[item.project_id] ?? "";
      if (key === "task") return item.title ?? "";
      return item[key] ?? "";
    }

    list.sort((a: any, b: any) => {
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      // Secondary sort by priority (always ascending = high first)
      if (sortKey !== "priority") {
        const pa = priorityOrder.indexOf(a.priority ?? "medium");
        const pb = priorityOrder.indexOf(b.priority ?? "medium");
        if (pa !== pb) return pa - pb;
      }
      return 0;
    });
    return list;
  }, [filtered, sortKey, sortDir, projectMap]);

  const tree = useMemo(() => buildTree(sortKey ? sorted : filtered), [sorted, filtered, sortKey]);
  const selected = (tasks ?? []).find((t: any) => t.id === selectedId);

  const projectOptions = useMemo(
    () => (projects ?? []).map((p: any) => ({ value: p.id, label: p.name })),
    [projects]
  );
  const projectOptionsWithNone = useMemo(
    () => [{ value: "", label: "None" }, ...projectOptions],
    [projectOptions]
  );

  const taskFields: FieldConfig[] = [
    {
      key: "status", label: "Status", type: "select", inline: true,
      options: TASK_STATUSES.map(s => ({ value: s.value, label: s.label })),
      displayAs: "pill", pillType: "status",
    },
    {
      key: "priority", label: "Priority", type: "select", inline: true,
      options: PRIORITIES.map(p => ({ value: p.value, label: p.label })),
      displayAs: "pill", pillType: "priority",
    },
    {
      key: "area", label: "Area", type: "select", inline: true,
      options: LIFE_AREAS.map(a => ({ value: a.value, label: a.label })),
      displayAs: "pill", pillType: "area",
    },
    { key: "deadline", label: "Deadline", type: "date", inline: true },
    {
      key: "project_id", label: "Project", type: "select", inline: true,
      options: projectOptionsWithNone, searchable: true,
    },
    { key: "notes", label: "Notes", type: "textarea" },
  ];

  function toggleCollapse(id: string) {
    setCollapsed((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }

  const saveField = useCallback(
    (taskId: string, field: string) => async (value: string) => {
      await updateTask.mutateAsync({ id: taskId, data: { [field]: value || null } });
    },
    [updateTask]
  );

  function handleCheckboxToggle(task: any) {
    if (task.status === "done") {
      updateTask.mutate({ id: task.id, data: { status: "next_action", completed_at: null } });
    } else {
      completeTask.mutate(task.id);
    }
  }

  function handleSort(key: string) {
    if (didResizeRef.current) return;
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function startResize(key: keyof ColWidths, e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation();
    didResizeRef.current = true;
    resizingRef.current = { key, startX: e.clientX, startW: colWidths[key] };
    function onMove(ev: MouseEvent) {
      if (!resizingRef.current) return;
      const diff = ev.clientX - resizingRef.current.startX;
      setColWidths((prev) => ({ ...prev, [resizingRef.current!.key]: Math.max(60, resizingRef.current!.startW + diff) }));
    }
    function onUp() {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      // Reset after a tick so the click event on the header is suppressed
      setTimeout(() => { didResizeRef.current = false; }, 0);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function renderResizeHandle(key: keyof ColWidths) {
    return <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent-primary/40 z-10" onMouseDown={(e) => startResize(key, e)} />;
  }

  function sortIndicator(key: string) {
    if (sortKey !== key) return null;
    return sortDir === "asc" ? <ArrowUp size={12} className="ml-1 shrink-0" /> : <ArrowDown size={12} className="ml-1 shrink-0" />;
  }

  // Flat list for drag reorder (only root tasks when not sorted)
  const flatList = useMemo(() => {
    const result: any[] = [];
    function flatten(nodes: TaskNode[]) {
      for (const node of nodes) {
        result.push(node);
        if (!collapsed.has(node.id)) flatten(node.children);
      }
    }
    flatten(tree);
    return result;
  }, [tree, collapsed]);

  function handleRowDragStart(i: number, e: React.DragEvent) {
    setDragIndex(i);
    e.dataTransfer.effectAllowed = "move";
  }
  function handleRowDragOver(e: React.DragEvent, i: number) { e.preventDefault(); setOverIndex(i); }
  function handleRowDrop(i: number) {
    if (dragIndex !== null && dragIndex !== i) {
      // Clear any active sort — manual reorder takes precedence
      setSortKey(null);
      // Reorder the flat list and assign new sort_orders
      const reordered = [...flatList];
      const [moved] = reordered.splice(dragIndex, 1);
      reordered.splice(i, 0, moved);
      for (let idx = 0; idx < reordered.length; idx++) {
        if (reordered[idx].sort_order !== idx) {
          updateTask.mutate({ id: reordered[idx].id, data: { sort_order: idx } });
        }
      }
    }
    setDragIndex(null); setOverIndex(null);
  }
  function handleRowDragEnd() { setDragIndex(null); setOverIndex(null); }

  function renderRows(nodes: any[], globalIndex: { value: number }): React.ReactNode[] {
    return nodes.flatMap((node) => {
      const hasChildren = node.children.length > 0;
      const isCollapsed = collapsed.has(node.id);
      const indent = node.depth * 24;
      const idx = globalIndex.value++;

      const row = (
        <div
          key={node.id}
          draggable
          onDragStart={(e) => handleRowDragStart(idx, e)}
          onDragOver={(e) => handleRowDragOver(e, idx)}
          onDrop={() => handleRowDrop(idx)}
          onDragEnd={handleRowDragEnd}
          className={`flex items-center h-10 border-b border-border-default hover:bg-page text-sm ${
            dragIndex === idx ? "opacity-40" : ""
          } ${overIndex === idx && dragIndex !== idx ? "border-t-2 border-t-accent-primary" : ""}`}
        >
          {/* Task name column */}
          <div
            className="shrink-0 flex items-center px-3 gap-1 border-r border-border-default"
            style={{ width: colWidths.task, paddingLeft: `${12 + indent}px` }}
          >
            <span
              className="shrink-0 mr-1 text-text-muted hover:text-text-primary cursor-grab active:cursor-grabbing"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical size={14} />
            </span>
            {hasChildren ? (
              <button onClick={() => toggleCollapse(node.id)} className="p-0.5 text-text-muted hover:text-text-primary">
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
            ) : (
              <span className="w-5" />
            )}
            <TaskCheckbox checked={node.status === "done"} onChange={() => handleCheckboxToggle(node)} />
            <span className="truncate cursor-pointer hover:text-accent-primary text-sm" onClick={() => setSelectedId(node.id)}>
              {node.title}
            </span>
          </div>
          {/* Status */}
          <div className="px-2 flex items-center" style={{ minWidth: colWidths.status, flex: 1 }}>
            <EditableCell value={node.status ?? ""} onSave={saveField(node.id, "status")} type="select" options={TASK_STATUSES.map((s) => ({ value: s.value, label: s.label }))} displayAs="pill" pillType="status" />
          </div>
          {/* Priority */}
          <div className="px-2 flex items-center" style={{ minWidth: colWidths.priority, flex: 1 }}>
            <EditableCell value={node.priority ?? ""} onSave={saveField(node.id, "priority")} type="select" options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))} displayAs="pill" pillType="priority" />
          </div>
          {/* Project */}
          <div className="px-2 flex items-center" style={{ minWidth: colWidths.project, flex: 1 }}>
            <EditableCell value={node.project_id ?? ""} onSave={saveField(node.id, "project_id")} type="select" options={projectOptionsWithNone} placeholder="None" searchable />
          </div>
          {/* Area */}
          <div className="px-2 flex items-center" style={{ minWidth: colWidths.area, flex: 1 }}>
            <EditableCell value={node.area ?? ""} onSave={saveField(node.id, "area")} type="select" options={LIFE_AREAS.map((a) => ({ value: a.value, label: a.label }))} displayAs="pill" pillType="area" />
          </div>
          {/* Goal */}
          <div className="px-2 flex items-center" style={{ minWidth: colWidths.goal, flex: 1 }}>
            {taskGoals?.[node.id] ? (
              <span className="text-xs px-1.5 py-0.5 bg-card rounded border border-border-default text-text-secondary truncate max-w-[100px] inline-block">
                {taskGoals[node.id].title}
              </span>
            ) : null}
          </div>
          {/* Deadline */}
          <DeadlineCell deadline={node.deadline} status={node.status} minWidth={colWidths.deadline} onSave={(date) => updateTask.mutate({ id: node.id, data: { deadline: date } })} />
          {/* Notes */}
          <div className="px-1 flex items-center justify-center" style={{ width: colWidths.notes }}>
            <NotePopover notes={node.notes} onSave={saveField(node.id, "notes")} />
          </div>
        </div>
      );

      if (hasChildren && !isCollapsed) {
        return [row, ...renderRows(node.children, globalIndex)];
      }
      return [row];
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (view !== "table") setView("table");
              createTask.mutate(
                { title: "New Task", status: "inbox" } as any,
                { onSuccess: (created: any) => setSelectedId(created.id) }
              );
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-accent-primary border border-accent-primary rounded-sm hover:bg-accent-primary/10 transition-colors"
          >
            <Plus size={14} />
            New Task
          </button>
          <div className="flex items-center gap-1 border border-border-default rounded-sm">
            <button onClick={() => setView("table")} className={`p-1.5 rounded-sm transition-colors ${view === "table" ? "bg-card text-text-primary" : "text-text-muted hover:text-text-primary hover:bg-card/50"}`}>
              <List size={16} />
            </button>
            <button onClick={() => { setView("kanban"); setStatusFilter([]); setDoneAutoExcluded(false); }} className={`p-1.5 rounded-sm transition-colors ${view === "kanban" ? "bg-card text-text-primary" : "text-text-muted hover:text-text-primary hover:bg-card/50"}`}>
              <LayoutGrid size={16} />
            </button>
          </div>
        </div>
      </div>

      <FilterBar>
        <SearchPill value={search} onChange={setSearch} placeholder="Search tasks..." />
        <FilterPill label="Priority" options={PRIORITIES.map(p => ({ value: p.value, label: p.label }))} selected={priorityFilter} onChange={setPriorityFilter} pillType="priority" />
        <FilterPill
          label="Status"
          options={TASK_STATUSES.map(s => ({ value: s.value, label: s.label }))}
          selected={statusFilter}
          onChange={setStatusFilter}
          pillType="status"
          autoExclude={doneAutoExcluded ? ["done"] : []}
          onRemoveAutoExclude={() => setDoneAutoExcluded(false)}
          onSelectAll={() => setDoneAutoExcluded(true)}
        />
        <FilterPill label="Area" options={LIFE_AREAS.map(a => ({ value: a.value, label: a.label }))} selected={areaFilter} onChange={setAreaFilter} pillType="area" />
        {projectOptions.length > 0 && (
          <FilterPill label="Project" options={projectOptions} selected={projectFilter} onChange={setProjectFilter} />
        )}
      </FilterBar>

      {view === "table" ? (
        <><div className="border border-border-default rounded-md bg-elevated">
          {/* Header */}
          <div className="flex h-10 border-b border-border-default bg-card text-xs font-medium text-text-secondary uppercase tracking-wide select-none">
            <div
              className="shrink-0 px-3 flex items-center border-r border-border-default relative cursor-pointer hover:text-text-primary"
              style={{ width: colWidths.task }}
              onClick={() => handleSort("task")}
            >
              Task {sortIndicator("task")}
              {renderResizeHandle("task")}
            </div>
            <div className="px-3 flex items-center relative cursor-pointer hover:text-text-primary" style={{ minWidth: colWidths.status, flex: 1 }} onClick={() => handleSort("status")}>
              Status {sortIndicator("status")} {renderResizeHandle("status")}
            </div>
            <div className="px-3 flex items-center relative cursor-pointer hover:text-text-primary" style={{ minWidth: colWidths.priority, flex: 1 }} onClick={() => handleSort("priority")}>
              Priority {sortIndicator("priority")} {renderResizeHandle("priority")}
            </div>
            <div className="px-3 flex items-center relative cursor-pointer hover:text-text-primary" style={{ minWidth: colWidths.project, flex: 1 }} onClick={() => handleSort("project")}>
              Project {sortIndicator("project")} {renderResizeHandle("project")}
            </div>
            <div className="px-3 flex items-center relative cursor-pointer hover:text-text-primary" style={{ minWidth: colWidths.area, flex: 1 }} onClick={() => handleSort("area")}>
              Area {sortIndicator("area")} {renderResizeHandle("area")}
            </div>
            <div className="px-3 flex items-center relative" style={{ minWidth: colWidths.goal, flex: 1 }}>
              Goal {renderResizeHandle("goal")}
            </div>
            <div className="px-3 flex items-center relative cursor-pointer hover:text-text-primary" style={{ minWidth: colWidths.deadline, flex: 1 }} onClick={() => handleSort("deadline")}>
              Deadline {sortIndicator("deadline")} {renderResizeHandle("deadline")}
            </div>
            <div className="px-1 flex items-center justify-center" style={{ width: colWidths.notes }} />
          </div>

          {isLoading ? (
            <div className="space-y-0">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 bg-card animate-pulse border-b border-border-default" />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">No tasks found</div>
          ) : (
            <>
              {renderRows(tree, { value: 0 })}
              {/* Drop zone at the end of the list */}
              <div
                className={`h-4 ${overIndex === flatList.length && dragIndex !== null ? "border-t-2 border-t-accent-primary" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOverIndex(flatList.length); }}
                onDrop={() => handleRowDrop(flatList.length - 1)}
              />
            </>
          )}
        </div>
        <QuickAdd
          ref={quickAddRef}
          placeholder="Add task..."
          onAdd={(title) => createTask.mutate({ title, status: "inbox" } as any)}
        />
        </>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.map((col) => {
            const colTasks = filtered.filter((t: any) => (col.statuses as readonly string[]).includes(t.status));
            return (
              <div
                key={col.id}
                className="min-w-[260px] flex-1 bg-card rounded-md border border-border-default"
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) {
                    // If dropping into Done column, disable auto-exclude so it stays visible
                    if (col.defaultWriteStatus === "done" && doneAutoExcluded) {
                      setDoneAutoExcluded(false);
                    }
                    updateTask.mutate({ id, data: { status: col.defaultWriteStatus } });
                  }
                }}
              >
                <div className="px-3 py-2 border-b border-border-default flex items-center justify-between">
                  <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">{col.label}</span>
                  <span className="text-xs text-text-muted">{colTasks.length}</span>
                </div>
                <div className="p-2 space-y-2 min-h-[100px]">
                  {colTasks.map((task: any) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData("text/plain", task.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDraggedKanbanId(task.id);
                      }}
                      onDragEnd={() => setDraggedKanbanId(null)}
                      onClick={() => setSelectedId(task.id)}
                      className={`bg-elevated border border-border-default rounded-sm p-3 cursor-grab active:cursor-grabbing hover:shadow-sm transition-shadow ${
                        draggedKanbanId === task.id ? "opacity-40" : ""
                      }`}
                    >
                      <p className="text-sm text-text-primary">{task.title}</p>
                      <div className="flex items-center gap-2 mt-2">
                        {task.projects?.name && (
                          <span className="text-xs bg-card text-text-secondary px-1.5 py-0.5 rounded-sm">{task.projects.name}</span>
                        )}
                        {task.priority && <StatusPill value={task.priority} type="priority" />}
                        {task.deadline && (
                          <span className="text-xs ml-auto" style={getDeadlineStyle(task.deadline, task.status)}>
                            {new Date(task.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <FlyoutPanel
          title={selected.title}
          titleField="title"
          fields={taskFields}
          data={selected}
          onSave={async (field, value) => {
            await updateTask.mutateAsync({ id: selected.id, data: { [field]: value || null } });
          }}
          onClose={() => setSelectedId(null)}
          autoFocusTitle={selected.title === "New Task"}
        />
      )}
    </div>
  );
}

function DeadlineCell({ deadline, status, minWidth, onSave }: {
  deadline: string | null; status: string; minWidth: number; onSave: (date: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="px-2 flex items-center relative" style={{ minWidth, flex: 1 }}>
      <span
        className="text-xs cursor-pointer hover:bg-card rounded px-1 py-0.5"
        style={getDeadlineStyle(deadline, status)}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      >
        {deadline ? new Date(deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "\u2014"}
      </span>
      {open && (
        <DatePicker value={deadline} onChange={(date) => { onSave(date); setOpen(false); }} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
