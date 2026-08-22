"use client";

import { Check } from "lucide-react";
import { StatusPill } from "./StatusPill";
import {
  dotState, startOfWeek, addDays, startOfDay,
  type DotState, type NormalizedSchedule, type HabitStats, type Polarity,
} from "@/lib/habit-stats";

const DOT_CLASS: Record<DotState, string> = {
  done:           "w-2.5 h-2.5 rounded-full bg-accent-success",
  clean:          "w-2.5 h-2.5 rounded-full bg-accent-success",
  missed:         "w-2.5 h-2.5 rounded-full bg-accent-danger",
  broke:          "w-2.5 h-2.5 rounded-full bg-accent-danger",
  pending:        "w-2.5 h-2.5 rounded-full border border-border-default",
  future:         "w-2.5 h-2.5 rounded-full border border-border-default",
  idle:           "w-1.5 h-1.5 rounded-full border border-border-default",
  "not-required": "w-1.5 h-1.5 rounded-full border border-border-default",
  // Before the habit existed — styled exactly like not-required, so it can
  // read as neither success nor failure.
  "pre-creation": "w-1.5 h-1.5 rounded-full border border-border-default",
};

type Props = {
  habit: any;
  schedule: NormalizedSchedule;
  stats: HabitStats;
  loggedDays: Set<number>;   // startOfDay().getTime()
  scheduleLabel: string;     // "Daily" | "3x / week" | "Mon Wed Fri"
  today: Date;
  onToggleToday: () => void;
  onOpen: () => void;
};

export function HabitRow({
  habit, schedule, stats, loggedDays, scheduleLabel, today, onToggleToday, onOpen,
}: Props) {
  const polarity = habit.polarity as Polarity;
  const createdAt = new Date(habit.created_at);
  const weekStart = startOfWeek(today);
  const loggedToday = loggedDays.has(startOfDay(today).getTime());
  const unitSuffix = stats.unit === "week" ? "w" : "d";
  const showFraction = stats.unit === "week" && stats.current !== null;

  return (
    <div
      onClick={onOpen}
      className={`flex items-center gap-3 px-4 py-3 bg-card rounded-md cursor-pointer hover:bg-elevated transition-colors ${
        habit.active ? "" : "opacity-50"
      }`}
    >
      {/* circle — the only hit target that does not open the flyout */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggleToday(); }}
        disabled={!habit.active}
        aria-label={loggedToday ? `Remove today's log for ${habit.name}` : `Log ${habit.name} for today`}
        aria-pressed={loggedToday}
        className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${
          loggedToday
            ? polarity === "build"
              ? "bg-accent-success text-page"
              : "bg-accent-danger text-page"
            : "border border-text-muted hover:border-accent-primary"
        } disabled:cursor-not-allowed`}
      >
        {loggedToday && <Check size={13} strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-text-primary truncate">{habit.name}</div>
        {/* Only rendered when present — an always-on element would add dead
            vertical space to every row without one. Reading order is
            name -> what it means -> how it's measured. `truncate` is
            deliberate: the flyout is where the full text lives. */}
        {habit.description ? (
          <div className="text-[11px] text-text-secondary truncate mt-0.5">
            {habit.description}
          </div>
        ) : null}
        <div className="flex items-center gap-1.5 mt-0.5">
          {/* The polarity pill is what makes the circle unambiguous: on a break
              habit, filling it is a FAILURE. (Spec §5.2) */}
          <StatusPill value={habit.polarity} type="polarity" />
          <span className="text-[11px] text-text-secondary truncate">
            {scheduleLabel}{habit.area ? ` · ${habit.area}` : ""}
          </span>
        </div>
      </div>

      {/* week dots, Mon -> Sun */}
      <div className="hidden sm:flex items-center gap-1.5 shrink-0">
        {Array.from({ length: 7 }, (_, i) => {
          const day = addDays(weekStart, i);
          const state = dotState(schedule, polarity, createdAt, day, today, loggedDays.has(day.getTime()));
          const isToday = startOfDay(day).getTime() === startOfDay(today).getTime();
          return (
            <span
              key={i}
              title={day.toDateString()}
              className={`inline-flex items-center justify-center ${
                isToday ? "ring-1 ring-accent-primary ring-offset-2 ring-offset-card rounded-full" : ""
              }`}
            >
              <span className={DOT_CLASS[state]} />
            </span>
          );
        })}
      </div>

      {/* streak slot — takes the unit of the habit's period */}
      <div className="shrink-0 text-right w-14">
        {showFraction ? (
          <>
            <div className={`text-sm font-semibold tabular-nums ${
              stats.current!.actual >= stats.current!.target
                ? "text-accent-primary" : "text-text-primary"
            }`}>
              {stats.current!.actual}/{stats.current!.target}
            </div>
            <div className="text-[11px] text-text-secondary tabular-nums">
              {stats.currentStreak}w
            </div>
          </>
        ) : (
          <div className={`text-sm font-semibold tabular-nums ${
            stats.currentStreak > 0 ? "text-accent-primary" : "text-text-muted"
          }`}>
            {stats.currentStreak}{unitSuffix}
          </div>
        )}
      </div>
    </div>
  );
}
