"use client";

import { useState, useRef, useEffect } from "react";
import { toast } from "@/components/app/Toast";
import { normalizeSchedule, type NormalizedSchedule } from "@/lib/habit-stats";

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"]; // ISO order, Mon first
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function scheduleLabel(s: NormalizedSchedule): string {
  if (s.kind === "daily") return "Daily";
  if (s.kind === "perWeek") return `${s.count}x / week`;
  return s.days.map((d) => DAY_NAMES[d - 1]).join(" ");
}

type Props = {
  value: unknown; // raw jsonb from the habits row
  onSave: (next: object) => Promise<void>;
};

export function SchedulePicker({ value, onSave }: Props) {
  const norm = normalizeSchedule(value);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<NormalizedSchedule["kind"]>(norm.kind);
  const [count, setCount] = useState(norm.kind === "perWeek" ? norm.count : 3);
  const [days, setDays] = useState<number[]>(norm.kind === "days" ? norm.days : [1, 3, 5]);
  const ref = useRef<HTMLDivElement>(null);

  // Re-sync when the habit prop changes underneath us — but NEVER while the
  // popover is open. TanStack refetches ["habits"] on window focus by default,
  // and habit.schedule is a new object identity each time, so without this
  // guard a background refetch wipes an edit in progress.
  useEffect(() => {
    if (open) return;
    const n = normalizeSchedule(value);
    setKind(n.kind);
    if (n.kind === "perWeek") setCount(n.count);
    if (n.kind === "days") setDays(n.days);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) void commit();
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open, kind, count, days]);

  function serialise(): object {
    if (kind === "perWeek") return { type: "per_week", count };
    if (kind === "days") return { type: "daily", days: [...days].sort((a, b) => a - b) };
    return { type: "daily" };
  }

  function resetToProp() {
    const n = normalizeSchedule(value);
    setKind(n.kind);
    setCount(n.kind === "perWeek" ? n.count : 3);
    setDays(n.kind === "days" ? n.days : [1, 3, 5]);
  }

  /**
   * The popover closes ONLY on success. Spec §12 requires that a failed save
   * leaves it open with the previous value restored — closing regardless
   * would silently discard the user's edit.
   */
  async function commit() {
    const next = serialise();
    if (JSON.stringify(next) === JSON.stringify(value)) {
      setOpen(false);
      return;
    }
    try {
      await onSave(next);
      setOpen(false);
    } catch {
      resetToProp(); // restore kind AND count AND days
      toast("Could not save schedule", "error");
      // stays open
    }
  }

  function toggleDay(d: number) {
    setDays((prev) => {
      const next = prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d];
      return next.length === 0 ? prev : next; // never allow an empty selection
    });
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="text-xs font-medium text-text-primary hover:text-accent-primary"
      >
        {scheduleLabel(norm)}
      </button>

      {open && (
        <div className="absolute z-50 mt-2 w-60 p-3 bg-elevated border border-border-default rounded-md shadow-lg space-y-3">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as NormalizedSchedule["kind"])}
            className="w-full text-xs px-2 py-1.5 bg-card border border-border-default rounded-sm"
          >
            <option value="daily">Every day</option>
            <option value="perWeek">N times a week</option>
            <option value="days">Specific days</option>
          </select>

          {kind === "perWeek" && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <button onClick={() => setCount((c) => Math.max(2, c - 1))}
                        aria-label="Fewer times per week"
                        className="w-7 h-7 border border-border-default rounded-sm">-</button>
                <span className="flex-1 text-center text-sm tabular-nums">{count}x / week</span>
                <button onClick={() => setCount((c) => Math.min(6, c + 1))}
                        aria-label="More times per week"
                        className="w-7 h-7 border border-border-default rounded-sm">+</button>
              </div>
              {/* 2-6 only. normalizeSchedule turns count:1 into daily, so offering
                  1 would silently flip the habit to "Every day" on save. */}
              <p className="text-[11px] text-text-muted">
                Once a week? Use <em>Specific days</em> with one day.
              </p>
            </div>
          )}

          {kind === "days" && (
            <div className="flex gap-1">
              {DAY_LABELS.map((label, i) => {
                const d = i + 1;
                const on = days.includes(d);
                return (
                  <button
                    key={i}
                    onClick={() => toggleDay(d)}
                    aria-label={DAY_NAMES[i]}
                    aria-pressed={on}
                    className={`flex-1 h-8 text-[11px] rounded-sm border ${
                      on ? "bg-accent-primary text-page border-accent-primary"
                         : "border-border-default text-text-secondary"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
