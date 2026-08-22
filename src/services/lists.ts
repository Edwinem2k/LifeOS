import { createClient } from "@/lib/supabase-client";
import { validateMetadata, type ItemFieldDef } from "@/lib/list-schema";

export type List = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  notes: string | null;
  kind: string;
  icon: string | null;
  pinned: boolean;
  pin_order: number | null;
  item_schema: ItemFieldDef[];
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ListItem = {
  id: string;
  user_id: string;
  list_id: string;
  title: string;
  status: "open" | "done";
  notes: string | null;
  metadata: Record<string, unknown>;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

/** item_schema is jsonb and may be null or malformed on hand-edited rows. */
function normalise(row: any): List {
  return { ...row, item_schema: Array.isArray(row.item_schema) ? row.item_schema : [] };
}

export async function getLists(opts?: { includeArchived?: boolean }): Promise<List[]> {
  const supabase = createClient();
  let query = supabase.from("lists").select("*");
  if (!opts?.includeArchived) query = query.is("archived_at", null);

  const { data, error } = await query
    .order("pin_order", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(normalise);
}

/** Open-item counts per list, for the nav. One query, not one per list. */
export async function getOpenCounts(): Promise<Record<string, number>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("list_items")
    .select("list_id")
    .eq("status", "open")
    .is("archived_at", null);
  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.list_id] = (counts[row.list_id] ?? 0) + 1;
  return counts;
}

export async function getList(id: string): Promise<List> {
  const supabase = createClient();
  const { data, error } = await supabase.from("lists").select("*").eq("id", id).single();
  if (error) throw error;
  return normalise(data);
}

export async function createList(data: Partial<List> & { name: string }): Promise<List> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: created, error } = await supabase
    .from("lists")
    .insert({ kind: "custom", item_schema: [], pinned: false, ...data, user_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return normalise(created);
}

export async function updateList(id: string, data: Partial<List>): Promise<List> {
  const supabase = createClient();
  const { data: updated, error } = await supabase
    .from("lists").update(data).eq("id", id).select().single();
  if (error) throw error;
  return normalise(updated);
}

export async function archiveList(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("lists")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function getListItems(listId: string): Promise<ListItem[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("list_items")
    .select("*")
    .eq("list_id", listId)
    .is("archived_at", null)
    .order("sort_order", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ ...row, metadata: row.metadata ?? {} }));
}

export async function createListItem(
  listId: string,
  title: string,
  schema: ItemFieldDef[],
  metadata: Record<string, unknown> = {},
): Promise<ListItem> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const check = validateMetadata(metadata, schema);
  if (!check.ok) throw new Error(check.message);

  // Match the MCP and the rest of the app: new items land at the bottom.
  const { data: maxRow } = await supabase
    .from("list_items")
    .select("sort_order")
    .eq("list_id", listId)
    .is("archived_at", null)
    .order("sort_order", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const { data: created, error } = await supabase
    .from("list_items")
    .insert({
      list_id: listId,
      title,
      metadata,
      user_id: user.id,
      sort_order: (maxRow?.sort_order ?? 0) + 1,
    })
    .select()
    .single();
  if (error) throw error;
  return { ...created, metadata: created.metadata ?? {} };
}

export async function updateListItem(
  id: string,
  data: Partial<ListItem>,
  schema: ItemFieldDef[],
): Promise<ListItem> {
  const supabase = createClient();

  if (data.metadata) {
    const check = validateMetadata(data.metadata, schema);
    if (!check.ok) throw new Error(check.message);
  }

  const { data: updated, error } = await supabase
    .from("list_items").update(data).eq("id", id).select().single();
  if (error) throw error;
  return { ...updated, metadata: updated.metadata ?? {} };
}

export async function deleteListItem(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("list_items")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
