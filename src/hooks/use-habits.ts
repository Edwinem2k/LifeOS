import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getHabits, getHabit, createHabit, updateHabit, archiveHabit,
  getHabitLogs, getHabitLogsFor, logHabit, unlogHabit,
} from "@/services/habits";
import { getGoalForEntity } from "@/services/links";
import { toast } from "@/components/app/Toast";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export function useHabits(includeInactive = false) {
  return useQuery({
    queryKey: ["habits", includeInactive],
    queryFn: () => getHabits({ includeInactive }),
  });
}

export function useHabit(id: string | null) {
  return useQuery({
    queryKey: ["habits", id],
    queryFn: () => getHabit(id!),
    enabled: !!id,
  });
}

/** Stats window: today-anchored, 365 days. Key members are ISO STRINGS —
 *  a Date is a new object identity every render and would churn the cache. */
export function useHabitLogs(from: Date, to: Date) {
  return useQuery({
    queryKey: ["habit-logs", iso(from), iso(to)],
    queryFn: () => getHabitLogs(from, to),
  });
}

/** Flyout window: unbounded, one habit. */
export function useHabitLogsFor(habitId: string | null) {
  return useQuery({
    queryKey: ["habit-logs", habitId],
    queryFn: () => getHabitLogsFor(habitId!),
    enabled: !!habitId,
  });
}

/** Spec §7.1 item 5 — powers the flyout's Linked goal block.
 *  Requires the widened select in Step 1a below. */
export function useGoalForHabit(habitId: string | null) {
  return useQuery({
    queryKey: ["goal-for-habit", habitId],
    queryFn: () => getGoalForEntity("habit", habitId!),
    enabled: !!habitId,
  });
}

function useInvalidateHabits() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["habits"] });
    qc.invalidateQueries({ queryKey: ["habit-logs"] });
    qc.invalidateQueries({ queryKey: ["today"] });
  };
}

export function useCreateHabit() {
  const invalidate = useInvalidateHabits();
  return useMutation({ mutationFn: createHabit, onSuccess: invalidate });
}

export function useUpdateHabit() {
  const invalidate = useInvalidateHabits();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => updateHabit(id, data),
    onSuccess: invalidate,
  });
}

export function useArchiveHabit() {
  const invalidate = useInvalidateHabits();
  return useMutation({ mutationFn: archiveHabit, onSuccess: invalidate });
}

/* ------------------------------------------------------------------ */
/* Optimistic log / unlog                                              */
/* ------------------------------------------------------------------ */

type ToggleArgs = { habitId: string; date?: Date };

/**
 * TWO caches, not one. useHabitLogs caches a flat array of all habits' logs
 * under ["habit-logs", fromISO, toISO]; useHabitLogsFor caches one habit's
 * logs under ["habit-logs", habitId]. A prefix cancel matches both, but the
 * optimistic write and the restore must handle both shapes — otherwise
 * toggling the circle with the flyout open leaves the heatmap stale.
 */
function useOptimisticToggle(
  fn: (a: ToggleArgs) => Promise<void>,
  mode: "log" | "unlog",
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: ToggleArgs) => fn(a),

    onMutate: async ({ habitId, date }) => {
      await qc.cancelQueries({ queryKey: ["habit-logs"] });
      const snapshots = qc.getQueriesData({ queryKey: ["habit-logs"] });

      const target = date ?? new Date();
      const dayStart = new Date(target.getFullYear(), target.getMonth(), target.getDate());
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      const optimistic = {
        id: `optimistic-${habitId}-${dayStart.getTime()}`,
        habit_id: habitId,
        logged_at: new Date(dayStart.getTime() + 12 * 3_600_000).toISOString(),
        value: 1,
        archived_at: null,
      };

      for (const [key, data] of snapshots) {
        if (!Array.isArray(data)) continue;
        // A single-habit cache (["habit-logs", habitId]) belonging to a
        // DIFFERENT habit must not receive this log. Without the guard, a
        // previously-opened flyout's cache gains a foreign row, and
        // HabitFlyout does not re-filter by habit_id.
        if (key.length === 2 && key[1] !== habitId) continue;

        const next =
          mode === "log"
            ? [...data, optimistic]
            : data.filter((l: any) => {
                if (l.habit_id !== habitId) return true;
                const t = new Date(l.logged_at);
                return !(t >= dayStart && t < dayEnd);
              });
        qc.setQueryData(key, next);
      }

      return { snapshots };
    },

    onError: (_err, _vars, ctx) => {
      for (const [key, data] of ctx?.snapshots ?? []) qc.setQueryData(key, data);
      toast(mode === "log" ? "Could not log habit" : "Could not remove log", "error");
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["habits"] });
      qc.invalidateQueries({ queryKey: ["habit-logs"] });
      qc.invalidateQueries({ queryKey: ["today"] });
    },
  });
}

export function useLogHabit() {
  return useOptimisticToggle(({ habitId, date }) => logHabit(habitId, date), "log");
}

export function useUnlogHabit() {
  return useOptimisticToggle(({ habitId, date }) => unlogHabit(habitId, date), "unlog");
}
