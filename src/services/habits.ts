import { createClient } from "@/lib/supabase-client";

export async function logHabit(habitId: string): Promise<void> {
  const supabase = createClient();
  const today = new Date().toISOString().split("T")[0];
  const { error } = await supabase
    .from("habit_logs")
    .insert({
      habit_id: habitId,
      logged_date: today,
      value: 1,
    });
  if (error) throw error;
}

export async function unlogHabit(
  habitId: string,
  date?: string
): Promise<void> {
  const supabase = createClient();
  const targetDate = date ?? new Date().toISOString().split("T")[0];
  const { error } = await supabase
    .from("habit_logs")
    .delete()
    .eq("habit_id", habitId)
    .eq("logged_date", targetDate);
  if (error) throw error;
}
