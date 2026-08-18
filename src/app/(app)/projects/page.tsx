"use client";

import { useState, useMemo } from "react";
import { useProjects, useUpdateProject } from "@/hooks/use-projects";
import { useProjectProgress } from "@/hooks/use-project-progress";
import { DataTable, type Column } from "@/components/app/DataTable";
import { FilterBar, SearchPill, FilterPill } from "@/components/app/FilterBar";
import { FlyoutPanel, type FieldConfig } from "@/components/app/FlyoutPanel";
import { StatusPill } from "@/components/app/StatusPill";
import { ProgressRing } from "@/components/app/ProgressRing";
import { PROJECT_STATUSES, LIFE_AREAS, PRIORITIES } from "@/lib/constants";

const PROJECT_FIELDS: FieldConfig[] = [
  { key: "outcome", label: "Outcome", type: "textarea", section: "Contract" },
  { key: "target_date", label: "Target Date", type: "date", section: "Contract" },
  { key: "success_check", label: "Success Check", type: "textarea", section: "Contract" },
  { key: "current_status", label: "Current Status", type: "textarea", section: "Now" },
  { key: "next_steps", label: "Next Steps", type: "textarea", section: "Now" },
  { key: "description", label: "Description", type: "textarea", section: "Details" },
  {
    key: "status", label: "Status", type: "select", section: "Details",
    options: PROJECT_STATUSES.map((s) => ({ value: s.value, label: s.label })),
    displayAs: "pill", pillType: "status",
  },
  {
    key: "priority", label: "Priority", type: "select", section: "Details",
    options: PRIORITIES.map((p) => ({ value: p.value, label: p.label })),
    displayAs: "pill", pillType: "priority",
  },
  {
    key: "area", label: "Area", type: "select", section: "Details",
    options: LIFE_AREAS.map((a) => ({ value: a.value, label: a.label })),
    displayAs: "pill", pillType: "area",
  },
  { key: "colour", label: "Colour", type: "text", section: "Details" },
  { key: "notes", label: "Notes", type: "textarea", section: "Details" },
];

export default function ProjectsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [areaFilter, setAreaFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: projects, isLoading } = useProjects();
  const { data: progress } = useProjectProgress();
  const updateProject = useUpdateProject();

  const progressMap = useMemo(
    () => Object.fromEntries((progress ?? []).map((p: any) => [p.project_id, p])),
    [progress]
  );

  const filtered = useMemo(() => {
    let list = projects ?? [];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((p: any) => p.name?.toLowerCase().includes(q));
    }
    if (statusFilter) list = list.filter((p: any) => p.status === statusFilter);
    if (areaFilter) list = list.filter((p: any) => p.area === areaFilter);
    return list;
  }, [projects, search, statusFilter, areaFilter]);

  const selected = filtered.find((p: any) => p.id === selectedId);
  const selectedProgress = selectedId ? progressMap[selectedId] : null;

  const columns: Column<any>[] = [
    { key: "name", header: "Name", width: "240px" },
    {
      key: "status", header: "Status", width: "120px",
      render: (row) => row.status ? <StatusPill value={row.status} type="status" /> : "\u2014",
    },
    {
      key: "area", header: "Area", width: "120px",
      render: (row) => row.area ? <StatusPill value={row.area} type="area" /> : "\u2014",
    },
    {
      key: "priority", header: "Priority", width: "100px",
      render: (row) => row.priority ? <StatusPill value={row.priority} type="priority" /> : "\u2014",
    },
    {
      key: "progress", header: "Progress", width: "120px",
      render: (row) => {
        const prog = progressMap[row.id];
        const pct = prog ? Math.round((prog.done_tasks / Math.max(prog.total_tasks, 1)) * 100) : 0;
        return (
          <div className="flex items-center gap-2">
            <ProgressRing value={pct} size={28} strokeWidth={3} />
          </div>
        );
      },
    },
    {
      key: "target_date", header: "Target Date", width: "120px",
      render: (row) => row.target_date
        ? new Date(row.target_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
        : "\u2014",
    },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Projects</h1>

      <FilterBar>
        <SearchPill value={search} onChange={setSearch} placeholder="Search projects..." />
        <FilterPill
          label="Status"
          options={PROJECT_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
          selected={statusFilter}
          onChange={setStatusFilter}
        />
        <FilterPill
          label="Area"
          options={LIFE_AREAS.map((a) => ({ value: a.value, label: a.label }))}
          selected={areaFilter}
          onChange={setAreaFilter}
        />
      </FilterBar>

      <DataTable
        columns={columns}
        data={filtered}
        loading={isLoading}
        onRowClick={(row) => setSelectedId(row.id)}
        emptyMessage="No projects found"
      />

      {selected && (
        <FlyoutPanel
          title={selected.name}
          fields={PROJECT_FIELDS}
          data={selected}
          stats={
            selectedProgress
              ? [
                  { label: "Total", value: selectedProgress.total_tasks ?? 0 },
                  { label: "Done", value: selectedProgress.done_tasks ?? 0 },
                  { label: "Blocked", value: selectedProgress.blocked_tasks ?? 0 },
                  { label: "Overdue", value: selectedProgress.overdue_tasks ?? 0 },
                ]
              : undefined
          }
          onSave={async (field, value) => {
            await updateProject.mutateAsync({
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
