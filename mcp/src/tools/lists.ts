import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getClient, USER_ID, audit } from '../supabase.js';
import { resolveEntity, isUuid } from '../resolve.js';
import { listKindSchema, listItemStatusSchema } from '../types.js';

// --- Item schema helpers ---

/** The only field types the web app and validateMetadata know how to render and check. */
export const ITEM_FIELD_TYPES = ['text', 'number', 'boolean', 'date', 'select', 'url'] as const;

export type ItemFieldType = (typeof ITEM_FIELD_TYPES)[number];

export interface ItemFieldDef {
  key: string;
  label?: string;
  type: string;
  strict?: boolean;
  options?: string[];
  multiline?: boolean;
  table?: boolean;
  description?: string;
}

/** Normalises a list's `item_schema` column, which may be null or malformed. */
function asSchema(raw: unknown): ItemFieldDef[] {
  return Array.isArray(raw) ? (raw as ItemFieldDef[]) : [];
}

/**
 * Validates list item metadata against the owning list's `item_schema`
 * (CLAUDE.md agent rule 5: respect item_schema when writing metadata).
 * Unknown keys are rejected outright; known keys are type-checked.
 */
export function validateMetadata(
  metadata: Record<string, unknown>,
  schema: Array<{ key: string; type: string; strict?: boolean; options?: string[] }>,
): { ok: true } | { ok: false; error: 'validation_error'; message: string } {
  const validKeys = new Set(schema.map((s) => s.key));
  const unknownKeys = Object.keys(metadata).filter((k) => !validKeys.has(k));
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      error: 'validation_error',
      message: `Unknown metadata keys: ${unknownKeys.join(', ')}. Valid keys: ${
        [...validKeys].join(', ') || '(none — this list has no item_schema)'
      }`,
    };
  }
  for (const def of schema) {
    const val = metadata[def.key];
    if (val === undefined || val === null) continue;
    switch (def.type) {
      case 'number':
        if (typeof val !== 'number') {
          return { ok: false, error: 'validation_error', message: `${def.key} must be a number` };
        }
        break;
      case 'boolean':
        if (typeof val !== 'boolean') {
          return { ok: false, error: 'validation_error', message: `${def.key} must be a boolean` };
        }
        break;
      case 'text':
      case 'date':
      case 'url':
        if (typeof val !== 'string') {
          return { ok: false, error: 'validation_error', message: `${def.key} must be a string` };
        }
        break;
      case 'select':
        if (typeof val !== 'string') {
          return { ok: false, error: 'validation_error', message: `${def.key} must be a string` };
        }
        if (def.strict && !(def.options ?? []).includes(val)) {
          return {
            ok: false,
            error: 'validation_error',
            message: `${def.key} must be one of: ${(def.options ?? []).join(', ')}`,
          };
        }
        break;
      default:
        // The tool boundary rejects unknown types, but item_schema rows written
        // before that existed can still carry anything. Falling through here
        // would let a value of any shape land in jsonb unchecked.
        return {
          ok: false,
          error: 'validation_error',
          message: `${def.key} has an unsupported field type "${def.type}" in this list's item_schema, so its value cannot be validated. Fix the list item_schema with update_list — valid types are: ${ITEM_FIELD_TYPES.join(', ')}.`,
        };
    }
  }
  return { ok: true };
}

// --- Handlers (exported for testing) ---

export async function handleListLists(_params: Record<string, never> | Record<string, unknown>) {
  const client = getClient();

  const { data: lists, error } = await client
    .from('lists')
    .select('*')
    .eq('user_id', USER_ID)
    .is('archived_at', null)
    .order('name');

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };

  // Count non-archived items per list in JS — one extra query beats N per-list counts.
  const { data: items, error: itemsError } = await client
    .from('list_items')
    .select('list_id')
    .eq('user_id', USER_ID)
    .is('archived_at', null);

  if (itemsError) {
    return { ok: false as const, error: 'db_error' as const, message: itemsError.message };
  }

  const counts = new Map<string, number>();
  for (const item of (items ?? []) as Array<{ list_id: string }>) {
    counts.set(item.list_id, (counts.get(item.list_id) ?? 0) + 1);
  }

  const rows = ((lists ?? []) as Array<Record<string, any>>).map((list) => ({
    ...list,
    item_schema: asSchema(list.item_schema),
    item_count: counts.get(list.id as string) ?? 0,
  }));

  return { lists: rows, count: rows.length };
}

