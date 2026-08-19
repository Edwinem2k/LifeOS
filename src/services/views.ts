import { createClient } from "@/lib/supabase-client";

export async function getProjectProgress() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("project_progress")
    .select("*");
  if (error) throw error;
  return data;
}

export async function getGoalProgress() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("goal_progress")
    .select("*");
  if (error) throw error;
  return data;
}

export async function getTodayAgenda() {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("today_agenda")
    .select("*");
  if (error) throw error;
  return data;
}

export async function getAreaProgress() {
  const supabase = createClient();
  const { data, error } = await supabase.from("area_progress").select("*");
  if (error) throw error;
  return data ?? [];
}
