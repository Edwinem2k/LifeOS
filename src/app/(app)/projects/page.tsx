"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useProjects, useCreateProject, useUpdateProject, useReorderProjects } from "@/hooks/use-projects";
import { useProjectProgress } from "@/hooks/use-project-progress";
import { DataTable, type Column } from "@/components/app/DataTable";
import { FilterBar, SearchPill, FilterPill } from "@/components/app/FilterBar";
import { FlyoutPanel, type FieldConfig, type StatConfig } from "@/components/app/FlyoutPanel";
import { EditableCell } from "@/components/app/EditableCell";
import { NotePopover } from "@/components/app/NotePopover";
import { StatusPill } from "@/components/app/StatusPill";
import { ProgressRing } from "@/components/app/ProgressRing";
import { PROJECT_STATUSES, LIFE_AREAS, PRIORITIES } from "@/lib/constants";
import { DatePicker } from "@/components/app/DatePicker";
import { QuickAdd } from "@/components/app/QuickAdd";
import { List, LayoutGrid, Plus } from "lucide-react";

function getDeadlineStyle(date: string | null) {
  if (!date) return {};
  const now = new Date();
  const d = new Date(date);
  const daysUntil = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysUntil < 0) return { color: "var(--color-accent-danger)", fontWeight: 500 };
  if (daysUntil <= 7) return { color: "var(--color-accent-warning)", fontWeight: 500 };
  return { color: "var(--color-accent-success)" };
}

const KANBAN_COLUMNS = [
  { id: "idea", label: "Idea", status: "idea" },
  { id: "active", label: "Active", status: "active" },
  { id: "paused", label: "Paused", status: "paused" },
  { id: "done", label: "Done", status: "done" },
];

const PROJECT_FIELDS: FieldConfig[] = [
  {
    key: "status", label: "Status", type: "select", inline: true,
    options: PROJECT_STATUSES.map((s) => ({ value: s.value, label: s.label })),
    displayAs: "pill", pillType: "status",
  },
  {
    key: "priority", label: "Priority", type: "select", inline: true,
    options: PRIORITIES.map((p) => ({ value: p.value, label: p.label })),
    displayAs: "pill", pillType: "priority",
  },
  {
    key: "area", label: "Area", type: "select", inline: true,
    options: LIFE_AREAS.map((a) => ({ value: a.value, label: a.label })),
    displayAs: "pill", pillType: "area",
  },
  { key: "target_date", label: "Target Date", type: "date", inline: true },
  { key: "description", label: "Description", type: "textarea" },
  { key: "current_status", label: "Current Status", type: "textarea" },
  { key: "next_steps", label: "Next Steps", type: "textarea" },
  { key: "notes", label: "Notes", type: "textarea" },
];

type ViewMode = "table" | "kanban";
type SortDir = "asc" | "desc";