export async function handleCreateList(params: {
  name: string;
  kind?: string;
  description?: string;
  icon?: string;
  item_schema?: ItemFieldDef[];
}) {
  const client = getClient();
  const row: Record<string, unknown> = {
    user_id: USER_ID,
    name: params.name,
    kind: params.kind ?? 'custom',
    item_schema: params.item_schema ?? [],
  };

  if (params.description) row.description = params.description;
  if (params.icon) row.icon = params.icon;

  const { data, error } = await client.from('lists').insert(row).select().single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('insert', 'lists', data.id, { after: data });
  return { ok: true as const, list: data };
}

export async function handleListItems(params: { list: string; status?: string }) {
  const resolved = await resolveEntity('lists', 'name', params.list);
  if (!resolved.ok) return resolved;

  const client = getClient();
  let query = client
    .from('list_items')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('list_id', resolved.row.id)
    .is('archived_at', null);

  if (params.status) query = query.eq('status', params.status);

  const { data, error } = await query.order('sort_order');
  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };

  return {
    list: resolved.row.name,
    item_schema: asSchema(resolved.row.item_schema),
    items: data ?? [],
    count: data?.length ?? 0,
  };
}

export async function handleCreateListItem(params: {
  list: string;
  title: string;
  metadata?: Record<string, unknown>;
  status?: string;
}) {
  const resolved = await resolveEntity('lists', 'name', params.list);
  if (!resolved.ok) return resolved;

  const metadata = params.metadata ?? {};
  const check = validateMetadata(metadata, asSchema(resolved.row.item_schema));
  if (!check.ok) {
    return { ok: false as const, error: 'validation_error' as const, message: check.message };
  }

  const client = getClient();

  // New items land at the bottom, matching how the web app orders tasks and
  // projects. Without this the MCP inserts a null sort_order and agent-added
  // items interleave unpredictably with UI-added ones.
  // nullsFirst: false is load-bearing — sort_order is nullable and Postgres
  // defaults DESC to NULLS FIRST, so a single legacy null row would otherwise
  // read back as the max and pin every new item to the top.
  const { data: last } = await client
    .from('list_items')
    .select('sort_order')
    .eq('user_id', USER_ID)
    .eq('list_id', resolved.row.id)
    .is('archived_at', null)
    .order('sort_order', { ascending: false, nullsFirst: false })
    .limit(1);

  const lastRows = (last ?? []) as Array<{ sort_order: number | null }>;
  const maxOrder = lastRows.length > 0 ? (lastRows[0].sort_order ?? 0) : 0;

  const row: Record<string, unknown> = {
    user_id: USER_ID,
    list_id: resolved.row.id,
    title: params.title,
    status: params.status ?? 'open',
    metadata,
    sort_order: maxOrder + 1,
  };

  const { data, error } = await client.from('list_items').insert(row).select().single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('insert', 'list_items', data.id, { after: data });
  return { ok: true as const, item: data };
}

