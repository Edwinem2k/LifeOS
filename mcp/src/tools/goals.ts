import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getClient, USER_ID, audit } from '../supabase.js';
import { resolveEntity } from '../resolve.js';
import {
  goalKindSchema,
  goalStatusSchema,
  goalHorizonSchema,
  lifeAreaSchema,
} from '../types.js';

// --- Handlers (exported for testing) ---

export async function handleListGoals(params: {
  area?: string;
  horizon?: string;
  status?: string;
}) {
  const client = getClient();
  // The goal_progress view already excludes archived rows and key_results —
  // never re-filter archived_at here (CLAUDE.md: use views, don't recompute).
  let query = client.from('goal_progress').select('*').eq('user_id', USER_ID);

  if (params.area) query = query.eq('area', params.area);
  if (params.horizon) query = query.eq('horizon', params.horizon);
  // The view renames goals.status -> goal_status.
  if (params.status) query = query.eq('goal_status', params.status);

  const { data, error } = await query.order('area');
  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };

  const rows = (data ?? []) as Record<string, unknown>[];
  const goals_by_area: Record<string, Record<string, unknown>[]> = {};
  for (const row of rows) {
    const area = (row.area as string) ?? 'unassigned';
    (goals_by_area[area] ??= []).push(row);
  }

  return { goals_by_area, count: rows.length };
}

export async function handleCreateGoal(params: {
  title: string;
  area: string;
  kind?: string;
  horizon?: string;
  target_value?: number;
  unit?: string;
  parent_goal?: string;
  due_date?: string;
  notes?: string;
  status?: string;
}) {
  const client = getClient();
  const row: Record<string, unknown> = {
    user_id: USER_ID,
    title: params.title,
    area: params.area,
    kind: params.kind ?? 'goal',
    status: params.status ?? 'not_started',
  };

  if (params.horizon !== undefined) row.horizon = params.horizon;
  if (params.target_value !== undefined) row.target_value = params.target_value;
  if (params.unit !== undefined) row.unit = params.unit;
  if (params.due_date !== undefined) row.due_date = params.due_date;
  if (params.notes !== undefined) row.notes = params.notes;

  if (params.parent_goal) {
    const resolved = await resolveEntity('goals', 'title', params.parent_goal);
    if (!resolved.ok) return resolved;
    row.parent_goal_id = resolved.row.id;
  }

  const { data, error } = await client.from('goals').insert(row).select().single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('insert', 'goals', data.id, { after: data });
  return { ok: true as const, goal: data };
}

export async function handleUpdateGoal(params: {
  identifier: string;
  title?: string;
  status?: string;
  area?: string;
  horizon?: string;
  target_value?: number;
  current_value?: number;
  unit?: string;
  due_date?: string;
  notes?: string;
  progress_mode?: string;
}) {
  // identifier is used for lookup only — never written to the DB
  const resolved = await resolveEntity('goals', 'title', params.identifier);
  if (!resolved.ok) return resolved;

  const before = resolved.row;
  const patch: Record<string, unknown> = {};

  if (params.title !== undefined) patch.title = params.title;
  if (params.status !== undefined) patch.status = params.status;
  if (params.area !== undefined) patch.area = params.area;
  if (params.horizon !== undefined) patch.horizon = params.horizon;
  if (params.target_value !== undefined) patch.target_value = params.target_value;
  if (params.current_value !== undefined) patch.current_value = params.current_value;
  if (params.unit !== undefined) patch.unit = params.unit;
  if (params.due_date !== undefined) patch.due_date = params.due_date;
  if (params.notes !== undefined) patch.notes = params.notes;
  if (params.progress_mode !== undefined) patch.progress_mode = params.progress_mode;

  if (Object.keys(patch).length === 0) {
    return {
      ok: false as const,
      error: 'validation_error' as const,
      message: 'No fields to update.',
    };
  }

  const client = getClient();
  const { data, error } = await client
    .from('goals')
    .update(patch)
    .eq('id', before.id)
    .eq('user_id', USER_ID)
    .is('archived_at', null)
    .select()
    .single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('update', 'goals', data.id, { before, after: data });
  return { ok: true as const, before, after: data };
}

