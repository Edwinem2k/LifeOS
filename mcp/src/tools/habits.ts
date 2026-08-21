import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getClient, USER_ID, audit } from '../supabase.js';
import { resolveEntity, resolveByName } from '../resolve.js';
import { habitPolaritySchema, habitMetricTypeSchema } from '../types.js';

/** Documented shape of the `habits.schedule` jsonb column. */
const scheduleSchema = z.record(z.string(), z.unknown());

const SCHEDULE_DESCRIPTION =
  'Schedule object (jsonb), e.g. {"type":"daily"}, {"type":"per_week","count":3}, ' +
  '{"type":"daily","days":[1,3,5]} where days are ISO weekday numbers (1 = Monday)';

const STATS_COLUMNS =
  'habit_id, user_id, name, polarity, active, rate_30d, rate_90d, current_streak, longest_streak, strength_score';

// --- Handlers (exported for testing) ---

export async function handleListHabits(params: { active_only?: boolean }) {
  const client = getClient();
  // habit_stats is a VIEW that already excludes archived habits — never filter archived_at here.
  let query = client.from('habit_stats').select(STATS_COLUMNS).eq('user_id', USER_ID);

  const activeOnly = params.active_only ?? true;
  if (activeOnly) query = query.eq('active', true);

  const { data, error } = await query.order('name');
  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  return { habits: data ?? [], count: data?.length ?? 0 };
}

export async function handleLogHabit(params: {
  habit: string;
  value?: number;
  note?: string;
  logged_at?: string;
}) {
  const resolved = await resolveByName('habits', 'name', params.habit);
  if (!resolved.ok) return resolved;

  const client = getClient();
  const row: Record<string, unknown> = {
    user_id: USER_ID,
    habit_id: resolved.row.id,
    value: params.value ?? 1,
    // habit_logs.logged_at has no client-side default here — always supply it.
    logged_at: params.logged_at ?? new Date().toISOString(),
  };
  if (params.note !== undefined) row.note = params.note;

  const { data: logEntry, error } = await client
    .from('habit_logs')
    .insert(row)
    .select()
    .single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('insert', 'habit_logs', logEntry.id, { after: logEntry });

  // Re-query the view so the caller sees the refreshed streak / strength numbers.
  const { data: stats } = await client
    .from('habit_stats')
    .select(STATS_COLUMNS)
    .eq('habit_id', resolved.row.id)
    .eq('user_id', USER_ID)
    .maybeSingle();

  return { ok: true as const, logged: logEntry, stats: stats ?? null };
}

export async function handleCreateHabit(params: {
  name: string;
  schedule?: Record<string, unknown>;
  metric_type?: string;
  polarity?: string;
  target_value?: number;
}) {
  const client = getClient();
  const row: Record<string, unknown> = {
    user_id: USER_ID,
    name: params.name,
    schedule: params.schedule ?? { type: 'daily' },
    metric_type: params.metric_type ?? 'boolean',
    polarity: params.polarity ?? 'build',
  };

  if (params.target_value !== undefined) row.target_value = params.target_value;

  const { data, error } = await client.from('habits').insert(row).select().single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('insert', 'habits', data.id, { after: data });
  return { ok: true as const, habit: data };
}

export async function handleUpdateHabit(params: {
  identifier: string;
  name?: string;
  schedule?: Record<string, unknown>;
  metric_type?: string;
  polarity?: string;
  target_value?: number;
  active?: boolean;
}) {
  // identifier is used for lookup only — never written to the DB
  const resolved = await resolveEntity('habits', 'name', params.identifier);
  if (!resolved.ok) return resolved;

  const before = resolved.row;
  const patch: Record<string, unknown> = {};

  if (params.name !== undefined) patch.name = params.name;
  if (params.schedule !== undefined) patch.schedule = params.schedule;
  if (params.metric_type !== undefined) patch.metric_type = params.metric_type;
  if (params.polarity !== undefined) patch.polarity = params.polarity;
  if (params.target_value !== undefined) patch.target_value = params.target_value;
  if (params.active !== undefined) patch.active = params.active;

  if (Object.keys(patch).length === 0) {
    return {
      ok: false as const,
      error: 'validation_error' as const,
      message: 'No fields to update.',
    };
  }

  const client = getClient();
  const { data, error } = await client
    .from('habits')
    .update(patch)
    .eq('id', before.id)
    .eq('user_id', USER_ID)
    .is('archived_at', null)
    .select()
    .single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('update', 'habits', data.id, { before, after: data });
  return { ok: true as const, before, after: data };
}

