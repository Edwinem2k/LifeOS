import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getClient, USER_ID, audit } from '../supabase.js';
import { resolveEntity } from '../resolve.js';
import { interactionKindSchema, interactionSourceSchema } from '../types.js';

// --- Handlers (exported for testing) ---

export async function handleListInteractions(params: {
  contact: string;
  kind?: string;
  since?: string;
}) {
  const resolved = await resolveEntity('contacts', 'full_name', params.contact);
  if (!resolved.ok) return resolved;

  const client = getClient();
  let query = client
    .from('interactions')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('contact_id', resolved.row.id)
    .is('archived_at', null);

  if (params.kind) query = query.eq('kind', params.kind);
  if (params.since) query = query.gte('occurred_at', params.since);

  const { data, error } = await query.order('occurred_at', { ascending: false });
  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };

  return {
    contact: resolved.row.full_name as string,
    interactions: data ?? [],
    count: data?.length ?? 0,
  };
}

export async function handleCreateInteraction(params: {
  contact: string;
  kind: string;
  summary: string;
  occurred_at?: string;
  source?: string;
}) {
  const resolved = await resolveEntity('contacts', 'full_name', params.contact);
  if (!resolved.ok) return resolved;

  // occurred_at is NOT NULL with no DB default — always supply a value.
  // last_interaction_at on contacts is maintained by trg_interactions_update_contact;
  // never write it from here.
  const row: Record<string, unknown> = {
    user_id: USER_ID,
    contact_id: resolved.row.id,
    kind: params.kind,
    summary: params.summary,
    occurred_at: params.occurred_at ?? new Date().toISOString(),
    source: params.source ?? 'agent',
  };

  const client = getClient();
  const { data, error } = await client.from('interactions').insert(row).select().single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('insert', 'interactions', data.id, { after: data });
  return { ok: true as const, interaction: data };
}

// --- MCP Registration ---

/** Wraps a handler result in the MCP text-content envelope. */
function asContent(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

export function registerInteractionTools(server: McpServer) {
  server.tool(
    'list_interactions',
    'List the interaction history for one contact, newest first. The contact is required and is resolved by name. Optionally filter by interaction kind or by a start date.',
    {
      contact: z.string().describe('Contact UUID or full name to search for (required)'),
      kind: interactionKindSchema.optional().describe('Filter by interaction kind'),
      since: z
        .string()
        .optional()
        .describe('Only return interactions that occurred on or after this date (YYYY-MM-DD)'),
    },
    async (params) => asContent(await handleListInteractions(params)),
  );

  server.tool(
    'create_interaction',
    "Log an interaction with a contact (a call, meeting, message, or note). The contact is resolved by name. Inserting an interaction automatically refreshes the contact's last_interaction_at via a database trigger — never write that column yourself.",
    {
      contact: z.string().describe('Contact UUID or full name to search for (required)'),
      kind: interactionKindSchema.describe('Kind of interaction: call, meeting, message, or note'),
      summary: z.string().describe('Short summary of what happened'),
      occurred_at: z
        .string()
        .optional()
        .describe('When it happened (ISO 8601 timestamp). Defaults to now.'),
      source: interactionSourceSchema
        .optional()
        .default('agent')
        .describe('Where this record came from. Defaults to agent.'),
    },
    async (params) => asContent(await handleCreateInteraction(params)),
  );
}
