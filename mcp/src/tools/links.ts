import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getClient, USER_ID, audit } from '../supabase.js';
import { resolveEntity } from '../resolve.js';
import { entityTypeSchema, linkRelationSchema } from '../types.js';

/**
 * Maps a link entity_type to its table and the column used for name resolution.
 * `activity_log` resolves on the free-text `note` column — prefer UUIDs there.
 */
export const entityConfig: Record<string, { table: string; nameCol: string }> = {
  task: { table: 'tasks', nameCol: 'title' },
  project: { table: 'projects', nameCol: 'name' },
  goal: { table: 'goals', nameCol: 'title' },
  habit: { table: 'habits', nameCol: 'name' },
  contact: { table: 'contacts', nameCol: 'full_name' },
  note: { table: 'notes', nameCol: 'title' },
  list: { table: 'lists', nameCol: 'name' },
  list_item: { table: 'list_items', nameCol: 'title' },
  event: { table: 'events', nameCol: 'title' },
  document: { table: 'documents', nameCol: 'title' },
  activity_log: { table: 'activity_logs', nameCol: 'note' },
};

const VALID_TYPES = Object.keys(entityConfig).join(', ');

const UUID_HINT =
  'For `activity_log` entities, pass the UUID — name resolution uses the free-text `note` column and is unreliable.';

function unknownType(field: string, value: string) {
  return {
    ok: false as const,
    error: 'validation_error' as const,
    message: `Unknown ${field} "${value}". Valid entity types: ${VALID_TYPES}.`,
  };
}

/** Looks up the display name of a link's other end. Returns null when unresolvable. */
async function resolveOtherName(otherType: string, otherId: string): Promise<string | null> {
  const cfg = entityConfig[otherType];
  if (!cfg || !otherId) return null;

  const client = getClient();
  const { data, error } = await client
    .from(cfg.table)
    .select(`id, ${cfg.nameCol}`)
    .eq('id', otherId)
    .eq('user_id', USER_ID)
    .maybeSingle();

  if (error || !data) return null;
  // The select list is built dynamically, so supabase-js cannot type the row.
  const value = (data as unknown as Record<string, unknown>)[cfg.nameCol];
  return value == null ? null : String(value);
}

// --- Handlers (exported for testing) ---

export async function handleListLinks(params: {
  entity_type: string;
  entity_id?: string;
  entity_name?: string;
}) {
  const cfg = entityConfig[params.entity_type];
  if (!cfg) return unknownType('entity_type', params.entity_type);

  const hasId = params.entity_id !== undefined && params.entity_id !== '';
  const hasName = params.entity_name !== undefined && params.entity_name !== '';
  if (hasId === hasName) {
    return {
      ok: false as const,
      error: 'validation_error' as const,
      message: 'Provide exactly one of entity_id or entity_name.',
    };
  }

  let entityId = params.entity_id as string;
  if (hasName) {
    const resolved = await resolveEntity(cfg.table, cfg.nameCol, params.entity_name as string);
    if (!resolved.ok) return resolved;
    entityId = resolved.row.id as string;
  }

  const client = getClient();

  // Two queries rather than a nested PostgREST or(and(...)) filter: clearer and
  // correct. NOTE: the links table has no archived_at column — never filter it.
  const outgoing = await client
    .from('links')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('src_type', params.entity_type)
    .eq('src_id', entityId);

  if (outgoing.error) {
    return { ok: false as const, error: 'db_error' as const, message: outgoing.error.message };
  }

  const incoming = await client
    .from('links')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('dst_type', params.entity_type)
    .eq('dst_id', entityId);

  if (incoming.error) {
    return { ok: false as const, error: 'db_error' as const, message: incoming.error.message };
  }

  const rows: { link: Record<string, any>; direction: 'outgoing' | 'incoming' }[] = [
    ...((outgoing.data ?? []) as Record<string, any>[]).map((link) => ({
      link,
      direction: 'outgoing' as const,
    })),
    ...((incoming.data ?? []) as Record<string, any>[]).map((link) => ({
      link,
      direction: 'incoming' as const,
    })),
  ];

  const links = [];
  for (const { link, direction } of rows) {
    const otherType = direction === 'outgoing' ? link.dst_type : link.src_type;
    const otherId = direction === 'outgoing' ? link.dst_id : link.src_id;
    links.push({
      ...link,
      direction,
      other_type: otherType,
      other_id: otherId,
      other_name: await resolveOtherName(otherType, otherId),
    });
  }

  return {
    entity_type: params.entity_type,
    entity_id: entityId,
    links,
    count: links.length,
  };
}

export async function handleCreateLink(params: {
  src_type: string;
  src: string;
  dst_type: string;
  dst: string;
  relation: string;
}) {
  const srcCfg = entityConfig[params.src_type];
  if (!srcCfg) return unknownType('src_type', params.src_type);

  const dstCfg = entityConfig[params.dst_type];
  if (!dstCfg) return unknownType('dst_type', params.dst_type);

  const srcResolved = await resolveEntity(srcCfg.table, srcCfg.nameCol, params.src);
  if (!srcResolved.ok) return srcResolved;

  const dstResolved = await resolveEntity(dstCfg.table, dstCfg.nameCol, params.dst);
  if (!dstResolved.ok) return dstResolved;

  const client = getClient();
  const { data, error } = await client
    .from('links')
    .insert({
      user_id: USER_ID,
      src_type: params.src_type,
      src_id: srcResolved.row.id,
      dst_type: params.dst_type,
      dst_id: dstResolved.row.id,
      relation: params.relation,
      created_by: 'agent',
      suggested: false,
    })
    .select()
    .single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('insert', 'links', data.id, { after: data });
  return { ok: true as const, link: data };
}

// --- MCP Registration ---

/** Wraps a handler result in the MCP text-content envelope. */
function asContent(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

export function registerLinkTools(server: McpServer) {
  server.tool(
    'list_links',
    `List every link touching one entity — both outgoing (entity is the source) and incoming (entity is the destination). Each link carries a direction plus the other end's type, id and resolved display name. Identify the entity by UUID (entity_id) or by name (entity_name) — supply exactly one. ${UUID_HINT}`,
    {
      entity_type: entityTypeSchema.describe('Type of the entity whose links you want'),
      entity_id: z
        .string()
        .optional()
        .describe('Entity UUID. Provide this or entity_name, not both.'),
      entity_name: z
        .string()
        .optional()
        .describe('Entity name/title to resolve. Provide this or entity_id, not both.'),
    },
    async (params) => asContent(await handleListLinks(params)),
  );

  server.tool(
    'create_link',
    `Link any two entities together (created_by = 'agent', suggested = false). Both ends are resolved by UUID or name within their own type's table. Links are unique on (src_type, src_id, dst_type, dst_id, relation) — creating the same link twice returns a db_error about a duplicate key. ${UUID_HINT}`,
    {
      src_type: entityTypeSchema.describe('Type of the source entity'),
      src: z.string().describe('Source entity UUID or name/title to resolve'),
      dst_type: entityTypeSchema.describe('Type of the destination entity'),
      dst: z.string().describe('Destination entity UUID or name/title to resolve'),
      relation: linkRelationSchema.describe(
        'Relation from src to dst: related, blocks, mentions, contributes_to, attended, or about',
      ),
    },
    async (params) => asContent(await handleCreateLink(params)),
  );
}
