import { createClient } from "@/lib/supabase-client";
import type { Database } from "@/lib/types";

type Link = Database["public"]["Tables"]["links"]["Row"];
type LinkInsert = Database["public"]["Tables"]["links"]["Insert"];

export async function getLinksFor(
  entityType: string,
  entityId: string
): Promise<Link[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("links")
    .select("*")
    .or(
      `and(src_type.eq.${entityType},src_id.eq.${entityId}),and(dst_type.eq.${entityType},dst_id.eq.${entityId})`
    );
  if (error) throw error;
  return data;
}

export async function createLink(data: LinkInsert): Promise<Link> {
  const supabase = createClient();
  const { data: created, error } = await supabase
    .from("links")
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return created;
}

export async function deleteLink(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("links").delete().eq("id", id);
  if (error) throw error;
}

export async function linkKRToEntity(
  krId: string,
  dstType: "project" | "task" | "habit",
  dstId: string
) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const { data, error } = await supabase
    .from("links")
    .insert({
      user_id: user.id,
      src_type: "key_result",
      src_id: krId,
      dst_type: dstType,
      dst_id: dstId,
      relation: "contributes_to",
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function unlinkKR(linkId: string) {
  const supabase = createClient();
  const { error } = await supabase.from("links").delete().eq("id", linkId);
  if (error) throw error;
}

export async function getLinksForKR(krId: string) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("links")
    .select("*")
    .eq("src_type", "key_result")
    .eq("src_id", krId)
    .eq("relation", "contributes_to");
  if (error) throw error;
  return data ?? [];
}

export async function getLinksForKRs(krIds: string[]) {
  if (krIds.length === 0) return [];
  const supabase = createClient();
  const { data, error } = await supabase
    .from("links")
    .select("*")
    .eq("src_type", "key_result")
    .in("src_id", krIds)
    .eq("relation", "contributes_to");
  if (error) throw error;
  return data ?? [];
}

export async function getGoalForEntity(entityType: string, entityId: string) {
  const supabase = createClient();
  const { data: link, error: linkError } = await supabase
    .from("links")
    .select("src_id")
    .eq("dst_type", entityType)
    .eq("dst_id", entityId)
    .eq("src_type", "key_result")
    .eq("relation", "contributes_to")
    .maybeSingle();
  if (linkError) throw linkError;
  if (!link) return null;
  const { data: kr, error: krError } = await supabase
    .from("goals")
    .select("parent_goal_id")
    .eq("id", link.src_id)
    .single();
  if (krError) throw krError;
  if (!kr?.parent_goal_id) return null;
  const { data: goal, error: goalError } = await supabase
    .from("goals")
    .select("id, title")
    .eq("id", kr.parent_goal_id)
    .single();
  if (goalError) throw goalError;
  return goal;
}
