"use client";

import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink } from "lucide-react";
import { useList, useListItems, useCreateListItem, useUpdateListItem, useArchiveList } from "@/hooks/use-lists";
import { DataTable, type Column } from "@/components/app/DataTable";
import { FilterBar, FilterPill } from "@/components/app/FilterBar";
import { ListIcon } from "@/components/app/ListIcon";
import { ListItemFlyout } from "@/components/app/ListItemFlyout";
import { QuickAdd } from "@/components/app/QuickAdd";
import { StatusPill } from "@/components/app/StatusPill";
import { formatLabel } from "@/lib/constants";
import type { ItemFieldDef } from "@/lib/list-schema";
import type { ListItem } from "@/services/lists";

const ITEM_STATUSES = [
  { value: "open", label: "Open" },
  { value: "done", label: "Done" },
];

/** Struck through and dimmed, so a ticked row reads as finished at a glance. */
function doneClass(item: ListItem): string {
  return item.status === "done" ? "line-through text-text-muted" : "";
}

function ItemCheckbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onChange(); }}
      className={`group w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-all cursor-pointer ${
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

function columnWidth(def: ItemFieldDef): string {
  switch (def.type) {
    case "number": return "100px";
    case "boolean": return "90px";
    case "date": return "130px";
    case "select": return "150px";
    default: return "180px";
  }
}

/** One metadata value, rendered for the table. Empty stays empty rather than "—". */
function renderValue(def: ItemFieldDef, item: ListItem) {
  const value = item.metadata?.[def.key];
  if (value === undefined || value === null || value === "") return null;
  const dimmed = doneClass(item);

  switch (def.type) {
    case "number":
      return <span className={`w-full text-right tabular-nums ${dimmed}`}>{String(value)}</span>;
    case "boolean":
      return <span className={dimmed}>{value ? "Yes" : "No"}</span>;
    case "date": {
      const date = new Date(String(value));
      const text = Number.isNaN(date.getTime())
        ? String(value)
        : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      return <span className={`tabular-nums ${dimmed}`}>{text}</span>;
    }
    case "select":
      return (
        <span className={dimmed}>
          <StatusPill value={String(value)} type="status" />
        </span>
      );
    case "url":
      return <span className={`truncate text-text-secondary ${dimmed}`}>{String(value)}</span>;
    default:
      return <span className={`truncate ${dimmed}`}>{String(value)}</span>;
  }
}

export default function ListDetailPage({ params }: { params: Promise<{ id: string }> }) {
  // Next 16 hands route params to a client component as a Promise.
  const { id } = use(params);
  const router = useRouter();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [fieldFilter, setFieldFilter] = useState<string[]>([]);
  const [doneAutoExcluded, setDoneAutoExcluded] = useState(true);

  const { data: list } = useList(id);
  const { data: items } = useListItems(id);
  const createItem = useCreateListItem(id);
  const updateItem = useUpdateListItem(id);
  const archiveList = useArchiveList();

  const schema = useMemo<ItemFieldDef[]>(() => list?.item_schema ?? [], [list]);
  const allItems = useMemo(() => items ?? [], [items]);

  const tableFields = useMemo(() => schema.filter((f) => f.table === true), [schema]);
  const urlField = useMemo(() => schema.find((f) => f.type === "url"), [schema]);
  // A strict select is the only closed option set, so it is the only field whose
  // values make a stable filter. Open selects grow with whatever gets typed.
  const filterField = useMemo(
    () => tableFields.find((f) => f.type === "select" && f.strict === true),
    [tableFields]
  );

  const counts = useMemo(() => ({
    open: allItems.filter((i) => i.status !== "done").length,
    done: allItems.filter((i) => i.status === "done").length,
  }), [allItems]);

  const filtered = useMemo(() => {
    let rows = allItems;
    if (statusFilter.length === 0 && doneAutoExcluded) rows = rows.filter((i) => i.status !== "done");
    if (statusFilter.length > 0) rows = rows.filter((i) => statusFilter.includes(i.status));
    if (filterField && fieldFilter.length > 0) {
      rows = rows.filter((i) => fieldFilter.includes(String(i.metadata?.[filterField.key] ?? "")));
    }
    return rows;
  }, [allItems, statusFilter, doneAutoExcluded, filterField, fieldFilter]);

  const columns = useMemo<Column<ListItem>[]>(() => {
    // The checkbox shares the frozen first column with the title: every other
    // DataTable column is centre-aligned, and a centred title reads wrong.
    const cols: Column<ListItem>[] = [
      {
        key: "title",
        header: "Item",
        width: "320px",
        render: (row) => (
          <span className="inline-flex items-center gap-2 max-w-full">
            <ItemCheckbox
              checked={row.status === "done"}
              onChange={() => updateItem.mutate({
                id: row.id,
                data: { status: row.status === "done" ? "open" : "done" },
                schema,
              })}
            />
            <span className={`truncate ${doneClass(row)}`}>{row.title}</span>
          </span>
        ),
      },
    ];

    for (const def of tableFields) {
      cols.push({
        key: def.key,
        header: def.label ?? def.key,
        width: columnWidth(def),
        render: (row) => renderValue(def, row),
      });
    }

    if (urlField) {
      cols.push({
        key: `${urlField.key}__link`,
        header: "",
        width: "56px",
        render: (row) => {
          const href = row.metadata?.[urlField.key];
          if (typeof href !== "string" || href === "") return null;
          return (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-text-muted hover:text-accent-primary transition-colors"
            >
              <ExternalLink size={14} />
            </a>
          );
        },
      });
    }

    return cols;
  }, [tableFields, urlField, schema, updateItem]);

  const selected = allItems.find((i) => i.id === selectedId) ?? null;

  if (!list || !items) {
    return <p className="text-sm text-text-secondary">Loading list...</p>;
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <ListIcon name={list.icon} size={20} className="shrink-0 text-text-secondary" />
            <h1 className="text-2xl font-semibold truncate">{list.name}</h1>
          </div>
          <p className="text-xs text-text-secondary tabular-nums mt-1">
            {counts.open} open · {counts.done} done
          </p>
        </div>
        <button
          type="button"
          onClick={() => archiveList.mutate(id, { onSuccess: () => router.push("/lists") })}
          disabled={archiveList.isPending}
          className="shrink-0 px-3 py-1.5 text-sm font-medium text-text-secondary border border-border-default rounded-sm transition-colors hover:text-accent-danger hover:border-accent-danger disabled:opacity-60"
        >
          Archive list
        </button>
      </div>

      <FilterBar>
        {/* Always present: it is the only way back to the items already ticked off,
            which the default view hides. An ad-hoc list has nothing else to filter on. */}
        <FilterPill
          label="Status"
          options={ITEM_STATUSES}
          selected={statusFilter}
          onChange={setStatusFilter}
          autoExclude={doneAutoExcluded ? ["done"] : []}
          onRemoveAutoExclude={() => setDoneAutoExcluded(false)}
          onSelectAll={() => setDoneAutoExcluded(true)}
        />
        {filterField && (
          <FilterPill
            label={filterField.label ?? filterField.key}
            options={(filterField.options ?? []).map((v) => ({ value: v, label: formatLabel(v) }))}
            selected={fieldFilter}
            onChange={setFieldFilter}
          />
        )}
      </FilterBar>

      <DataTable
        columns={columns}
        data={filtered}
        onRowClick={(row) => setSelectedId(row.id)}
        emptyMessage="No items"
      />
      <QuickAdd
        placeholder="Add item..."
        onAdd={(title) => createItem.mutate({ title, schema, metadata: {} })}
        onPlusClick={() => {
          createItem.mutate(
            { title: "New item", schema, metadata: {} },
            { onSuccess: (created) => setSelectedId(created.id) }
          );
        }}
      />

      {selected && (
        <ListItemFlyout
          item={selected}
          schema={schema}
          items={allItems}
          onSave={async (data) => {
            await updateItem.mutateAsync({ id: selected.id, data, schema });
          }}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
