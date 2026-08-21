import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getClient, USER_ID, audit } from '../supabase.js';
import { resolveEntity } from '../resolve.js';

// --- Handlers (exported for testing) ---

export async function handleListContacts(params: {
  search?: string;
  needs_followup?: boolean;
}) {
  const client = getClient();

  // needs_followup reads the today_agenda view, which already does the date
  // arithmetic (last_interaction_at + follow_up_interval_days <= today, or
  // never contacted). The view already excludes archived contacts, so no
  // archived_at filter here.
  if (params.needs_followup) {
    const { data, error } = await client
      .from('today_agenda')
      .select('*')
      .eq('user_id', USER_ID)
      .eq('item_type', 'follow_up');

    if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
    return { contacts: data ?? [], count: data?.length ?? 0 };
  }

  let query = client
    .from('contacts')
    .select('*')
    .eq('user_id', USER_ID)
    .is('archived_at', null);

  if (params.search) {
    query = query.or(
      `full_name.ilike.%${params.search}%,nickname.ilike.%${params.search}%,company.ilike.%${params.search}%`,
    );
  }

  const { data, error } = await query.order('full_name');
  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  return { contacts: data ?? [], count: data?.length ?? 0 };
}

export async function handleCreateContact(params: {
  full_name: string;
  nickname?: string;
  relationship?: string;
  company?: string;
  location?: string;
  emails?: string[];
  phones?: string[];
  birthday?: string;
  how_met?: string;
  follow_up_interval_days?: number;
  notes?: string;
}) {
  const client = getClient();
  const row: Record<string, unknown> = {
    user_id: USER_ID,
    full_name: params.full_name,
  };

  if (params.nickname !== undefined) row.nickname = params.nickname;
  if (params.relationship !== undefined) row.relationship = params.relationship;
  if (params.company !== undefined) row.company = params.company;
  if (params.location !== undefined) row.location = params.location;
  if (params.emails !== undefined) row.emails = params.emails;
  if (params.phones !== undefined) row.phones = params.phones;
  if (params.birthday !== undefined) row.birthday = params.birthday;
  if (params.how_met !== undefined) row.how_met = params.how_met;
  if (params.follow_up_interval_days !== undefined) {
    row.follow_up_interval_days = params.follow_up_interval_days;
  }
  if (params.notes !== undefined) row.notes = params.notes;

  // last_interaction_at is maintained by a DB trigger on interactions — never written here.

  const { data, error } = await client.from('contacts').insert(row).select().single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('insert', 'contacts', data.id, { after: data });
  return { ok: true as const, contact: data };
}

export async function handleUpdateContact(params: {
  identifier: string;
  full_name?: string;
  nickname?: string;
  relationship?: string;
  company?: string;
  location?: string;
  emails?: string[];
  phones?: string[];
  birthday?: string;
  how_met?: string;
  follow_up_interval_days?: number;
  notes?: string;
}) {
  // identifier is used for lookup only — never written to the DB
  const resolved = await resolveEntity('contacts', 'full_name', params.identifier);
  if (!resolved.ok) return resolved;

  const before = resolved.row;
  const patch: Record<string, unknown> = {};

  if (params.full_name !== undefined) patch.full_name = params.full_name;
  if (params.nickname !== undefined) patch.nickname = params.nickname;
  if (params.relationship !== undefined) patch.relationship = params.relationship;
  if (params.company !== undefined) patch.company = params.company;
  if (params.location !== undefined) patch.location = params.location;
  if (params.emails !== undefined) patch.emails = params.emails;
  if (params.phones !== undefined) patch.phones = params.phones;
  if (params.birthday !== undefined) patch.birthday = params.birthday;
  if (params.how_met !== undefined) patch.how_met = params.how_met;
  if (params.follow_up_interval_days !== undefined) {
    patch.follow_up_interval_days = params.follow_up_interval_days;
  }
  if (params.notes !== undefined) patch.notes = params.notes;

  if (Object.keys(patch).length === 0) {
    return {
      ok: false as const,
      error: 'validation_error' as const,
      message: 'No fields to update.',
    };
  }

  const client = getClient();
  const { data, error } = await client
    .from('contacts')
    .update(patch)
    .eq('id', before.id)
    .eq('user_id', USER_ID)
    .select()
    .single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('update', 'contacts', data.id, { before, after: data });
  return { ok: true as const, before, after: data };
}

