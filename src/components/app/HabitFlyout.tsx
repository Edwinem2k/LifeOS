"use client";

import { FlyoutPanel } from "./FlyoutPanel";
import { HabitHeatmap } from "./HabitHeatmap";
import { SchedulePicker } from "./SchedulePicker";
import { useHabitLogsFor, useGoalForHabit } from "@/hooks/use-habits";
import {
  computeStats, normalizeSchedule, startOfDay, addDays, type Polarity,
} from "@/lib/habit-stats";
import { LIFE_AREAS, HABIT_POLARITIES, HABIT_METRICS } from "@/lib/constants";

type Props = {
  habit: any;
  today: Date;
  autoFocusTitle?: boolean;
  onSave: (field: string, value: any) => Promise<void>;
  onToggleDate: (date: Date) => void;
  onClose: () => void;
};

export function HabitFlyout({
  habit, today, autoFocusTitle = false, onSave, onToggleDate, onClose,
}: Props) {
  // Unbounded, single-habit query: the flyout's "Best" is genuinely all-time.
  const { data: logs = [] } = useHabitLogsFor(habit.id);
  const { data: linkedGoal } = useGoalForHabit(habit.id);

  const schedule = normalizeSchedule(habit.schedule);
  const polarity = habit.polarity as Polarity;
  const createdAt = new Date(habit.created_at);

  const loggedDays = new Set(
    logs.map((l: any) => startOfDay(new Date(l.logged_at)).getTime()),
  );

  const stats = computeStats(
    schedule,
    polarity,
    createdAt,
    logs.map((l: any) => ({ loggedAt: new Date(l.logged_at) })),
    new Date(0),                     // unbounded; the creation floor bounds it
    addDays(startOfDay(today), 1),   // `to` is ALWAYS tomorrow's midnight
  );

  const suffix = stats.unit === "week" ? "w" : "d";

  return (
    <FlyoutPanel
      title={habit.name}
      titleField="name"
      data={habit}
      onSave={onSave}
      onClose={onClose}
      autoFocusTitle={autoFocusTitle}
      fields={[
        { key: "polarity", label: "Polarity", type: "select", inline: true, row: 1,
          displayAs: "pill", pillType: "polarity",
          options: HABIT_POLARITIES.map((p) => ({ value: p.value, label: p.label })) },
        { key: "metric_type", label: "Metric", type: "select", inline: true, row: 1,
          displayAs: "pill", pillType: "metric",
          options: HABIT_METRICS.map((m) => ({ value: m.value, label: m.label })) },
        { key: "area", label: "Area", type: "select", inline: true, row: 1,
          displayAs: "pill", pillType: "area",
          options: LIFE_AREAS.map((a: any) => ({ value: a.value, label: a.label })) },
        { key: "active", label: "Active", type: "select", inline: true, row: 2,
          options: [{ value: "true", label: "Yes" }, { value: "false", label: "No" }] },
      ]}
      stats={[
        { label: "Current", value: `${stats.currentStreak}${suffix}`, bold: true },
        { label: "Best", value: `${stats.bestStreak}${suffix}` },
        { label: "30d rate", value: `${stats.rate30d}%` },
        { label: "Strength", value: `${stats.strength}%` },
      ]}
    >
      {/* Schedule lives here rather than in `fields`: EditableCell has no
          jsonb type, and its union is text|textarea|select|date|number. */}
      <div className="px-4 py-3 border-b border-border-default">
        <div className="text-[11px] uppercase tracking-wide text-text-secondary mb-1">
          Schedule
        </div>
        <SchedulePicker
          value={habit.schedule}
          onSave={(next) => onSave("schedule", next)}
        />
      </div>

      <div className="px-4 py-4 space-y-5">
        <section>
          <h3 className="text-xs font-semibold text-text-primary mb-2">History</h3>
          <HabitHeatmap
            schedule={schedule}
            polarity={polarity}
            createdAt={createdAt}
            loggedDays={loggedDays}
            today={today}
            onToggleDate={onToggleDate}
          />
        </section>

        <section>
          <h3 className="text-xs font-semibold text-text-primary mb-2">Habit strength</h3>
          <div className="h-2 rounded-full bg-card overflow-hidden">
            <div
              className="h-full rounded-full transition-[width]"
              style={{
                width: `${stats.strength}%`,
                background:
                  "linear-gradient(90deg, var(--color-accent-warning), var(--color-accent-success))",
              }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-text-secondary mt-1">
            <span>{stats.strength}%</span>
            <span>100% = automatic</span>
          </div>
        </section>

        <section>
          <h3 className="text-xs font-semibold text-text-primary mb-2">Linked goal</h3>
          {linkedGoal ? (
            <a
              href={`/goals?goal=${linkedGoal.id}`}
              className="flex items-center gap-2 px-3 py-2 bg-card border border-border-default rounded-md"
            >
              <div>
                <div className="text-[13px] font-medium text-text-primary">
                  {linkedGoal.title}
                </div>
                <div className="text-[11px] text-text-secondary">
                  {[linkedGoal.area, linkedGoal.horizon].filter(Boolean).join(" · ")}
                </div>
              </div>
            </a>
          ) : (
            <p className="text-[12px] text-text-muted">
              Not linked. Use <strong>+ Link habit</strong> on a goal to connect this.
            </p>
          )}
        </section>
      </div>
    </FlyoutPanel>
  );
}
