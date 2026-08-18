import { createClient } from "@/lib/supabase-client";
import type { Database } from "@/lib/types";

type Task = Database["public"]["Tables"]["tasks"]["Row"];
type TaskInsert = Database["public"]["Tables"]["tasks"]["Insert"];
type TaskUpdate = Database["public"]["Tables"]["tasks"]["Update"];

export type TaskWithProject = Task & {
  projects: { name: string } | null;
};

export async function getTasks(filters?: {
  status?: string;
  area?: string;
  priority?: string;
  project_id?: string;
}): Promise<TaskWithProject[]> {
  const supabase = createClient();
  let query = supabase
    .from("tasks")
    .select("*, projects(name)")
    .is("archived_at", null)
    .order("sort_order", { ascending: true, nullsFirst: false });

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.area) query = query.eq("area", filters.area);
  if (filters?.priority) query = query.eq("priority", filters.priority);
  if (filters?.project_id) query = query.eq("project_id", filters.project_id);

  const { data, error } = await query;
  if (error) throw error;
  return data as TaskWithProject[];
}

export async function getTask(id: string): Promise<TaskWithProject> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*, projects(name)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as TaskWithProject;
}

export async function createTask(data: TaskInsert): Promise<Task> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data: created, error } = await supabase
    .from("tasks")
    .insert({ ...data, user_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return created;
}

export async function updateTask(
  id: string,
  data: TaskUpdate
): Promise<Task> {
  const supabase = createClient();
  if (data.status === "done") {
    data = { ...data, completed_at: new Date().toISOString() };
  }
  const { data: updated, error } = await supabase
    .from("tasks")
    .update(data)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return updated;
}

export async function archiveTask(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("tasks")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