export async function handleDeleteContact(params: { identifier: string }) {
  const resolved = await resolveEntity('contacts', 'full_name', params.identifier);
  if (!resolved.ok) return resolved;

  const client = getClient();
  const { error } = await client
    .from('contacts')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', resolved.row.id)
    .eq('user_id', USER_ID);

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('delete', 'contacts', resolved.row.id as string, { before: resolved.row });
  return { ok: true as const, message: `Contact "${resolved.row.full_name}" archived.` };
}

// --- MCP Registration ---

/** Wraps a handler result in the MCP text-content envelope. */
function asContent(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

export function registerContactTools(server: McpServer) {
  server.tool(
    'list_contacts',
    'List CRM contacts. Use `search` to match a name, nickname or company (case-insensitive substring). ' +
      'Use `needs_followup` to find people who are overdue for contact — that branch reads the `today_agenda` ' +
      'view instead of the contacts table and returns agenda rows shaped as `item_id` (the contact UUID), ' +
      '`item_title` (the full name), `item_time` (last_interaction_at, null if never contacted) and ' +
      '`item_details` (follow_up_interval_days plus days_overdue), not full contact records.',
    {
      search: z
        .string()
        .optional()
        .describe('Substring to match against full_name, nickname or company (case-insensitive)'),
      needs_followup: z
        .boolean()
        .optional()
        .describe(
          'When true, return contacts overdue for follow-up as today_agenda rows ' +
            '(item_id, item_title, item_time, item_details) instead of contact records',
        ),
    },
    async (params) => asContent(await handleListContacts(params)),
  );

  server.tool(
    'create_contact',
    'Create a new CRM contact. Only full_name is required. Set follow_up_interval_days to have the person ' +
      'appear in the follow-up agenda once that many days pass since the last interaction. ' +
      'last_interaction_at is maintained automatically from logged interactions and cannot be set here.',
    {
      full_name: z.string().describe('Full name of the person'),
      nickname: z.string().optional().describe('Nickname or preferred short name'),
      relationship: z
        .string()
        .optional()
        .describe('How they relate to you (e.g. friend, colleague, family, client)'),
      company: z.string().optional().describe('Company or organisation'),
      location: z.string().optional().describe('Where they are based (city or country)'),
      emails: z.array(z.string()).optional().describe('Email addresses'),
      phones: z.array(z.string()).optional().describe('Phone numbers'),
      birthday: z.string().optional().describe('Birthday (YYYY-MM-DD)'),
      how_met: z.string().optional().describe('How and where you met'),
      follow_up_interval_days: z
        .number()
        .int()
        .optional()
        .describe('Desired number of days between interactions before a follow-up is due'),
      notes: z.string().optional().describe('Freeform notes about the person'),
    },
    async (params) => asContent(await handleCreateContact(params)),
  );

  server.tool(
    'update_contact',
    'Update a contact. Identify it by UUID or full-name search, then provide only the fields to change. ' +
      'emails and phones replace the stored arrays wholesale. last_interaction_at cannot be set here.',
    {
      identifier: z.string().describe('Contact UUID or full name to search for'),
      full_name: z.string().optional().describe('New full name'),
      nickname: z.string().optional().describe('New nickname'),
      relationship: z.string().optional().describe('New relationship description'),
      company: z.string().optional().describe('New company or organisation'),
      location: z.string().optional().describe('New location'),
      emails: z.array(z.string()).optional().describe('Replacement list of email addresses'),
      phones: z.array(z.string()).optional().describe('Replacement list of phone numbers'),
      birthday: z.string().optional().describe('New birthday (YYYY-MM-DD)'),
      how_met: z.string().optional().describe('Updated how-you-met story'),
      follow_up_interval_days: z
        .number()
        .int()
        .optional()
        .describe('New follow-up interval in days'),
      notes: z.string().optional().describe('Updated notes'),
    },
    async (params) => asContent(await handleUpdateContact(params)),
  );

  server.tool(
    'delete_contact',
    'Soft-delete a contact (sets archived_at). The contact is hidden but not destroyed.',
    {
      identifier: z.string().describe('Contact UUID or full name to search for'),
    },
    async (params) => asContent(await handleDeleteContact(params)),
  );
}
