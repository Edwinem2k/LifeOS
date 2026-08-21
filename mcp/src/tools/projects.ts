import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getClient, USER_ID, audit } from '../supabase.js';
import { resolveEntity } from '../resolve.js';
import { projectStatusSchema, lifeAreaSchema, priorityLevelSchema } from '../types.js';

// --- Handlers (exported for testing) ---

export async function handleListProjects(params: { status?: string; area?: string }) {
  const client = getClient();
  // project_progress is a VIEW — it already excludes archived rows, so no
  // archived_at filter here. Note it renames projects.status -> project_status.
  let query = client.from('project_progress').select('*').eq('user_id', USER_ID);

  if (params.status) query = query.eq('project_status', params.status);
  if (params.area) query = query.eq('area', params.area);

  const { data, error } = await query.order('name');
  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  return { projects: data ?? [], count: data?.length ?? 0 };
}

export async function handleCreateProject(params: {
  name: string;
  area: string;
  status?: string;
  priority?: string;
  target_date?: string;
  description?: string;
  outcome?: string;
  success_check?: string;
}) {
  const client = getClient();
  const row: Record<string, unknown> = {
    user_id: USER_ID,
    name: params.name,
    area: params.area,
    status: params.status ?? 'idea',
  };

  if (params.priority !== undefined) row.priority = params.priority;
  if (params.target_date !== undefined) row.target_date = params.target_date;
  if (params.description !== undefined) row.description = params.description;
  if (params.outcome !== undefined) row.outcome = params.outcome;
  if (params.success_check !== undefined) row.success_check = params.success_check;

  const { data, error } = await client.from('projects').insert(row).select().single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('insert', 'projects', data.id, { after: data });
  return { ok: true as const, project: data };
}

export async function handleUpdateProject(params: {
  identifier: string;
  name?: string;
  description?: string;
  status?: string;
  priority?: string;
  area?: string;
  target_date?: string;
  color?: string;
  current_status?: string;
  next_steps?: string;
  notes?: string;
  outcome?: string;
  success_check?: string;
}) {
  // identifier is used for lookup only — never written to the DB
  const resolved = await resolveEntity('projects', 'name', params.identifier);
  if (!resolved.ok) return resolved;

  const before = resolved.row;
  const patch: Record<string, unknown> = {};

  if (params.name !== undefined) patch.name = params.name;
  if (params.description !== undefined) patch.description = params.description;
  if (params.status !== undefined) patch.status = params.status;
  if (params.priority !== undefined) patch.priority = params.priority;
  if (params.area !== undefined) patch.area = params.area;
  if (params.target_date !== undefined) patch.target_date = params.target_date;
  if (params.color !== undefined) patch.color = params.color;
  if (params.current_status !== undefined) patch.current_status = params.current_status;
  if (params.next_steps !== undefined) patch.next_steps = params.next_steps;
  if (params.notes !== undefined) patch.notes = params.notes;
  if (params.outcome !== undefined) patch.outcome = params.outcome;
  if (params.success_check !== undefined) patch.success_check = params.success_check;

  if (Object.keys(patch).length === 0) {
    return {
      ok: false as const,
      error: 'validation_error' as const,
      message: 'No fields to update.',
    };
  }

  const client = getClient();
  const { data, error } = await client
    .from('projects')
    .update(patch)
    .eq('id', before.id)
    .eq('user_id', USER_ID)
    .is('archived_at', null)
    .select()
    .single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('update', 'projects', data.id, { before, after: data });
  return { ok: true as const, before, after: data };
}

export async function handleDeleteProject(params: { identifier: string }) {
  const resolved = await resolveEntity('projects', 'name', params.identifier);
  if (!resolved.ok) return resolved;

  const client = getClient();
  const { error } = await client
    .from('projects')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', resolved.row.id)
    .eq('user_id', USER_ID)
    .is('archived_at', null);

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('delete', 'projects', resolved.row.id as string, { before: resolved.row });
  return { ok: true as const, message: `Project "${resolved.row.name}" archived.` };
}

// --- MCP Registration ---

/** Wraps a handler result in the MCP text-content envelope. */
function asContent(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

export function registerProjectTools(server: McpServer) {
  server.tool(
    'list_projects',
    'List projects with computed progress stats (total/done tasks, % complete, blocked and overdue counts) from the project_progress view. Optionally filter by status or life area.',
    {
      status: projectStatusSchema.optional().describe('Filter by project status'),
      area: lifeAreaSchema.optional().describe('Filter by life area'),
    },
    async (params) => asContent(await handleListProjects(params)),
  );

  server.tool(
    'create_project',
    'Create a new project. Name and area are required; status defaults to "idea".',
    {
      name: z.string().describe('Project name'),
      area: lifeAreaSchema.describe('Life area this project belongs to'),
      status: projectStatusSchema.optional().default('idea').describe('Initial status'),
      priority: priorityLevelSchema.optional().describe('Priority level'),
      target_date: z.string().optional().describe('Target completion date (YYYY-MM-DD)'),
      description: z.string().optional().describe('What the project is about'),
      outcome: z.string().optional().describe('What does done look like'),
      success_check: z.string().optional().describe('How do we know it worked'),
    },
    async (params) => asContent(await handleCreateProject(params)),
  );

  server.tool(
    'update_project',
    'Update a project. Identify it by UUID or name search, then provide the fields to change.',
    {
      identifier: z.string().describe('Project UUID or name to search for'),
      name: z.string().optional().describe('New project name'),
      description: z.string().optional().describe('Updated description'),
      status: projectStatusSchema.optional().describe('New status'),
      priority: priorityLevelSchema.optional().describe('New priority'),
      area: lifeAreaSchema.optional().describe('New life area'),
      target_date: z.string().optional().describe('New target date (YYYY-MM-DD)'),
      color: z.string().optional().describe('Hex accent colour for UI'),
      current_status: z.string().optional().describe('One-liner: what changed recently'),
      next_steps: z.string().optional().describe('What happens next'),
      notes: z.string().optional().describe('Free-form project notes'),
      outcome: z.string().optional().describe('What does done look like'),
      success_check: z.string().optional().describe('How do we know it worked'),
    },
    async (params) => asContent(await handleUpdateProject(params)),
  );

  server.tool(
    'delete_project',
    'Soft-delete a project (sets archived_at). The project is hidden but not destroyed; its tasks are untouched.',
    {
      identifier: z.string().describe('Project UUID or name to search for'),
    },
    async (params) => asContent(await handleDeleteProject(params)),
  );
}
