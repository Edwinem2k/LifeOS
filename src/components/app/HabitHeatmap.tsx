"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  dotState, canBackfill, startOfDay, isoWeekday,
  type DotState, type NormalizedSchedule, type Polarity,
} from "@/lib/habit-stats";

const CELL: Record<DotState, string> = {
  done:           "bg-accent-success",
  clean:          "bg-accent-success",
  missed:         "bg-accent-danger",
  broke:          "bg-accent-danger",
  pending:        "bg-card border border-border-default",
  future:         "bg-transparent",
  idle:           "bg-card border border-border-default",
  "not-required": "bg-transparent border border-border-default/40",
};

type Props = {
  schedule: NormalizedSchedule;
  polarity: Polarity;
  loggedDays: Set<number>;
  today: Date;
  onToggleDate: (date: Date) => void;
};

export function HabitHeatmap({ schedule, polarity, loggedDays, today, onToggleDate }: Props) {
  const [offset, setOffset] = useState(0); // months back from the current month

  const cursor = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = isoWeekday(new Date(year, month, 1)) - 1; // Mon-first grid

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs">
        <button onClick={() => setOffset((o) => o - 1)} aria-label="Previous month"
                className="p-1 text-text-secondary hover:text-text-primary">
          <ChevronLeft size={14} />
        </button>
        <span className="font-medium">
          {cursor.toLocaleString(undefined, { month: "long", year: "numeric" })}
        </span>
        <button onClick={() => setOffset((o) => Math.min(0, o + 1))}
                disabled={offset >= 0} aria-label="Next month"
                className="p-1 text-text-secondary hover:text-text-primary disabled:opacity-30">
          <ChevronRight size={14} />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {DAY_HEADER.map((d, i) => (
          <div key={i} className="text-[10px] text-text-muted text-center">{d}</div>
        ))}

        {Array.from({ length: leading }, (_, i) => <div key={`pad-${i}`} />)}

        {Array.from({ length: daysInMonth }, (_, i) => {
          const date = new Date(year, month, i + 1);
          const logged = loggedDays.has(startOfDay(date).getTime());
          const state = dotState(schedule, polarity, date, today, logged);
          const clickable = canBackfill(schedule, date, today);
          const isToday = startOfDay(date).getTime() === startOfDay(today).getTime();

          return (
            <button
              key={i}
              onClick={() => clickable && onToggleDate(date)}
              disabled={!clickable}
              title={`${date.toDateString()}${clickable ? "" : " - not scheduled"}`}
              className={`aspect-square rounded-sm ${CELL[state]} ${
                isToday ? "outline outline-2 outline-accent-primary outline-offset-1" : ""
              } ${clickable ? "cursor-pointer hover:opacity-70" : "cursor-default"}`}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 text-[10px] text-text-secondary pt-1">
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-accent-success inline-block" />
          {polarity === "build" ? "Done" : "Clean"}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-accent-danger inline-block" />
          {polarity === "build" ? "Missed" : "Broke"}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-sm bg-card border border-border-default inline-block" />
          Not scheduled
        </span>
      </div>
    </div>
  );
}

const DAY_HEADER = ["M", "T", "W", "T", "F", "S", "S"];
