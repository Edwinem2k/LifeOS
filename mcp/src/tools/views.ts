import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getClient, USER_ID } from '../supabase.js';
import { resolveByName } from '../resolve.js';
import { lifeAreaSchema, goalHorizonSchema } from '../types.js';

// NOTE: every query in this file targets a Postgres *view*. Views already
// exclude archived rows and have no `archived_at` column — never add
// `.is('archived_at', null)` here. All tools are read-only: no audit calls.

// --- Helpers ---

/**
 * ISO Monday (YYYY-MM-DD) of the week containing `dateStr` (defaults to today).
 *
 * Matches Postgres `date_trunc('week', ...)`, which is ISO-8601: weeks run
 * Monday..Sunday, so a Sunday belongs to the PRECEDING Monday. All arithmetic
 * is done in UTC so the result never shifts with the host timezone.
 */
export function weekStart(dateStr?: string): string {
  const base = dateStr ? new Date(`${dateStr}T00:00:00Z`) : new Date();
  if (Number.isNaN(base.getTime())) {
    throw new Error(`Invalid date: "${dateStr}"`);
  }
  const day = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()),
  );
  // getUTCDay(): 0 = Sunday .. 6 = Saturday. Sunday is 6 days after its Monday.
  const dow = day.getUTCDay();
  const offset = dow === 0 ? 6 : dow - 1;
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
}

// --- Handlers (exported for testing) ---

type AgendaRow = { item_type?: string | null; [key: string]: unknown };

export async function handleTodayAgenda(_params: Record<string, never> | object = {}) {
  const client = getClient();
  const { data, error } = await client
    .from('today_agenda')
    .select('*')
    .eq('user_id', USER_ID);

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };

  const rows = (data ?? []) as AgendaRow[];
  const agenda: {
    events: AgendaRow[];
    tasks: AgendaRow[];
    habits: AgendaRow[];
    follow_ups: AgendaRow[];
  } = { events: [], tasks: [], habits: [], follow_ups: [] };

  for (const row of rows) {
    switch (row.item_type) {
      case 'event':
        agenda.events.push(row);
        break;
      case 'task':
        agenda.tasks.push(row);
        break;
      case 'habit':
        agenda.habits.push(row);
        break;
      case 'follow_up':
        agenda.follow_ups.push(row);
        break;
      default:
        break;
    }
  }

  return { agenda, count: rows.length };
}

export async function handleProjectProgress(params: { project?: string }) {
  const client = getClient();
  let query = client.from('project_progress').select('*').eq('user_id', USER_ID);

  if (params.project) {
    const resolved = await resolveByName('projects', 'name', params.project);
    if (!resolved.ok) return resolved;
    query = query.eq('project_id', resolved.row.id);
  }

  const { data, error } = await query;
  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  return { projects: data ?? [], count: data?.length ?? 0 };
}

export async function handleAreaProgress(params: { area?: string; horizon?: string }) {
  const client = getClient();
  let query = client.from('area_progress').select('*').eq('user_id', USER_ID);

  if (params.area) query = query.eq('area', params.area);
  if (params.horizon) query = query.eq('horizon', params.horizon);

  const { data, error } = await query;
  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  return { areas: data ?? [], count: data?.length ?? 0 };
}

export async function handleWeeklyReview(params: { week?: string }) {
  const monday = weekStart(params.week);
  const client = getClient();
  const { data, error } = await client
    .from('weekly_review')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('week_start', monday)
    .maybeSingle();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  return { week_start: monday, review: data ?? null };
}

export async function handleExercisesAvailable(params: { location?: string }) {
  const client = getClient();
  let query = client.from('exercises_available').select('*').eq('user_id', USER_ID);

  if (params.location) {
    const resolved = await resolveByName('locations', 'name', params.location);
    if (!resolved.ok) return resolved;
    query = query.eq('location_id', resolved.row.id);
  }

  const { data, error } = await query;
  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  return { exercises: data ?? [], count: data?.length ?? 0 };
}

// --- MCP Registration ---

/** Wraps a handler result in the MCP text-content envelope. */
function asContent(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

export function registerViewTools(server: McpServer) {
  server.tool(
    'today_agenda',
    "Today's briefing in one call: calendar events for today, tasks due or overdue, active habits (with whether they were already logged today), and contacts overdue for follow-up. Results are grouped by type into events / tasks / habits / follow_ups. Read-only.",
    {},
    async () => asContent(await handleTodayAgenda({})),
  );

  server.tool(
    'project_progress',
    'Project completion stats from the project_progress view: total vs done tasks, percent complete, blocked count, and overdue count. Omit `project` for every project. Read-only — never recompute these numbers by listing tasks.',
    {
      project: z
        .string()
        .optional()
        .describe('Project name to report on; omit for all projects'),
    },
    async (params) => asContent(await handleProjectProgress(params)),
  );

  server.tool(
    'area_progress',
    'Goal progress rolled up per life area and horizon: goal count and average effective completion percent. Use for the progress strip / high-level check-in. Read-only.',
    {
      area: lifeAreaSchema.optional().describe('Filter to a single life area'),
      horizon: goalHorizonSchema
        .optional()
        .describe('Filter to a single goal horizon (annual, q1-q4)'),
    },
    async (params) => asContent(await handleAreaProgress(params)),
  );

  server.tool(
    'weekly_review',
    'Weekly rollup for one week: tasks completed, habit completion percent, activities logged, interactions had, and notes written. The week is Monday-based — any date inside the week works, and a Sunday resolves to that week\'s Monday. Returns review: null when the week had no recorded activity (the view only emits rows for weeks with data). Read-only.',
    {
      week: z
        .string()
        .optional()
        .describe('Any date (YYYY-MM-DD) inside the target week; defaults to the current week'),
    },
    async (params) => asContent(await handleWeeklyReview(params)),
  );

  server.tool(
    'exercises_available',
    'Exercises that can actually be performed at a location, based on the equipment recorded there (bodyweight exercises always qualify). Omit `location` to list availability across all locations. Read-only.',
    {
      location: z
        .string()
        .optional()
        .describe('Location name (e.g. "Home Gym"); omit for all locations'),
    },
    async (params) => asContent(await handleExercisesAvailable(params)),
  );
}