export async function handleUpdateListItem(params: {
  identifier: string;
  list?: string;
  title?: string;
  status?: string;
  metadata?: Record<string, unknown>;
  sort_order?: number;
}) {
  const client = getClient();

  // identifier is used for lookup only — never written to the DB
  const resolved = await resolveListItem(params);
  if (!resolved.ok) return resolved;
  const before: Record<string, any> = resolved.row;
  let listRow: Record<string, any> | null = resolved.listRow;

  const patch: Record<string, unknown> = {};
  if (params.title !== undefined) patch.title = params.title;
  if (params.status !== undefined) patch.status = params.status;
  if (params.sort_order !== undefined) patch.sort_order = params.sort_order;

  if (params.metadata !== undefined) {
    // Fetch the owning list only when we did not already resolve it.
    if (!listRow) {
      const { data, error } = await client
        .from('lists')
        .select('*')
        .eq('id', before.list_id)
        .eq('user_id', USER_ID)
        .is('archived_at', null)
        .maybeSingle();

      if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
      if (!data) {
        return {
          ok: false as const,
          error: 'not_found' as const,
          message: `Owning list "${before.list_id}" not found for this item.`,
        };
      }
      listRow = data as Record<string, any>;
    }

    const check = validateMetadata(params.metadata, asSchema(listRow.item_schema));
    if (!check.ok) {
      return { ok: false as const, error: 'validation_error' as const, message: check.message };
    }
    patch.metadata = params.metadata;
  }

  if (Object.keys(patch).length === 0) {
    return {
      ok: false as const,
      error: 'validation_error' as const,
      message: 'No fields to update.',
    };
  }

  const { data, error } = await client
    .from('list_items')
    .update(patch)
    .eq('id', before.id)
    .eq('user_id', USER_ID)
    .select()
    .single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('update', 'list_items', data.id, { before, after: data });
  return { ok: true as const, before, after: data };
}

type ResolveItemResult =
  | { ok: true; row: Record<string, any>; listRow: Record<string, any> | null }
  | {
      ok: false;
      error: string;
      message: string;
      candidates?: Array<{ id: string; title: string }>;
    };

/**
 * Finds one list item by UUID, or by a title search scoped to its owning list.
 * Titles repeat across lists, so a title lookup with no list is ambiguous by
 * construction and is refused rather than guessed at.
 */
export async function resolveListItem(params: {
  identifier: string;
  list?: string;
}): Promise<ResolveItemResult> {
  if (isUuid(params.identifier)) {
    const resolved = await resolveEntity('list_items', 'title', params.identifier);
    if (!resolved.ok) return resolved as unknown as ResolveItemResult;
    return { ok: true, row: resolved.row, listRow: null };
  }

  if (!params.list) {
    return {
      ok: false,
      error: 'validation_error',
      message: `A list is required to find the item "${params.identifier}" by title. Pass "list", or pass the item's UUID as the identifier.`,
    };
  }

  const listResolved = await resolveEntity('lists', 'name', params.list);
  if (!listResolved.ok) return listResolved as unknown as ResolveItemResult;

  const client = getClient();
  const { data, error } = await client
    .from('list_items')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('list_id', listResolved.row.id)
    .ilike('title', `%${params.identifier}%`)
    .is('archived_at', null);

  if (error) return { ok: false, error: 'db_error', message: error.message };

  const matches = (data ?? []) as Array<Record<string, any>>;
  if (matches.length === 0) {
    return {
      ok: false,
      error: 'not_found',
      message: `No list items found matching "${params.identifier}" in list "${listResolved.row.name}".`,
    };
  }
  if (matches.length > 1) {
    return {
      ok: false,
      error: 'ambiguous',
      message: `Multiple list items match "${params.identifier}" in list "${listResolved.row.name}". Please be more specific.`,
      candidates: matches.map((row) => ({ id: row.id, title: row.title })),
    };
  }
  return { ok: true, row: matches[0], listRow: listResolved.row };
}

