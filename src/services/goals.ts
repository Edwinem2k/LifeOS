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
    .order("created_at", { ascending: true });
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
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: created, error } = await supabase
    .from("goals")
    .insert({ ...data, user_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return created;
}

export async function createKeyResult(goalId: string, data: Partial<GoalInsert>): Promise<Goal> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  // Fetch parent goal to inherit required fields (area is NOT NULL)
  const { data: parent, error: parentError } = await supabase
    .from("goals")
    .select("area, horizon")
    .eq("id", goalId)
    .single();
  if (parentError) throw parentError;
  const { data: created, error } = await supabase
    .from("goals")
    .insert({
      ...data,
      user_id: user.id,
      kind: "key_result",
      parent_goal_id: goalId,
      area: data.area ?? parent.area,
      horizon: data.horizon ?? parent.horizon,
      status: "not_started",
    } as GoalInsert)
    .select()
    .single();
  if (error) throw error;
  return created;
}

export async function getKeyResultsForGoal(goalId: string): Promise<Goal[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .eq("parent_goal_id", goalId)
    .eq("kind", "key_result")
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function getGoalsForEntities(
  entityType: "project" | "task",
  entityIds: string[]
): Promise<Record<string, { id: string; title: string }>> {
  if (entityIds.length === 0) return {};
  const supabase = createClient();
  const { data: links, error: linkError } = await supabase
    .from("links")
    .select("src_id, dst_id")
    .eq("src_type", "key_result")
    .eq("dst_type", entityType)
    .eq("relation", "contributes_to")
    .in("dst_id", entityIds);
  if (linkError) throw linkError;
  if (!links?.length) return {};
  const krIds = links.map((l: any) => l.src_id);
  const { data: krs, error: krError } = await supabase
    .from("goals")
    .select("id, parent_goal_id")
    .in("id", krIds);
  if (krError) throw krError;
  const goalIds = [...new Set((krs ?? []).map((kr: any) => kr.parent_goal_id).filter(Boolean))];
  if (goalIds.length === 0) return {};
  const { data: goals, error: goalError } = await supabase
    .from("goals")
    .select("id, title")
    .in("id", goalIds);
  if (goalError) throw goalError;
  const krToGoal: Record<string, any> = {};
  for (const kr of krs ?? []) {
    const goal = (goals ?? []).find((g: any) => g.id === kr.parent_goal_id);
    if (goal) krToGoal[kr.id] = goal;
  }
  const result: Record<string, { id: string; title: string }> = {};
  for (const link of links) {
    const goal = krToGoal[link.src_id];
    if (goal) result[link.dst_id] = goal;
  }
  return result;
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