export async function handleDeleteHabit(params: { identifier: string }) {
  const resolved = await resolveEntity('habits', 'name', params.identifier);
  if (!resolved.ok) return resolved;

  const client = getClient();
  const { error } = await client
    .from('habits')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', resolved.row.id)
    .eq('user_id', USER_ID)
    .is('archived_at', null);

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('delete', 'habits', resolved.row.id as string, { before: resolved.row });
  return { ok: true as const, message: `Habit "${resolved.row.name}" archived.` };
}

// --- MCP Registration ---

/** Wraps a handler result in the MCP text-content envelope. */
function asContent(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

export function registerHabitTools(server: McpServer) {
  server.tool(
    'list_habits',
    'List habits with computed stats from the habit_stats view: 30/90-day completion rate, current and longest streak, and EWMA strength score. Active habits only by default.',
    {
      active_only: z
        .boolean()
        .optional()
        .default(true)
        .describe('Only return habits marked active (default true)'),
    },
    async (params) => asContent(await handleListHabits(params)),
  );

  server.tool(
    'log_habit',
    'Log a habit completion and return the refreshed streak stats. For build-polarity habits this records that you did the thing; for break-polarity habits logging means the bad thing HAPPENED (the streak counts days without a log). Use value = 1 for boolean habits.',
    {
      habit: z.string().describe('Habit name (resolved by name)'),
      value: z
        .number()
        .optional()
        .describe('Logged value — 1 for boolean habits, otherwise the count/duration/value'),
      note: z.string().optional().describe('Optional note about this log entry'),
      logged_at: z
        .string()
        .optional()
        .describe('ISO timestamp of the occurrence (defaults to now)'),
    },
    async (params) => asContent(await handleLogHabit(params)),
  );

  server.tool(
    'create_habit',
    'Create a new habit. Defaults to a daily, boolean, build-polarity habit.',
    {
      name: z.string().describe('Habit name'),
      schedule: scheduleSchema.optional().describe(SCHEDULE_DESCRIPTION),
      metric_type: habitMetricTypeSchema
        .optional()
        .describe('How the habit is measured: boolean, count, duration or value'),
      polarity: habitPolaritySchema
        .optional()
        .describe('build = a habit to establish; break = a habit to stop'),
      target_value: z.number().optional().describe('Target value per occurrence, if applicable'),
    },
    async (params) => asContent(await handleCreateHabit(params)),
  );

  server.tool(
    'update_habit',
    'Update a habit. Identify it by UUID or name search, then provide the fields to change.',
    {
      identifier: z.string().describe('Habit UUID or name to search for'),
      name: z.string().optional().describe('New habit name'),
      schedule: scheduleSchema.optional().describe(SCHEDULE_DESCRIPTION),
      metric_type: habitMetricTypeSchema.optional().describe('New metric type'),
      polarity: habitPolaritySchema.optional().describe('New polarity (build or break)'),
      target_value: z.number().optional().describe('New target value'),
      active: z.boolean().optional().describe('Whether the habit is currently active'),
    },
    async (params) => asContent(await handleUpdateHabit(params)),
  );

  server.tool(
    'delete_habit',
    'Soft-delete a habit (sets archived_at). The habit is hidden but not destroyed, and its logs are kept.',
    {
      identifier: z.string().describe('Habit UUID or name to search for'),
    },
    async (params) => asContent(await handleDeleteHabit(params)),
  );
}