export async function handleUpdateList(params: {
  identifier: string;
  name?: string;
  description?: string;
  notes?: string;
  icon?: string;
  pinned?: boolean;
  pin_order?: number;
  item_schema?: ItemFieldDef[];
}) {
  const patch: Record<string, unknown> = {};
  if (params.name !== undefined) patch.name = params.name;
  if (params.description !== undefined) patch.description = params.description;
  if (params.notes !== undefined) patch.notes = params.notes;
  if (params.icon !== undefined) patch.icon = params.icon;
  if (params.pinned !== undefined) patch.pinned = params.pinned;
  if (params.pin_order !== undefined) patch.pin_order = params.pin_order;
  if (params.item_schema !== undefined) patch.item_schema = params.item_schema;

  if (Object.keys(patch).length === 0) {
    return {
      ok: false as const,
      error: 'validation_error' as const,
      message: 'No fields to update.',
    };
  }

  const resolved = await resolveEntity('lists', 'name', params.identifier);
  if (!resolved.ok) return resolved;

  const client = getClient();
  const { data, error } = await client
    .from('lists')
    .update(patch)
    .eq('id', resolved.row.id)
    .eq('user_id', USER_ID)
    .select()
    .single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('update', 'lists', data.id, { before: resolved.row, after: data });
  return { ok: true as const, before: resolved.row, after: data };
}

export async function handleArchiveList(params: { identifier: string }) {
  const resolved = await resolveEntity('lists', 'name', params.identifier);
  if (!resolved.ok) return resolved;

  const client = getClient();
  const { error } = await client
    .from('lists')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', resolved.row.id)
    .eq('user_id', USER_ID)
    .is('archived_at', null);

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('delete', 'lists', resolved.row.id as string, { before: resolved.row });
  return {
    ok: true as const,
    message: `List "${resolved.row.name}" archived. It no longer appears in list_lists or in the app.`,
  };
}

export async function handleDeleteListItem(params: { identifier: string; list?: string }) {
  const resolved = await resolveListItem(params);
  if (!resolved.ok) return resolved;

  const before = resolved.row;
  const client = getClient();
  const { error } = await client
    .from('list_items')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', before.id)
    .eq('user_id', USER_ID)
    .is('archived_at', null);

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('delete', 'list_items', before.id as string, { before });
  return { ok: true as const, message: `Item "${before.title}" removed.` };
}

// --- MCP Registration ---

