"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { FilterBar, FilterPill } from "@/components/app/FilterBar";
import { QuickAdd } from "@/components/app/QuickAdd";
import { HabitRow } from "@/components/app/HabitRow";
import { HabitFlyout } from "@/components/app/HabitFlyout";
import { scheduleLabel } from "@/components/app/SchedulePicker";
import { LIFE_AREAS } from "@/lib/constants";
import {
  useHabits, useHabitLogs, useCreateHabit, useUpdateHabit,
  useLogHabit, useUnlogHabit,
} from "@/hooks/use-habits";
import {
  computeStats, normalizeSchedule, startOfDay, addDays, type Polarity,
} from "@/lib/habit-stats";

const STATS_WINDOW_DAYS = 365;

export default function HabitsPage() {
  const [showInactive, setShowInactive] = useState(false);
  const [areaFilter, setAreaFilter] = useState<string[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [focusNewTitle, setFocusNewTitle] = useState(false);

  // Stable for the lifetime of the mount. A fresh `new Date()` every render
  // would make `from`/`to` new object identities and defeat every useMemo.
  const today = useMemo(() => startOfDay(new Date()), []);
  const to = useMemo(() => addDays(today, 1), [today]);          // tomorrow's midnight
  const from = useMemo(() => addDays(today, -STATS_WINDOW_DAYS), [today]);

  const habitsQuery = useHabits(showInactive);
  const logsQuery = useHabitLogs(from, to);
  const habits = habitsQuery.data;
  const logs = logsQuery.data ?? [];

  const createHabit = useCreateHabit();
  const updateHabit = useUpdateHabit();
  const logHabit = useLogHabit();
  const unlogHabit = useUnlogHabit();

  /* --- per-habit logs and stats, computed once --- */
  const allRows = useMemo(() => {
    if (!habits) return [];
    const byHabit = new Map<string, { loggedAt: Date }[]>();
    for (const l of logs as any[]) {
      const arr = byHabit.get(l.habit_id) ?? [];
      arr.push({ loggedAt: new Date(l.logged_at) });
      byHabit.set(l.habit_id, arr);
    }
    return habits.map((h: any) => {
      const hLogs = byHabit.get(h.id) ?? [];
      const schedule = normalizeSchedule(h.schedule);
      return {
        habit: h,
        schedule,
        loggedDays: new Set(hLogs.map((l) => startOfDay(l.loggedAt).getTime())),
        stats: computeStats(
          schedule, h.polarity as Polarity, new Date(h.created_at), hLogs, from, to,
        ),
      };
    });
  }, [habits, logs, from, to]);

  const rows = useMemo(
    () => (areaFilter.length === 0
      ? allRows
      : allRows.filter((r) => areaFilter.includes(r.habit.area))),
    [allRows, areaFilter],
  );

  /* --- summary strip (spec §4.5) --- */
  const summary = useMemo(() => {
    // "On track" and "At risk" count BUILD habits only. A break habit
    // satisfies its ceiling at 00:00, so including them would credit every
    // one at midnight — the premature-credit bug currentStreak refuses.
    const build = rows.filter((r) => r.habit.polarity === "build");
    const openBuild = build.filter((r) => r.stats.current);
    const met = openBuild.filter(
      (r) => r.stats.current!.actual >= r.stats.current!.target,
    );
    const atRisk = openBuild.filter(
      (r) => r.stats.currentStreak >= 3 && r.stats.current!.actual < r.stats.current!.target,
    );
    const mean = (xs: number[]) =>
      xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0;
    return {
      hasAny: rows.length > 0,
      hasBuild: build.length > 0,
      onTrack: `${met.length} / ${openBuild.length}`,
      atRisk: String(atRisk.length),
      rate: `${mean(rows.map((r) => r.stats.rate30d))}%`,
      strength: `${mean(rows.map((r) => r.stats.strength))}%`,
    };
  }, [rows]);

  async function handleSave(habitId: string, field: string, value: any) {
    const parsed = field === "active" ? value === "true" : value;
    await updateHabit.mutateAsync({ id: habitId, data: { [field]: parsed } });
  }

  function toggle(habitId: string, loggedDays: Set<number>, date: Date) {
    if (loggedDays.has(startOfDay(date).getTime())) unlogHabit.mutate({ habitId, date });
    else logHabit.mutate({ habitId, date });
  }

  async function handleCreate(name: string) {
    const created = await createHabit.mutateAsync({
      name: name.trim() || "New habit",
      polarity: "build",
      metric_type: "boolean",
      schedule: { type: "daily" },
      active: true,
    } as any);
    setFocusNewTitle(true);
    setOpenId(created.id);
  }

  const openRow = rows.find((r) => r.habit.id === openId) ?? null;
  const isLoading = habitsQuery.isLoading || logsQuery.isLoading;
  const isError = habitsQuery.isError || logsQuery.isError;

  const cards = [
    { label: "On track", caption: "build habits",
      value: summary.hasBuild ? summary.onTrack : "—",
      caveat: summary.hasBuild ? null : "no build habits" },
    { label: "At risk", caption: "build habits",
      value: summary.hasBuild ? summary.atRisk : "—",
      caveat: summary.hasBuild ? null : "no build habits" },
    { label: "30-day rate", caption: "all habits",
      value: summary.hasAny ? summary.rate : "—", caveat: null },
    { label: "Strength", caption: "all habits",
      value: summary.hasAny ? summary.strength : "—", caveat: null },
  ];

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-text-primary">Habits</h1>
        <button
          onClick={() => handleCreate("")}
          className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-accent-primary text-page rounded-sm"
        >
          <Plus size={14} /> New habit
        </button>
      </div>

      <FilterBar>
        <FilterPill
          label="Area"
          options={LIFE_AREAS.map((a: any) => ({ value: a.value, label: a.label }))}
          selected={areaFilter}
          onChange={setAreaFilter}
          pillType="area"
        />
        <button
          onClick={() => setShowInactive((s) => !s)}
          className={`text-xs px-2.5 py-1 rounded-full border ${
            showInactive
              ? "border-accent-primary text-accent-primary"
              : "border-border-default text-text-secondary"
          }`}
        >
          {showInactive ? "All" : "Active"}
        </button>
      </FilterBar>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-5">
        {cards.map((c) => (
          <div key={c.label} className="px-3 py-2.5 bg-card rounded-md">
            <div className="text-lg font-semibold tabular-nums text-text-primary">{c.value}</div>
            <div className="text-[11px] text-text-secondary">{c.label}</div>
            <div className="text-[10px] text-text-muted">{c.caveat ?? c.caption}</div>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 bg-card rounded-md animate-pulse" />
          ))}
        </div>
      ) : isError ? (
        <div className="px-4 py-6 bg-card rounded-md text-sm text-text-secondary">
          Could not load habits.{" "}
          <button
            onClick={() => { habitsQuery.refetch(); logsQuery.refetch(); }}
            className="text-accent-primary underline"
          >
            Try again
          </button>
        </div>
      ) : allRows.length === 0 ? (
        <div className="px-4 py-10 text-center text-sm text-text-secondary">
          No habits yet. Add one below to start tracking.
        </div>
      ) : rows.length === 0 ? (
        // Distinct from "no habits yet" — spec §12 treats these separately.
        <div className="px-4 py-10 text-center text-sm text-text-secondary">
          No habits match this filter.{" "}
          <button onClick={() => setAreaFilter([])} className="text-accent-primary underline">
            Clear filter
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <HabitRow
              key={r.habit.id}
              habit={r.habit}
              schedule={r.schedule}
              stats={r.stats}
              loggedDays={r.loggedDays}
              scheduleLabel={scheduleLabel(r.schedule)}
              today={today}
              onToggleToday={() => toggle(r.habit.id, r.loggedDays, today)}
              onOpen={() => { setFocusNewTitle(false); setOpenId(r.habit.id); }}
            />
          ))}
        </div>
      )}

      <div className="mt-4">
        <QuickAdd placeholder="Add habit..." onAdd={handleCreate} />
      </div>

      {openRow && (
        <HabitFlyout
          habit={openRow.habit}
          today={today}
          autoFocusTitle={focusNewTitle}
          onSave={(field, value) => handleSave(openRow.habit.id, field, value)}
          onToggleDate={(date) => toggle(openRow.habit.id, openRow.loggedDays, date)}
          onClose={() => { setOpenId(null); setFocusNewTitle(false); }}
        />
      )}
    </>
  );
}
