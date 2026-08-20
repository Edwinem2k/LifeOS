import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getClient, USER_ID, audit } from '../supabase.js';
import { resolveByName } from '../resolve.js';
import { activityTypeSchema } from '../types.js';

/** Documented shape of the `activity_logs.details` jsonb column. */
const detailsSchema = z.record(z.string(), z.unknown());

/** One logged set of an exercise (CLAUDE.md rule 10: sets hang off an activity_log). */
const workoutSetSchema = z.object({
  exercise: z.string().describe('Exercise name; matched against the exercises catalogue'),
  set_number: z.number().int().describe('Set number within the session, starting at 1'),
  reps: z.number().int().optional().describe('Repetitions performed'),
  weight_kg: z.number().optional().describe('Weight used, in kilograms'),
  rpe: z.number().optional().describe('Rate of perceived exertion (typically 1-10)'),
  note: z.string().optional().describe('Free-text note for this set'),
});

export interface WorkoutSetInput {
  exercise: string;
  set_number: number;
  reps?: number;
  weight_kg?: number;
  rpe?: number;
  note?: string;
}

// --- Handlers (exported for testing) ---

/**
 * List activity logs, newest first, with their workout sets attached.
 * Every activity carries a `workout_sets` array — empty when it has none.
 */
export async function handleListActivities(params: { type?: string; since?: string }) {
  const client = getClient();
  // The tool param is `type`; the column is `activity_type`.
  let query = client
    .from('activity_logs')
    .select('*')
    .eq('user_id', USER_ID)
    .is('archived_at', null);

  if (params.type) query = query.eq('activity_type', params.type);
  if (params.since) query = query.gte('occurred_at', params.since);

  const { data, error } = await query.order('occurred_at', { ascending: false });
  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };

  const activities = (data ?? []) as Record<string, any>[];
  if (activities.length === 0) return { activities: [], count: 0 };

  // Second query only when there is something to attach sets to.
  const ids = activities.map((activity) => activity.id as string);
  const { data: setData, error: setError } = await client
    .from('workout_sets')
    .select('*')
    .in('activity_log_id', ids)
    .eq('user_id', USER_ID)
    .is('archived_at', null)
    .order('set_number');

  if (setError) {
    return { ok: false as const, error: 'db_error' as const, message: setError.message };
  }

  const byActivity = new Map<string, Record<string, any>[]>();
  for (const set of (setData ?? []) as Record<string, any>[]) {
    const key = set.activity_log_id as string;
    const bucket = byActivity.get(key);
    if (bucket) bucket.push(set);
    else byActivity.set(key, [set]);
  }

  const withSets = activities.map((activity) => ({
    ...activity,
    workout_sets: byActivity.get(activity.id as string) ?? [],
  }));

  return { activities: withSets, count: withSets.length };
}

/**
 * Log an activity, optionally with its workout sets.
 * On success always returns `workout_sets` and `warnings` arrays (both may be empty).
 */
export async function handleLogActivity(params: {
  type: string;
  occurred_at?: string;
  duration_min?: number;
  note?: string;
  details?: Record<string, unknown>;
  location?: string;
  workout_sets?: WorkoutSetInput[];
}) {
  const row: Record<string, unknown> = {
    user_id: USER_ID,
    // Tool param `type` maps to the `activity_type` column.
    activity_type: params.type,
    // activity_logs.occurred_at is NOT NULL with no DB default — always supply it.
    occurred_at: params.occurred_at ?? new Date().toISOString(),
  };

  if (params.duration_min !== undefined) row.duration_min = params.duration_min;
  if (params.note !== undefined) row.note = params.note;
  if (params.details !== undefined) row.details = params.details;

  if (params.location) {
    const resolved = await resolveByName('locations', 'name', params.location);
    if (!resolved.ok) return resolved;
    row.location_id = resolved.row.id;
  }

  const client = getClient();
  const { data: activityRow, error } = await client
    .from('activity_logs')
    .insert(row)
    .select()
    .single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('insert', 'activity_logs', activityRow.id, { after: activityRow });

  const warnings: string[] = [];
  if (!params.workout_sets?.length) {
    return { ok: true as const, activity: activityRow, workout_sets: [], warnings };
  }

  // CLAUDE.md rule 10: always set exercise_id when the exercise exists in the catalogue.
  const sets: Record<string, unknown>[] = [];
  for (const ws of params.workout_sets) {
    const resolved = await resolveByName('exercises', 'name', ws.exercise);
    if (!resolved.ok) {
      warnings.push(`Exercise "${ws.exercise}" not in catalogue — logged without exercise_id.`);
    }
    sets.push({
      user_id: USER_ID,
      activity_log_id: activityRow.id,
      exercise_id: resolved.ok ? resolved.row.id : null,
      exercise: ws.exercise,
      set_number: ws.set_number,
      reps: ws.reps,
      weight_kg: ws.weight_kg,
      rpe: ws.rpe,
      note: ws.note,
    });
  }

  const { data: setRows, error: setError } = await client
    .from('workout_sets')
    .insert(sets)
    .select();

  if (setError) {
    return {
      ok: false as const,
      error: 'db_error' as const,
      message: `Activity logged (id ${activityRow.id}) but the workout sets failed to save: ${setError.message}`,
    };
  }

  // Sets are audited as one batch keyed by their parent activity.
  await audit('insert', 'workout_sets', activityRow.id, { after: setRows ?? sets });

  return {
    ok: true as const,
    activity: activityRow,
    workout_sets: setRows ?? sets,
    warnings,
  };
}

// --- MCP Registration ---

/** Wraps a handler result in the MCP text-content envelope. */
function asContent(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

export function registerActivityTools(server: McpServer) {
  server.tool(
    'list_activities',
    'List logged activities (gym, yoga, kitesurf, run, walk, other), newest first. ' +
      'Each activity includes its workout_sets array (empty when there are none).',
    {
      type: activityTypeSchema.optional().describe('Filter by activity type'),
      since: z
        .string()
        .optional()
        .describe('Only activities on or after this date (YYYY-MM-DD)'),
    },
    async (params) => asContent(await handleListActivities(params)),
  );

  server.tool(
    'log_activity',
    'Log an activity. For gym sessions, pass workout_sets to record each set — ' +
      'exercise names are matched against the exercises catalogue, and any name that ' +
      'is not found is still logged (with a warning) without an exercise_id.',
    {
      type: activityTypeSchema.describe('Activity type'),
      occurred_at: z
        .string()
        .optional()
        .describe('When it happened (ISO 8601 timestamp); defaults to now'),
      duration_min: z.number().int().optional().describe('Duration in minutes'),
      note: z.string().optional().describe('Free-text note about the session'),
      details: detailsSchema
        .optional()
        .describe('Extra structured detail (jsonb), e.g. {"wind_knots":18,"board":"5m"}'),
      location: z.string().optional().describe('Location name (resolved by name)'),
      workout_sets: z
        .array(workoutSetSchema)
        .optional()
        .describe('Per-set gym data for this session'),
    },
    async (params) => asContent(await handleLogActivity(params)),
  );
}
