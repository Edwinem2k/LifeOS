"use client";

import { useRef, useEffect, useState } from "react";
import { GripVertical, ArrowUp, ArrowDown } from "lucide-react";

export type Column<T> = {
  key: string;
  header: string;
  width?: string;
  render?: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number | null;
};

type Props<T> = {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  frozenFirstColumn?: boolean;
  loading?: boolean;
  emptyMessage?: string;
  reorderable?: boolean;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  sortKey?: string | null;
  sortDirection?: "asc" | "desc";
  onSort?: (key: string) => void;
};

function parseWidth(w?: string): number {
  return parseInt(w ?? "150", 10) || 150;
}

export function DataTable<T extends { id?: string }>({
  columns,
  data,
  onRowClick,
  frozenFirstColumn = true,
  loading = false,
  emptyMessage = "No items",
  reorderable = false,
  onReorder,
  sortKey,
  sortDirection,
  onSort,
}: Props<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const frozenCol = frozenFirstColumn ? columns[0] : null;
  const scrollCols = frozenFirstColumn ? columns.slice(1) : columns;

  const [colWidths, setColWidths] = useState<Record<string, number>>(() => {
    const widths: Record<string, number> = {};
    for (const col of columns) {
      widths[col.key] = parseWidth(col.width);
    }
    return widths;
  });
  const resizingRef = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const didResizeRef = useRef(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollLeft > 0);
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 bg-card rounded-sm animate-pulse" />
        ))}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="text-center py-12 text-text-secondary">
        {emptyMessage}
      </div>
    );
  }

  function handleDragStart(i: number) {
    setDragIndex(i);
  }
  function handleDragOver(e: React.DragEvent, i: number) {
    e.preventDefault();
    setOverIndex(i);
  }
  function handleDrop(i: number) {
    if (dragIndex !== null && dragIndex !== i && onReorder) {
      onReorder(dragIndex, i);
    }
    setDragIndex(null);
    setOverIndex(null);
  }
  function handleDragEnd() {
    setDragIndex(null);
    setOverIndex(null);
  }

  function startResize(key: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    didResizeRef.current = true;
    resizingRef.current = { key, startX: e.clientX, startW: colWidths[key] ?? 150 };

    function onMove(ev: MouseEvent) {
      if (!resizingRef.current) return;
      const diff = ev.clientX - resizingRef.current.startX;
      setColWidths((prev) => ({
        ...prev,
        [resizingRef.current!.key]: Math.max(60, resizingRef.current!.startW + diff),
      }));
    }
    function onUp() {
      resizingRef.current = null;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setTimeout(() => { didResizeRef.current = false; }, 0);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function resizeHandle(key: string) {
    return (
      <div
        className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-accent-primary/40 z-10"
        onMouseDown={(e) => startResize(key, e)}
      />
    );
  }

  function sortIndicator(key: string) {
    if (sortKey !== key) return null;
    return sortDirection === "asc" ? (
      <ArrowUp size={12} className="ml-1 shrink-0" />
    ) : (
      <ArrowDown size={12} className="ml-1 shrink-0" />
    );
  }

  const frozenWidth = frozenCol ? colWidths[frozenCol.key] ?? parseWidth(frozenCol.width) : 0;

  return (
    <div className="border border-border-default rounded-md bg-elevated">
      <div className="flex">
        {frozenCol && (
          <div
            className={`shrink-0 border-r border-border-default bg-elevated z-10 ${
              scrolled ? "shadow-[2px_0_4px_rgba(0,0,0,0.06)]" : ""
            }`}
            style={{ width: frozenWidth }}
          >
            <div
              className={`h-10 flex items-center px-3 text-xs font-medium text-text-secondary uppercase tracking-wide border-b border-border-default bg-card relative ${
                onSort ? "cursor-pointer hover:text-text-primary" : ""
              }`}
              onClick={() => { if (!didResizeRef.current) onSort?.(frozenCol.key); }}
            >
              {reorderable && <span className="w-6" />}
              {frozenCol.header}
              {sortIndicator(frozenCol.key)}
              {resizeHandle(frozenCol.key)}
            </div>
            {data.map((row, i) => (
              <div
                key={(row as any).id ?? i}
                draggable={reorderable}
                onDragStart={() => handleDragStart(i)}
                onDragOver={(e) => handleDragOver(e, i)}
                onDrop={() => handleDrop(i)}
                onDragEnd={handleDragEnd}
                className={`h-10 flex items-center px-3 text-sm border-b border-border-default hover:bg-page cursor-pointer ${
                  dragIndex === i ? "opacity-40" : ""
                } ${overIndex === i && dragIndex !== i ? "border-t-2 border-t-accent-primary" : ""}`}
                onClick={() => onRowClick?.(row)}
              >
                {reorderable && (
                  <span
                    className="shrink-0 mr-2 text-text-muted hover:text-text-primary cursor-grab active:cursor-grabbing"
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <GripVertical size={14} />
                  </span>
                )}
                <span className="truncate">
                  {frozenCol.render
                    ? frozenCol.render(row)
                    : String((row as any)[frozenCol.key] ?? "")}
                </span>
              </div>
            ))}
          </div>
        )}

        <div ref={scrollRef} className="flex-1">
          {/* Header */}
          <div className="flex h-10 border-b border-border-default bg-card select-none">
            {scrollCols.map((col) => (
              <div
                key={col.key}
                className={`flex items-center justify-center px-3 text-xs font-medium text-text-secondary uppercase tracking-wide relative ${
                  onSort ? "cursor-pointer hover:text-text-primary" : ""
                }`}
                style={{ minWidth: colWidths[col.key] ?? parseWidth(col.width), flex: 1 }}
                onClick={() => { if (!didResizeRef.current) onSort?.(col.key); }}
              >
                {col.header}
                {sortIndicator(col.key)}
                {resizeHandle(col.key)}
              </div>
            ))}
          </div>
          {/* Rows */}
          {data.map((row, i) => (
            <div
              key={(row as any).id ?? i}
              className={`flex h-10 border-b border-border-default hover:bg-page cursor-pointer ${
                dragIndex === i ? "opacity-40" : ""
              }`}
              onClick={() => onRowClick?.(row)}
            >
              {scrollCols.map((col) => (
                <div
                  key={col.key}
                  className="flex items-center justify-center px-3 text-sm"
                  style={{ minWidth: colWidths[col.key] ?? parseWidth(col.width), flex: 1 }}
                >
                  {col.render
                    ? col.render(row)
                    : String((row as any)[col.key] ?? "")}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
