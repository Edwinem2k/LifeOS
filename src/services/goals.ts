import { createClient } from "@/lib/supabase-client";
import type { Database } from "@/lib/types";

type Goal = Database["public"]["Tables"]["goals"]["Row"];
type GoalInsert = Database["public"]["Tables"]["goals"]["Insert"];
type GoalUpdate = Database["public"]["Tables"]["goals"]["Update"];

export async function getGoals(): Promise<Goal[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .is("archived_at", null)
    .order("sort_order", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data;
}

export async function getGoal(id: string): Promise<Goal> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

export async function createGoal(data: GoalInsert): Promise<Goal> {
  const supabase = createClient();
  const { data: created, error } = await supabase
    .from("goals")
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return created;
}

export async function updateGoal(id: string, data: GoalUpdate): Promise<Goal> {
  const supabase = createClient();
  const { data: updated, error } = await supabase
    .from("goals")
    .update(data)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return updated;
}

export async function archiveGoal(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("goals")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
