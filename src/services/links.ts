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
