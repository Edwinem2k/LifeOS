"use client";

import { useRef, useEffect, useState } from "react";

export type Column<T> = {
  key: string;
  header: string;
  width?: string;
  render?: (row: T) => React.ReactNode;
};

type Props<T> = {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  frozenFirstColumn?: boolean;
  loading?: boolean;
  emptyMessage?: string;
};

export function DataTable<T extends { id?: string }>({
  columns,
  data,
  onRowClick,
  frozenFirstColumn = true,
  loading = false,
  emptyMessage = "No items",
}: Props<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

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
          <div
            key={i}
            className="h-10 bg-card rounded-sm animate-pulse"
          />
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

  const frozenCol = frozenFirstColumn ? columns[0] : null;
  const scrollCols = frozenFirstColumn ? columns.slice(1) : columns;

  return (
    <div className="border border-border-default rounded-md overflow-hidden bg-elevated">
      <div className="flex">
        {frozenCol && (
          <div
            className={`shrink-0 border-r border-border-default bg-elevated z-10 ${
              scrolled ? "shadow-[2px_0_4px_rgba(0,0,0,0.06)]" : ""
            }`}
            style={{ width: frozenCol.width ?? "240px" }}
          >
            <div className="h-10 flex items-center px-3 text-xs font-medium text-text-secondary uppercase tracking-wide border-b border-border-default bg-card">
              {frozenCol.header}
            </div>
            {data.map((row, i) => (
              <div
                key={(row as any).id ?? i}
                className="h-10 flex items-center px-3 text-sm border-b border-border-default hover:bg-page cursor-pointer"
                onClick={() => onRowClick?.(row)}
              >
                {frozenCol.render
                  ? frozenCol.render(row)
                  : String((row as any)[frozenCol.key] ?? "")}
              </div>
            ))}
          </div>
        )}

        <div ref={scrollRef} className="overflow-x-auto flex-1">
          <div className="min-w-max">
            <div className="flex h-10 border-b border-border-default bg-card">
              {scrollCols.map((col) => (
                <div
                  key={col.key}
                  className="flex items-center px-3 text-xs font-medium text-text-secondary uppercase tracking-wide"
                  style={{ width: col.width ?? "150px" }}
                >
                  {col.header}
                </div>
              ))}
            </div>
            {data.map((row, i) => (
              <div
                key={(row as any).id ?? i}
                className="flex h-10 border-b border-border-default hover:bg-page cursor-pointer"
                onClick={() => onRowClick?.(row)}
              >
                {scrollCols.map((col) => (
                  <div
                    key={col.key}
                    className="flex items-center px-3 text-sm"
                    style={{ width: col.width ?? "150px" }}
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
    </div>
  );
}
