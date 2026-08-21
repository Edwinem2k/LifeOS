import { createClient } from "@/lib/supabase-client";
import type { Database } from "@/lib/types";

type Habit = Database["public"]["Tables"]["habits"]["Row"];
type HabitInsert = Database["public"]["Tables"]["habits"]["Insert"];
type HabitUpdate = Database["public"]["Tables"]["habits"]["Update"];
type HabitLogRow = Database["public"]["Tables"]["habit_logs"]["Row"];

/**
 * Anchor a log at 12:00 LOCAL on the target date.
 *
 * habit_stats and today_agenda both bucket by
 * (logged_at at time zone 'UTC')::date. Anchoring at noon keeps that SQL
 * bucketing in agreement with habit-stats.ts, which buckets by local date.
 * A log written at 00:30 local would otherwise land on the previous UTC day.
 */
function noonOn(date?: string | Date): string {
  const d = date ? new Date(date) : new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0).toISOString();
}

function dayBounds(date?: string | Date): { start: string; end: string } {
  const d = date ? new Date(date) : new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const end = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

export async function getHabits(opts?: {
  includeInactive?: boolean;
}): Promise<Habit[]> {
  const supabase = createClient();
  let query = supabase
    .from("habits")
    .select("*")
    .is("archived_at", null)
    .order("created_at", { ascending: true });

  if (!opts?.includeInactive) query = query.eq("active", true);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getHabit(id: string): Promise<Habit> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("habits").select("*").eq("id", id).is("archived_at", null).single();
  if (error) throw error;
  return data;
}

export async function createHabit(data: HabitInsert): Promise<Habit> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: created, error } = await supabase
    .from("habits").insert({ ...data, user_id: user.id }).select().single();
  if (error) throw error;
  return created;
}

export async function updateHabit(id: string, data: HabitUpdate): Promise<Habit> {
  const supabase = createClient();
  const { data: updated, error } = await supabase
    .from("habits").update(data).eq("id", id).select().single();
  if (error) throw error;
  return updated;
}

/** Soft delete, matching archiveProject. */
export async function archiveHabit(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("habits")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** All habits, date range. Feeds the row dots, streaks and summary strip. */
export async function getHabitLogs(from: Date, to: Date): Promise<HabitLogRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("habit_logs").select("*").is("archived_at", null)
    .gte("logged_at", from.toISOString())
    .lt("logged_at", to.toISOString())
    .order("logged_at", { ascending: true });
  if (error) throw error;
  return data;
}

/** One habit, unbounded. Feeds the flyout's all-time best streak and heatmap paging. */
export async function getHabitLogsFor(habitId: string): Promise<HabitLogRow[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("habit_logs").select("*").eq("habit_id", habitId)
    .is("archived_at", null)
    .order("logged_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function logHabit(habitId: string, date?: string | Date): Promise<void> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { error } = await supabase.from("habit_logs").insert({
    habit_id: habitId, user_id: user.id, logged_at: noonOn(date), value: 1,
  });
  if (error) throw error;
}

/**
 * Hard delete, deliberately — unlogging is a CORRECTION, not an event.
 * The user is saying the log should never have existed, so there is no
 * history worth preserving. (archiveHabit soft-deletes; this does not.)
 *
 * Deletes by day RANGE. `.eq("logged_at", date)` can never match a timestamp,
 * which is one of the two bugs in the original implementation.
 */
export async function unlogHabit(habitId: string, date?: string | Date): Promise<void> {
  const supabase = createClient();
  const { start, end } = dayBounds(date);
  const { error } = await supabase
    .from("habit_logs").delete().eq("habit_id", habitId)
    .gte("logged_at", start).lt("logged_at", end);
  if (error) throw error;
}