/** Wraps a handler result in the MCP text-content envelope. */
function asContent(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

/**
 * The web app resolves `icon` against a whitelist of Lucide component names and
 * silently falls back to a generic glyph for anything else — an emoji renders as
 * an anonymous grey icon with no error. Keep this list in step with the app.
 */
const LIST_ICON_NAMES = [
  'BookOpen',
  'Clapperboard',
  'ShoppingBag',
  'Lightbulb',
  'List',
  'Luggage',
  'Home',
  'Gift',
  'Dumbbell',
  'MapPin',
] as const;

const LIST_ICON_DESCRIPTION = `Lucide component name for the list icon — not an emoji, which renders as a blank generic icon. One of: ${LIST_ICON_NAMES.join(', ')}. Anything else falls back to a generic icon.`;

const itemFieldSchema = z.object({
  key: z.string().describe('Metadata key stored on each list item'),
  label: z.string().optional().describe('Human-readable field label'),
  type: z
    .enum(ITEM_FIELD_TYPES)
    .describe('Field type: text, number, boolean, date, url or select'),
  strict: z
    .boolean()
    .optional()
    .describe('For type "select": when true, values must appear in options; when false or omitted, any string is accepted as a suggestion'),
  options: z
    .array(z.string())
    .optional()
    .describe('For type "select": the allowed (or suggested) values'),
  multiline: z.boolean().optional().describe('For type "text": render as a multiline textarea'),
  table: z.boolean().optional().describe('Show this field as a column in the list table view'),
  description: z.string().optional().describe('Help text shown alongside the field'),
});

export function registerListTools(server: McpServer) {
  server.tool(
    'list_lists',
    'List all lists (movies, books, travel, shopping, etc.) with how many items each one holds and the custom item_schema its items must conform to.',
    {},
    async () => asContent(await handleListLists({})),
  );

  server.tool(
    'create_list',
    'Create a new list. Define item_schema up front to give the list custom per-item fields; items whose metadata does not match the schema are rejected.',
    {
      name: z.string().describe('List name, e.g. "Movies to watch"'),
      kind: listKindSchema.optional().default('custom').describe('List kind'),
      description: z.string().optional().describe('What this list is for'),
      icon: z.string().optional().describe(LIST_ICON_DESCRIPTION),
      item_schema: z
        .array(itemFieldSchema)
        .optional()
        .describe('Custom field definitions for items in this list, e.g. [{"key":"director","label":"Director","type":"text"}]'),
    },
    async (params) => asContent(await handleCreateList(params)),
  );

  server.tool(
    'list_items',
    'List the items in one list, ordered by sort_order. Also returns the list item_schema so you know which metadata fields items can carry.',
    {
      list: z.string().describe('List name or UUID'),
      status: listItemStatusSchema.optional().describe('Filter by item status (open or done)'),
    },
    async (params) => asContent(await handleListItems(params)),
  );

  server.tool(
    'create_list_item',
    "Add an item to a list. Read the list's item_schema first (list_lists or list_items) — metadata keys not in the schema, or of the wrong type, are rejected.",
    {
      list: z.string().describe('List name or UUID to add the item to'),
      title: z.string().describe('Item title'),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Custom field values conforming to the list's item_schema"),
      status: listItemStatusSchema.optional().default('open').describe('Initial item status'),
    },
    async (params) => asContent(await handleCreateListItem(params)),
  );

  server.tool(
    'update_list_item',
    'Update a list item. Identify it by UUID, or by a title search plus the list it belongs to (titles repeat across lists). Metadata is validated against the list item_schema.',
    {
      identifier: z.string().describe('Item UUID, or a title to search for within `list`'),
      list: z
        .string()
        .optional()
        .describe('List name — required when identifier is a title rather than a UUID'),
      title: z.string().optional().describe('New item title'),
      status: listItemStatusSchema.optional().describe('New status (open or done)'),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe("Replacement metadata, conforming to the list's item_schema"),
      sort_order: z.number().optional().describe('Manual sort order within the list'),
    },
    async (params) => asContent(await handleUpdateListItem(params)),
  );
  server.tool(
    'update_list',
    'Update a list itself (not its items): rename it, change its icon or description, pin it to the app navigation, or replace its item_schema. Pinned lists appear in the Lists nav dropdown in pin_order; everything else lives under "All lists".',
    {
      identifier: z.string().describe('List UUID or name to search for'),
      name: z.string().optional().describe('New list name'),
      description: z.string().optional().describe('What this list is for'),
      notes: z.string().optional().describe('Freeform notes about the list'),
      icon: z.string().optional().describe(LIST_ICON_DESCRIPTION),
      pinned: z
        .boolean()
        .optional()
        .describe('Pin this list to the nav dropdown, or unpin it'),
      pin_order: z
        .number()
        .optional()
        .describe('Position among pinned lists, low to high'),
      item_schema: z
        .array(itemFieldSchema)
        .optional()
        .describe(
          'Replacement custom field definitions. Replaces the whole array — send every field you want to keep. Existing metadata keys dropped from the schema stay on their items but can no longer be written.',
        ),
    },
    async (params) => asContent(await handleUpdateList(params)),
  );

  server.tool(
    'archive_list',
    'Archive a whole list (sets archived_at). Use this to file away a finished ad-hoc list — a completed shopping trip, a packing list for a trip already taken. The list and its items are hidden but not destroyed.',
    {
      identifier: z.string().describe('List UUID or name to search for'),
    },
    async (params) => asContent(await handleArchiveList(params)),
  );

  server.tool(
    'delete_list_item',
    'Remove one item from a list (soft-delete, sets archived_at). Identify it by UUID, or by a title search plus the list it belongs to. Use this for items added by mistake — to mark something as bought or read, use update_list_item with status "done" instead.',
    {
      identifier: z.string().describe('Item UUID, or a title to search for within `list`'),
      list: z
        .string()
        .optional()
        .describe('List name — required when identifier is a title rather than a UUID'),
    },
    async (params) => asContent(await handleDeleteListItem(params)),
  );
}
