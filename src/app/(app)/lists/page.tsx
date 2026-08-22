"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { useLists, useCreateList, useOpenCounts } from "@/hooks/use-lists";
import { ListIcon } from "@/components/app/ListIcon";
import type { List } from "@/services/lists";

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-3";

function BandHeading({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <h2 className="text-xs font-medium uppercase tracking-wide text-text-secondary">{label}</h2>
      <div className="h-px flex-1 bg-border-default" />
    </div>
  );
}

function ListCard({ list, count, dimmed }: { list: List; count: number; dimmed?: boolean }) {
  // item_schema is normalised to [] by the service, so this is always safe.
  const fields = list.item_schema.map((f) => f.key).join(" · ");

  return (
    <Link
      href={`/lists/${list.id}`}
      className={`flex flex-col gap-2 p-3 bg-elevated border border-border-default rounded-md transition-colors hover:border-accent-primary ${
        dimmed ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <ListIcon name={list.icon} size={16} className="shrink-0 text-text-secondary" />
        <span className="text-sm font-medium text-text-primary truncate">{list.name}</span>
      </div>
      <p className="text-xs text-text-secondary tabular-nums">
        {count === 1 ? "1 open item" : `${count} open items`}
      </p>
      <p className="text-xs font-mono text-text-muted truncate">
        {fields || "no custom fields"}
      </p>
    </Link>
  );
}

export default function ListsPage() {
  const router = useRouter();
  const [showArchived, setShowArchived] = useState(false);

  const { data: lists } = useLists({ includeArchived: true });
  const { data: counts = {} } = useOpenCounts();
  const createList = useCreateList();

  // Archived wins over pinned: an archived pinned list belongs in the third band.
  // Within each band the service order (pin_order asc, nulls last, then name) holds.
  const { pinned, adHoc, archived } = useMemo(() => {
    const all = lists ?? [];
    const archived = all.filter((l) => l.archived_at != null);
    const live = all.filter((l) => l.archived_at == null);
    return {
      pinned: live.filter((l) => l.pinned),
      adHoc: live.filter((l) => !l.pinned),
      archived,
    };
  }, [lists]);

  function handleCreate() {
    createList.mutate(
      { name: "Untitled list" },
      { onSuccess: (created) => router.push(`/lists/${created.id}`) }
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Lists</h1>
      </div>

      {!lists ? (
        <p className="text-sm text-text-secondary">Loading lists...</p>
      ) : (
        <div className="flex flex-col gap-8">
          <section>
            <BandHeading label="Pinned" />
            {pinned.length === 0 ? (
              <p className="text-sm text-text-muted">No pinned lists</p>
            ) : (
              <div className={GRID}>
                {pinned.map((l) => (
                  <ListCard key={l.id} list={l} count={counts[l.id] ?? 0} />
                ))}
              </div>
            )}
          </section>

          <section>
            <BandHeading label="Ad-hoc" />
            <div className={GRID}>
              {adHoc.map((l) => (
                <ListCard key={l.id} list={l} count={counts[l.id] ?? 0} />
              ))}
              <button
                type="button"
                onClick={handleCreate}
                disabled={createList.isPending}
                className="flex items-center justify-center gap-2 p-3 min-h-[92px] border border-dashed border-border-default rounded-md text-sm font-medium text-text-secondary transition-colors hover:text-accent-primary hover:border-accent-primary disabled:opacity-60"
              >
                <Plus size={15} />
                New list
              </button>
            </div>
          </section>

          {archived.length > 0 && (
            <section>
              <div className="flex items-center gap-3 mb-3">
                <button
                  type="button"
                  onClick={() => setShowArchived((v) => !v)}
                  aria-expanded={showArchived}
                  className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-text-secondary transition-colors hover:text-text-primary"
                >
                  {showArchived ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  Archived · {archived.length}
                </button>
                <div className="h-px flex-1 bg-border-default" />
              </div>
              {showArchived && (
                <div className={GRID}>
                  {archived.map((l) => (
                    <ListCard key={l.id} list={l} count={counts[l.id] ?? 0} dimmed />
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