export async function handleDeleteGoal(params: { identifier: string }) {
  const resolved = await resolveEntity('goals', 'title', params.identifier);
  if (!resolved.ok) return resolved;

  const client = getClient();
  const { error } = await client
    .from('goals')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', resolved.row.id)
    .eq('user_id', USER_ID)
    .is('archived_at', null);

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('delete', 'goals', resolved.row.id as string, { before: resolved.row });
  return { ok: true as const, message: `Goal "${resolved.row.title}" archived.` };
}

// --- MCP Registration ---

/** Wraps a handler result in the MCP text-content envelope. */
function asContent(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

export function registerGoalTools(server: McpServer) {
  server.tool(
    'list_goals',
    'List goals with computed progress from the goal_progress view, grouped by life area. Key results are rolled up into their parent goal rather than listed separately. Each goal includes direct_pct (current vs target), kr_count/kr_done_count/kr_pct (key-result rollup) and effective_pct (the headline number to report).',
    {
      area: lifeAreaSchema.optional().describe('Filter by life area'),
      horizon: goalHorizonSchema.optional().describe('Filter by time horizon (annual, q1-q4)'),
      status: goalStatusSchema
        .optional()
        .describe('Filter by goal status (not_started, in_progress, on_track, at_risk, done)'),
    },
    async (params) => asContent(await handleListGoals(params)),
  );

  server.tool(
    'create_goal',
    'Create a goal or key result. Use kind="key_result" together with parent_goal to add a measurable key result under an existing goal.',
    {
      title: z.string().describe('Goal title'),
      area: lifeAreaSchema.describe('Life area this goal belongs to (required)'),
      kind: goalKindSchema.optional().default('goal').describe('goal or key_result'),
      horizon: goalHorizonSchema.optional().describe('Time horizon (annual, q1, q2, q3, q4)'),
      target_value: z.number().optional().describe('Numeric target to reach, e.g. 500'),
      unit: z.string().optional().describe('Unit for the target/current value, e.g. "km", "EUR"'),
      parent_goal: z
        .string()
        .optional()
        .describe('Parent goal UUID or title; sets parent_goal_id (used for key results)'),
      due_date: z.string().optional().describe('Due date (YYYY-MM-DD)'),
      notes: z.string().optional().describe('Free-text notes'),
      status: goalStatusSchema.optional().default('not_started').describe('Initial status'),
    },
    async (params) => asContent(await handleCreateGoal(params)),
  );

  server.tool(
    'update_goal',
    'Update a goal. Identify it by UUID or title search, then provide the fields to change. Use current_value to record progress against target_value.',
    {
      identifier: z.string().describe('Goal UUID or title to search for'),
      title: z.string().optional().describe('New title'),
      status: goalStatusSchema.optional().describe('New status'),
      area: lifeAreaSchema.optional().describe('New life area'),
      horizon: goalHorizonSchema.optional().describe('New time horizon'),
      target_value: z.number().optional().describe('New numeric target'),
      current_value: z.number().optional().describe('Updated progress value'),
      unit: z.string().optional().describe('New unit for the target/current value'),
      due_date: z.string().optional().describe('New due date (YYYY-MM-DD)'),
      notes: z.string().optional().describe('Updated notes'),
      progress_mode: z
        .string()
        .optional()
        .describe(
          'How progress is computed. Allowed values: manual | from_tasks | from_activity | from_habit',
        ),
    },
    async (params) => asContent(await handleUpdateGoal(params)),
  );

  server.tool(
    'delete_goal',
    'Soft-delete a goal (sets archived_at). The goal is hidden but not destroyed.',
    {
      identifier: z.string().describe('Goal UUID or title to search for'),
    },
    async (params) => asContent(await handleDeleteGoal(params)),
  );
}
