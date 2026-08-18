import { createClient } from "@/lib/supabase-client";
import type { Database } from "@/lib/types";

type Project = Database["public"]["Tables"]["projects"]["Row"];
type ProjectInsert = Database["public"]["Tables"]["projects"]["Insert"];
type ProjectUpdate = Database["public"]["Tables"]["projects"]["Update"];

export async function getProjects(filters?: {
  status?: string;
  area?: string;
}): Promise<Project[]> {
  const supabase = createClient();
  let query = supabase
    .from("projects")
    .select("*")
    .is("archived_at", null)
    .order("sort_order", { ascending: true, nullsFirst: false });

  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.area) query = query.eq("area", filters.area);

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getProject(id: string): Promise<Project> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .is("archived_at", null)
    .single();
  if (error) throw error;
  return data;
}

export async function createProject(data: ProjectInsert): Promise<Project> {
  const supabase = createClient();
  const { data: created, error } = await supabase
    .from("projects")
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return created;
}

export async function updateProject(
  id: string,
  data: ProjectUpdate
): Promise<Project> {
  const supabase = createClient();
  const { data: updated, error } = await supabase
    .from("projects")
    .update(data)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return updated;
}

export async function archiveProject(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("projects")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