export default function ProjectsPage() {
  const router = useRouter();
  const [view, setView] = useState<ViewMode>("table");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [areaFilter, setAreaFilter] = useState<string[]>([]);
  const [priorityFilter, setPriorityFilter] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [doneAutoExcluded, setDoneAutoExcluded] = useState(true);

  const { data: projects, isLoading } = useProjects();
  const { data: progress } = useProjectProgress();
  const updateProject = useUpdateProject();
  const createProject = useCreateProject();
  const reorderProjects = useReorderProjects();

  const progressMap = useMemo(
    () => Object.fromEntries((progress ?? []).map((p: any) => [p.project_id, p])),
    [progress]
  );

  const filtered = useMemo(() => {
    let list = projects ?? [];
    if (statusFilter.length === 0 && doneAutoExcluded) {
      list = list.filter((p: any) => p.status !== "done");
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p: any) => p.name?.toLowerCase().includes(q));
    }
    if (statusFilter.length > 0) list = list.filter((p: any) => statusFilter.includes(p.status));
    if (areaFilter.length > 0) list = list.filter((p: any) => areaFilter.includes(p.area));
    if (priorityFilter.length > 0) list = list.filter((p: any) => priorityFilter.includes(p.priority));
    return list;
  }, [projects, search, statusFilter, areaFilter, priorityFilter, doneAutoExcluded]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const list = [...filtered];
    const priorityOrder = ["high", "medium", "low"];
    list.sort((a: any, b: any) => {
      let va: any, vb: any;
      if (sortKey === "priority") {
        va = priorityOrder.indexOf(a.priority ?? "medium");
        vb = priorityOrder.indexOf(b.priority ?? "medium");
      } else if (sortKey === "in_work") {
        const pa = progressMap[a.id];
        const pb = progressMap[b.id];
        va = pa ? pa.total_tasks - pa.done_tasks - (pa.blocked_count ?? 0) : 0;
        vb = pb ? pb.total_tasks - pb.done_tasks - (pb.blocked_count ?? 0) : 0;
      } else if (sortKey === "blocked") {
        va = progressMap[a.id]?.blocked_count ?? 0;
        vb = progressMap[b.id]?.blocked_count ?? 0;
      } else if (sortKey === "progress") {
        const pa = progressMap[a.id];
        const pb = progressMap[b.id];
        va = pa ? pa.done_tasks / Math.max(pa.total_tasks, 1) : 0;
        vb = pb ? pb.done_tasks / Math.max(pb.total_tasks, 1) : 0;
      } else {
        va = a[sortKey] ?? "";
        vb = b[sortKey] ?? "";
      }
      if (va < vb) return sortDir === "asc" ? -1 : 1;
      if (va > vb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
    return list;
  }, [filtered, sortKey, sortDir, progressMap]);

  // For kanban, use all projects (not pre-filtered by done)
  const allProjects = useMemo(() => {
    let list = projects ?? [];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p: any) => p.name?.toLowerCase().includes(q));
    }
    if (areaFilter.length > 0) list = list.filter((p: any) => areaFilter.includes(p.area));
    if (priorityFilter.length > 0) list = list.filter((p: any) => priorityFilter.includes(p.priority));
    return list;
  }, [projects, search, areaFilter, priorityFilter]);

  const selected = (projects ?? []).find((p: any) => p.id === selectedId);
  const selectedProgress = selectedId ? progressMap[selectedId] : null;

  const saveField = useCallback(
    (projectId: string, field: string) => async (value: string) => {
      await updateProject.mutateAsync({ id: projectId, data: { [field]: value || null } });
    },
    [updateProject]
  );

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function handleReorder(fromIndex: number, toIndex: number) {
    const reordered = [...sorted];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const updates = reordered.map((p: any, i: number) => ({ id: p.id, sort_order: i }));
    reorderProjects.mutate(updates);
  }

  // Build flyout stats: All, Open, Blocked, Overdue, Done
  const flyoutStats: StatConfig[] | undefined = selectedProgress
    ? (() => {
        const total = selectedProgress.total_tasks ?? 0;
        const done = selectedProgress.done_tasks ?? 0;
        const blocked = selectedProgress.blocked_count ?? 0;
        const overdue = selectedProgress.overdue_count ?? 0;
        const open = total - done - blocked;
        const pid = selectedId!;
        return [
          { label: "All", value: total, href: `/tasks?project=${pid}`, bold: true },
          { label: "Open", value: open, href: `/tasks?project=${pid}` },
          { label: "Blocked", value: blocked, href: `/tasks?project=${pid}&status=blocked` },
          { label: "Overdue", value: overdue, href: `/tasks?project=${pid}` },
          { label: "Done", value: done, href: `/tasks?project=${pid}&status=done` },
        ];
      })()
    : undefined;

  const columns: Column<any>[] = [
    { key: "name", header: "Project", width: "260px" },
    {
      key: "in_work", header: "In Work", width: "90px",
      render: (row) => {
        const prog = progressMap[row.id];
        const inWork = prog ? prog.total_tasks - prog.done_tasks - (prog.blocked_count ?? 0) : 0;
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/tasks?project=${row.id}`);
            }}
            className="w-full h-full flex items-center justify-center text-xs font-medium text-accent-primary hover:underline hover:bg-card/50 rounded-sm"
          >
            {inWork}
          </button>
        );
      },
    },
    {
      key: "blocked", header: "Blocked", width: "90px",
      render: (row) => {
        const prog = progressMap[row.id];
        const blocked = prog?.blocked_count ?? 0;
        return (
          <button
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/tasks?project=${row.id}&status=blocked`);
            }}
            className={`w-full h-full flex items-center justify-center text-xs font-medium rounded-sm hover:bg-card/50 ${
              blocked > 0 ? "text-accent-danger hover:underline" : "text-text-muted"
            }`}
          >
            {blocked}
          </button>
        );
      },
    },
    {
      key: "status", header: "Status", width: "130px",
      render: (row) => (
        <EditableCell
          value={row.status ?? ""}
          onSave={saveField(row.id, "status")}
          type="select"
          options={PROJECT_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
          displayAs="pill"
          pillType="status"
        />
      ),
    },
    {
      key: "area", header: "Area", width: "130px",
      render: (row) => (
        <EditableCell
          value={row.area ?? ""}
          onSave={saveField(row.id, "area")}
          type="select"
          options={LIFE_AREAS.map((a) => ({ value: a.value, label: a.label }))}
          displayAs="pill"
          pillType="area"
        />
      ),
    },
    {
      key: "priority", header: "Priority", width: "120px",
      render: (row) => (
        <EditableCell
          value={row.priority ?? ""}
          onSave={saveField(row.id, "priority")}
          type="select"
          options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
          displayAs="pill"
          pillType="priority"
        />
      ),
    },
    {
      key: "progress", header: "Progress", width: "70px",
      render: (row) => {
        const prog = progressMap[row.id];
        const pct = prog ? Math.round((prog.done_tasks / Math.max(prog.total_tasks, 1)) * 100) : 0;
        return <ProgressRing value={pct} size={28} strokeWidth={3} />;
      },
    },
    {
      key: "target_date", header: "Target Date", width: "130px",
      render: (row) => (
        <ProjectDeadlineCell
          date={row.target_date}
          onSave={(date) => updateProject.mutate({ id: row.id, data: { target_date: date } })}
        />
      ),
    },
    {
      key: "notes_icon", header: "", width: "44px",
      render: (row) => (
        <NotePopover
          notes={row.notes}
          onSave={saveField(row.id, "notes")}
        />
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              createProject.mutate(
                { name: "New Project", status: "active", area: "work" } as any,
                { onSuccess: (created: any) => setSelectedId(created.id) }
              );
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-accent-primary border border-accent-primary rounded-sm hover:bg-accent-primary/10 transition-colors"
          >
            <Plus size={14} />
            New Project
          </button>
          <div className="flex items-center gap-1 border border-border-default rounded-sm">
            <button
              onClick={() => setView("table")}
              className={`p-1.5 rounded-sm transition-colors ${
                view === "table"
                  ? "bg-card text-text-primary"
                  : "text-text-muted hover:text-text-primary hover:bg-card/50"
              }`}
            >
              <List size={16} />
            </button>
            <button
              onClick={() => { setView("kanban"); setStatusFilter([]); setDoneAutoExcluded(false); }}
              className={`p-1.5 rounded-sm transition-colors ${
                view === "kanban"
                  ? "bg-card text-text-primary"
                  : "text-text-muted hover:text-text-primary hover:bg-card/50"
              }`}
            >
              <LayoutGrid size={16} />
            </button>
          </div>
        </div>
      </div>

      <FilterBar>
        <SearchPill value={search} onChange={setSearch} placeholder="Search projects..." />
        <FilterPill label="Priority" options={PRIORITIES.map((p) => ({ value: p.value, label: p.label }))} selected={priorityFilter} onChange={setPriorityFilter} pillType="priority" />
        <FilterPill
          label="Status"
          options={PROJECT_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
          selected={statusFilter}
          onChange={setStatusFilter}
          pillType="status"
          autoExclude={doneAutoExcluded ? ["done"] : []}
          onRemoveAutoExclude={() => setDoneAutoExcluded(false)}
          onSelectAll={() => setDoneAutoExcluded(true)}
        />
        <FilterPill label="Area" options={LIFE_AREAS.map((a) => ({ value: a.value, label: a.label }))} selected={areaFilter} onChange={setAreaFilter} pillType="area" />
      </FilterBar>

      {view === "table" ? (
        <>
          <DataTable
            columns={columns}
            data={sorted}
            loading={isLoading}
            onRowClick={(row) => setSelectedId(row.id)}
            emptyMessage="No projects found"
            reorderable
            onReorder={handleReorder}
            sortKey={sortKey}
            sortDirection={sortDir}
            onSort={handleSort}
          />
          <QuickAdd
            placeholder="Add project..."
            onAdd={(name) => createProject.mutate({ name, status: "active", area: "work" } as any)}
          />
        </>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {KANBAN_COLUMNS.map((col) => {
            const colProjects = allProjects.filter((p: any) => p.status === col.status);
            return (
              <div
                key={col.id}
                className="min-w-[280px] flex-1 bg-card rounded-md border border-border-default"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain");
                  if (id) {
                    updateProject.mutate({ id, data: { status: col.status } });
                  }
                }}
              >
                <div className="px-3 py-2 border-b border-border-default flex items-center justify-between">
                  <span className="text-xs font-medium text-text-secondary uppercase tracking-wide">
                    {col.label}
                  </span>
                  <span className="text-xs text-text-muted">{colProjects.length}</span>
                </div>
                <div className="p-2 space-y-2 min-h-[100px]">
                  {colProjects.map((project: any) => {
                    const prog = progressMap[project.id];
                    const pct = prog ? Math.round((prog.done_tasks / Math.max(prog.total_tasks, 1)) * 100) : 0;
                    return (
                      <div
                        key={project.id}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData("text/plain", project.id);
                          e.dataTransfer.effectAllowed = "move";
                          setDraggedId(project.id);
                        }}
                        onDragEnd={() => setDraggedId(null)}
                        onClick={() => setSelectedId(project.id)}
                        className={`bg-elevated border border-border-default rounded-sm p-3 cursor-grab active:cursor-grabbing hover:shadow-sm transition-shadow ${
                          draggedId === project.id ? "opacity-40" : ""
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <ProgressRing value={pct} size={24} strokeWidth={2.5} />
                          <p className="text-sm font-medium text-text-primary flex-1 truncate">
                            {project.name}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 mt-2">
                          {project.area && <StatusPill value={project.area} type="area" />}
                          {project.priority && <StatusPill value={project.priority} type="priority" />}
                          {project.target_date && (
                            <span className="text-xs ml-auto" style={getDeadlineStyle(project.target_date)}>
                              {new Date(project.target_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <FlyoutPanel
          title={selected.name}
          fields={PROJECT_FIELDS}
          data={selected}
          stats={flyoutStats}
          onSave={async (field, value) => {
            await updateProject.mutateAsync({
              id: selected.id,
              data: { [field]: value || null },
            });
          }}
          onClose={() => setSelectedId(null)}
          autoFocusTitle={selected.name === "New Project"}
        />
      )}
    </div>
  );
}

function ProjectDeadlineCell({
  date,
  onSave,
}: {
  date: string | null;
  onSave: (date: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <span
        className="text-xs cursor-pointer hover:bg-card rounded px-1 py-0.5"
        style={date ? getDeadlineStyle(date) : { color: "var(--color-text-muted)" }}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        {date
          ? new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
          : "\u2014"}
      </span>
      {open && (
        <DatePicker
          value={date}
          onChange={(newDate) => {
            onSave(newDate);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
