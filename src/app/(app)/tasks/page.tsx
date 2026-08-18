"use client";

import { useState, useMemo } from "react";
import { useTasks, useCreateTask, useUpdateTask, useCompleteTask } from "@/hooks/use-tasks";
import { useProjects } from "@/hooks/use-projects";
import { FilterBar, SearchPill, FilterPill } from "@/components/app/FilterBar";
import { FlyoutPanel, type FieldConfig } from "@/components/app/FlyoutPanel";
import { StatusPill } from "@/components/app/StatusPill";
import { QuickAdd } from "@/components/app/QuickAdd";
import { TASK_STATUSES, LIFE_AREAS, PRIORITIES, KANBAN_COLUMNS } from "@/lib/constants";
import { ChevronRight, ChevronDown, List, LayoutGrid } from "lucide-react";

type TaskNode = any & { children: TaskNode[]; depth: number };

function buildTree(tasks: any[]): TaskNode[] {
  const map = new Map<string, TaskNode>();
  const roots: TaskNode[] = [];

  for (const t of tasks) {
    map.set(t.id, { ...t, children: [], depth: 0 });
  }

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

type ViewMode = "table" | "kanban";

export default function TasksPage() {
  const [view, setView] = useState<ViewMode>("table");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const { data: tasks, isLoading } = useTasks();
  const { data: projects } = useProjects();
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const completeTask = useCompleteTask();

  const filtered = useMemo(() => {
    let list = tasks ?? [];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t: any) => t.title?.toLowerCase().includes(q));
    }
    if (statusFilter) list = list.filter((t: any) => t.status === statusFilter);
    if (areaFilter) list = list.filter((t: any) => t.area === areaFilter);
    if (priorityFilter) list = list.filter((t: any) => t.priority === priorityFilter);
    if (projectFilter) list = list.filter((t: any) => t.project_id === projectFilter);
    return list;
  }, [tasks, search, statusFilter, areaFilter, priorityFilter, projectFilter]);

  const tree = useMemo(() => buildTree(filtered), [filtered]);
  const selected = (tasks ?? []).find((t: any) => t.id === selectedId);

  const projectOptions = (projects ?? []).map((p: any) => ({
    value: p.id, label: p.name,
  }));

  const taskFields: FieldConfig[] = [
    { key: "title", label: "Title", type: "text" },
    { key: "notes", label: "Notes", type: "textarea" },
    {
      key: "status", label: "Status", type: "select",
      options: TASK_STATUSES.map(s => ({ value: s.value, label: s.label })),
      displayAs: "pill", pillType: "status",
    },
    {
      key: "priority", label: "Priority", type: "select",
      options: PRIORITIES.map(p => ({ value: p.value, label: p.label })),
      displayAs: "pill", pillType: "priority",
    },
    {
      key: "area", label: "Area", type: "select",
      options: LIFE_AREAS.map(a => ({ value: a.value, label: a.label })),
      displayAs: "pill", pillType: "area",
    },
    {
      key: "project_id", label: "Project", type: "select",
      options: [{ value: "", label: "None" }, ...projectOptions],
    },
    { key: "deadline", label: "Deadline", type: "date" },
  ];

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function renderRows(nodes: any[]): React.ReactNode[] {
    return nodes.flatMap((node) => {
      const hasChildren = node.children.length > 0;
      const isCollapsed = collapsed.has(node.id);
      const isOverdue = node.deadline && new Date(node.deadline) < new Date() && node.status !== "done";
      const indent = node.depth * 24;

      const row = (
        <div
          key={node.id}
          className="flex items-center h-10 border-b border-border-default hover:bg-page text-sm"
        >
          <div className="w-[280px] shrink-0 flex items-center px-3 gap-1" style={{ paddingLeft: `${12 + indent}px` }}>
            {hasChildren ? (
              <button onClick={() => toggleCollapse(node.id)} className="p-0.5 text-text-muted hover:text-text-primary">
                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
            ) : (
              <span className="w-5" />
            )}
            <input
              type="checkbox"
              checked={node.status === "done"}
              onChange={() => completeTask.mutate(node.id)}
              className="w-3.5 h-3.5 rounded border-border-default accent-accent-primary cursor-pointer mr-1"
            />
            <span
              className="truncate cursor-pointer hover:text-accent-primary"
              onClick={() => setSelectedId(node.id)}
            >
              {node.title}
            </span>
          </div>
          <div className="w-[110px] px-3">
            {node.status && <StatusPill value={node.status} type="status" />}
          </div>
          <div className="w-[100px] px-3">
            {node.priority && <StatusPill value={node.priority} type="priority" />}
          </div>
          <div className="w-[140px] px-3 text-text-secondary truncate">
            {node.projects?.name ?? "\u2014"}
          </div>
          <div className="w-[110px] px-3">
            {node.area && <StatusPill value={node.area} type="area" />}
          </div>
          <div className={`w-[110px] px-3 ${isOverdue ? "text-accent-danger font-medium" : "text-text-secondary"}`}>
            {node.deadline
              ? new Date(node.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
              : "\u2014"}
          </div>
        </div>
      );

      if (hasChildren && !isCollapsed) {
        return [row, ...renderRows(node.children)];
      }
      return [row];
    });
  }

  // Kanban helpers
  function handleDragStart(taskId: string) {
    setDraggedId(taskId);
  }

  function handleDrop(defaultWriteStatus: string) {
    if (!draggedId) return;
    updateTask.mutate({ id: draggedId, data: { status: defaultWriteStatus } });
    setDraggedId(null);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Tasks</h1>
        <div className="flex items-center gap-1 border border-border-default rounded-sm">
          <button
            onClick={() => setView("table")}
            className={`p-1.5 ${view === "table" ? "bg-card text-text-primary" : "text-text-muted"}`}
          >
            <List size={16} />
          </button>
          <button
            onClick={() => setView("kanban")}
            className={`p-1.5 ${view === "kanban" ? "bg-card text-text-primary" : "text-text-muted"}`}
          >
            <LayoutGrid size={16} />
          </button>
        </div>
      </div>

      <FilterBar>
        <SearchPill value={search} onChange={setSearch} placeholder="Search tasks..." />
        <FilterPill label="Status" options={TASK_STATUSES.map(s => ({ value: s.value, label: s.label }))} selected={statusFilter} onChange={setStatusFilter} />
        <FilterPill label="Area" options={LIFE_AREAS.map(a => ({ value: a.value, label: a.label }))} selected={areaFilter} onChange={setAreaFilter} />
        <FilterPill label="Priority" options={PRIORITIES.map(p => ({ value: p.value, label: p.label }))} selected={priorityFilter} onChange={setPriorityFilter} />
        {projectOptions.length > 0 && (
          <FilterPill label="Project" options={projectOptions} selected={projectFilter} onChange={setProjectFilter} />
        )}
      </FilterBar>

      {view === "table" ? (
        <div className="border border-border-default rounded-md overflow-hidden bg-elevated">
          <div className="flex h-10 border-b border-border-default bg-card text-xs font-medium text-text-secondary uppercase tracking-wide">
            <div className="w-[280px] shrink-0 px-3 flex items-center">Title</div>
            <div className="w-[110px] px-3 flex items-center">Status</div>
            <div className="w-[100px] px-3 flex items-center">Priority</div>
            <div className="w-[140px] px-3 flex items-center">Project</div>
            <div className="w-[110px] px-3 flex items-center">Area</div>
            <div className="w-[110px] px-3 flex items-center">Deadline</div>
          </div>

          {isLoading ? (
            <div className="space-y-0">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-10 bg-card animate-pulse border-b border-border-default" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-text-secondary">No tasks found</div>
          ) : (
            renderRows(tree)
          )}

          <QuickAdd
            onAdd={(title) => createTask.mutate({ title, status: "inbox" } as any)}
            placeholder="Add task..."
          />
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.map((col) => {
            const colTasks = filtered.filter((t: any) =>
              (col.statuses as readonly string[]).includes(t.status)
            );
            return (
              <div
                key={col.id}
                className="min-w-[260px] flex-1 bg-card rounded-md border border-border-default"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(col.defaultWriteStatus)}
              >
                <div className="px-3 py-2 border-b border-border-default flex items-center justify-between">
                  <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">
                    {col.label}
                  </span>
                  <span className="text-xs text-text-muted">{colTasks.length}</span>
                </div>
                <div className="p-2 space-y-2 min-h-[100px]">
                  {colTasks.map((task: any) => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={() => handleDragStart(task.id)}
                      onClick={() => setSelectedId(task.id)}
                      className="bg-elevated border border-border-default rounded-sm p-3 cursor-grab active:cursor-grabbing hover:shadow-sm transition-shadow"
                    >
                      <p className="text-sm text-text-primary">{task.title}</p>
                      <div className="flex items-center gap-2 mt-2">
                        {task.projects?.name && (
                          <span className="text-xs bg-card text-text-secondary px-1.5 py-0.5 rounded-sm">
                            {task.projects.name}
                          </span>
                        )}
                        {task.priority && task.priority !== "none" && (
                          <StatusPill value={task.priority} type="priority" />
                        )}
                        {task.deadline && (
                          <span className="text-xs text-text-muted ml-auto">
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
          fields={taskFields}
          data={selected}
          onSave={async (field, value) => {
            await updateTask.mutateAsync({
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
