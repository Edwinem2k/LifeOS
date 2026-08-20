import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getClient, USER_ID, audit } from '../supabase.js';
import { resolveEntity } from '../resolve.js';
import { noteKindSchema } from '../types.js';

// --- Handlers (exported for testing) ---

export async function handleListNotes(params: {
  kind?: string;
  since?: string;
  search?: string;
}) {
  const client = getClient();
  let query = client
    .from('notes')
    .select('*')
    .eq('user_id', USER_ID)
    .is('archived_at', null);

  if (params.kind) query = query.eq('kind', params.kind);
  if (params.since) query = query.gte('created_at', params.since);
  if (params.search) {
    query = query.or(`title.ilike.%${params.search}%,body.ilike.%${params.search}%`);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  return { notes: data ?? [], count: data?.length ?? 0 };
}

export async function handleCreateNote(params: {
  body: string;
  title?: string;
  kind?: string;
  note_date?: string;
}) {
  const client = getClient();
  const row: Record<string, unknown> = {
    user_id: USER_ID,
    body: params.body,
    // The DB column defaults to 'note'; the tool always sets kind explicitly
    // so an unspecified kind lands as 'napkin' (quick capture).
    kind: params.kind ?? 'napkin',
    note_date: params.note_date ?? new Date().toISOString().slice(0, 10),
  };

  if (params.title !== undefined) row.title = params.title;

  const { data, error } = await client.from('notes').insert(row).select().single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('insert', 'notes', data.id, { after: data });
  return { ok: true as const, note: data };
}

export async function handleUpdateNote(params: {
  identifier: string;
  title?: string;
  body?: string;
  kind?: string;
  note_date?: string;
}) {
  // identifier is used for lookup only — never written to the DB
  const resolved = await resolveEntity('notes', 'title', params.identifier);
  if (!resolved.ok) return resolved;

  const before = resolved.row;
  const patch: Record<string, unknown> = {};

  if (params.title !== undefined) patch.title = params.title;
  if (params.body !== undefined) patch.body = params.body;
  if (params.kind !== undefined) patch.kind = params.kind;
  if (params.note_date !== undefined) patch.note_date = params.note_date;

  if (Object.keys(patch).length === 0) {
    return {
      ok: false as const,
      error: 'validation_error' as const,
      message: 'No fields to update.',
    };
  }

  const client = getClient();
  const { data, error } = await client
    .from('notes')
    .update(patch)
    .eq('id', before.id)
    .eq('user_id', USER_ID)
    .select()
    .single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('update', 'notes', data.id, { before, after: data });
  return { ok: true as const, before, after: data };
}

export async function handleDeleteNote(params: { identifier: string }) {
  const resolved = await resolveEntity('notes', 'title', params.identifier);
  if (!resolved.ok) return resolved;

  const client = getClient();
  const { error } = await client
    .from('notes')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', resolved.row.id)
    .eq('user_id', USER_ID);

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('delete', 'notes', resolved.row.id as string, { before: resolved.row });
  const label = resolved.row.title ?? resolved.row.id;
  return { ok: true as const, message: `Note "${label}" archived.` };
}

// --- MCP Registration ---

/** Wraps a handler result in the MCP text-content envelope. */
function asContent(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

export function registerNoteTools(server: McpServer) {
  server.tool(
    'list_notes',
    'List notes (morning pages, journal entries, meeting notes, napkin thoughts), newest first. Optionally filter by kind, by creation date, or by a text search across title and body.',
    {
      kind: noteKindSchema.optional().describe('Filter by note kind'),
      since: z
        .string()
        .optional()
        .describe('Only notes created on or after this date (YYYY-MM-DD)'),
      search: z
        .string()
        .optional()
        .describe('Case-insensitive substring searched in both title and body'),
    },
    async (params) => asContent(await handleListNotes(params)),
  );

  server.tool(
    'create_note',
    'Create a note. Only the body is required; kind defaults to "napkin" (quick capture) and note_date defaults to today. Giving a title is recommended — notes without one can only be addressed later by UUID.',
    {
      body: z.string().describe('Note body (markdown)'),
      title: z
        .string()
        .optional()
        .describe('Note title. Optional, but a note without a title can only be found by UUID'),
      kind: noteKindSchema.optional().default('napkin').describe('Note kind'),
      note_date: z
        .string()
        .optional()
        .describe('Date the note is about (YYYY-MM-DD). Defaults to today'),
    },
    async (params) => asContent(await handleCreateNote(params)),
  );

  server.tool(
    'update_note',
    'Update a note. Identify it by UUID or title search, then provide the fields to change. Note titles are nullable, so an untitled note can only be identified by UUID.',
    {
      identifier: z.string().describe('Note UUID or title to search for'),
      title: z.string().optional().describe('New title'),
      body: z.string().optional().describe('New body (replaces the existing body)'),
      kind: noteKindSchema.optional().describe('New note kind'),
      note_date: z.string().optional().describe('New note date (YYYY-MM-DD)'),
    },
    async (params) => asContent(await handleUpdateNote(params)),
  );

  server.tool(
    'delete_note',
    'Soft-delete a note (sets archived_at). The note is hidden but not destroyed. Note titles are nullable, so an untitled note can only be identified by UUID.',
    {
      identifier: z.string().describe('Note UUID or title to search for'),
    },
    async (params) => asContent(await handleDeleteNote(params)),
  );
}
