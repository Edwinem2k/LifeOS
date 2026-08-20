import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getClient, USER_ID, audit } from '../supabase.js';
import { resolveEntity, resolveByName } from '../resolve.js';
import { taskStatusSchema, lifeAreaSchema, priorityLevelSchema } from '../types.js';

// --- Handlers (exported for testing) ---

export async function handleListTasks(params: {
  project?: string;
  status?: string;
  area?: string;
  include_done?: boolean;
}) {
  const client = getClient();
  let query = client
    .from('tasks')
    .select('*, projects(name)')
    .eq('user_id', USER_ID)
    .is('archived_at', null);

  if (params.status) {
    query = query.eq('status', params.status);
  } else if (!params.include_done) {
    query = query.neq('status', 'done');
  }

  if (params.area) query = query.eq('area', params.area);

  if (params.project) {
    const resolved = await resolveByName('projects', 'name', params.project);
    if (!resolved.ok) return resolved;
    query = query.eq('project_id', resolved.row.id);
  }

  const { data, error } = await query.order('sort_order');
  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  return { tasks: data ?? [], count: data?.length ?? 0 };
}

export async function handleCreateTask(params: {
  title: string;
  project?: string;
  parent_task?: string;
  area?: string;
  priority?: string;
  deadline?: string;
  notes?: string;
  status?: string;
}) {
  const client = getClient();
  const row: Record<string, unknown> = {
    user_id: USER_ID,
    title: params.title,
    status: params.status ?? 'inbox',
  };

  if (params.notes) row.notes = params.notes;
  if (params.deadline) row.deadline = params.deadline;

  // Resolve project and inherit its defaults (CLAUDE.md: inheritance defaults)
  if (params.project) {
    const resolved = await resolveByName('projects', 'name', params.project);
    if (!resolved.ok) return resolved;
    row.project_id = resolved.row.id;
    if (!params.area && resolved.row.area) row.area = resolved.row.area;
    if (!params.priority && resolved.row.priority) row.priority = resolved.row.priority;
    if (!params.deadline && resolved.row.target_date) row.deadline = resolved.row.target_date;
  }

  // Explicit params always win over inheritance
  if (params.area) row.area = params.area;
  if (params.priority) row.priority = params.priority;

  if (params.parent_task) {
    const resolved = await resolveEntity('tasks', 'title', params.parent_task);
    if (!resolved.ok) return resolved;
    row.parent_task_id = resolved.row.id;
  }

  const { data, error } = await client.from('tasks').insert(row).select().single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('insert', 'tasks', data.id, { after: data });
  return { ok: true as const, task: data };
}

export async function handleUpdateTask(params: {
  identifier: string;
  title?: string;
  notes?: string;
  status?: string;
  area?: string;
  priority?: string;
  deadline?: string;
  project?: string;
  parent_task?: string;
  sort_order?: number;
}) {
  // identifier is used for lookup only — never written to the DB
  const resolved = await resolveEntity('tasks', 'title', params.identifier);
  if (!resolved.ok) return resolved;

  const before = resolved.row;
  const patch: Record<string, unknown> = {};

  if (params.title !== undefined) patch.title = params.title;
  if (params.notes !== undefined) patch.notes = params.notes;
  if (params.status !== undefined) patch.status = params.status;
  if (params.area !== undefined) patch.area = params.area;
  if (params.priority !== undefined) patch.priority = params.priority;
  if (params.deadline !== undefined) patch.deadline = params.deadline;
  if (params.sort_order !== undefined) patch.sort_order = params.sort_order;

  // Empty string detaches the task from its project / parent
  if (params.project !== undefined) {
    if (params.project === '') {
      patch.project_id = null;
    } else {
      const projResolved = await resolveByName('projects', 'name', params.project);
      if (!projResolved.ok) return projResolved;
      patch.project_id = projResolved.row.id;
    }
  }

  if (params.parent_task !== undefined) {
    if (params.parent_task === '') {
      patch.parent_task_id = null;
    } else {
      const parentResolved = await resolveEntity('tasks', 'title', params.parent_task);
      if (!parentResolved.ok) return parentResolved;
      patch.parent_task_id = parentResolved.row.id;
    }
  }

  if (Object.keys(patch).length === 0) {
    return {
      ok: false as const,
      error: 'validation_error' as const,
      message: 'No fields to update.',
    };
  }

  const client = getClient();
  const { data, error } = await client
    .from('tasks')
    .update(patch)
    .eq('id', before.id)
    .eq('user_id', USER_ID)
    .select()
    .single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('update', 'tasks', data.id, { before, after: data });
  return { ok: true as const, before, after: data };
}

export async function handleCompleteTask(params: { identifier: string }) {
  const resolved = await resolveEntity('tasks', 'title', params.identifier);
  if (!resolved.ok) return resolved;

  const before = resolved.row;
  const client = getClient();
  const { data, error } = await client
    .from('tasks')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', before.id)
    .eq('user_id', USER_ID)
    .select()
    .single();

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('update', 'tasks', data.id, { before, after: data });
  return { ok: true as const, task: data };
}

export async function handleDeleteTask(params: { identifier: string }) {
  const resolved = await resolveEntity('tasks', 'title', params.identifier);
  if (!resolved.ok) return resolved;

  const client = getClient();
  const { error } = await client
    .from('tasks')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', resolved.row.id)
    .eq('user_id', USER_ID);

  if (error) return { ok: false as const, error: 'db_error' as const, message: error.message };
  await audit('delete', 'tasks', resolved.row.id as string, { before: resolved.row });
  return { ok: true as const, message: `Task "${resolved.row.title}" archived.` };
}

// --- MCP Registration ---

/** Wraps a handler result in the MCP text-content envelope. */
function asContent(result: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
}

export function registerTaskTools(server: McpServer) {
  server.tool(
    'list_tasks',
    'List tasks, optionally filtered by project, status, or area. Excludes done tasks by default.',
    {
      project: z.string().optional().describe('Project name to filter by'),
      status: taskStatusSchema.optional().describe('Filter by status'),
      area: lifeAreaSchema.optional().describe('Filter by life area'),
      include_done: z.boolean().optional().default(false).describe('Include completed tasks'),
    },
    async (params) => asContent(await handleListTasks(params)),
  );

  server.tool(
    'create_task',
    'Create a new task. If a project is specified, area/priority/deadline inherit from the project unless explicitly set.',
    {
      title: z.string().describe('Task title'),
      project: z.string().optional().describe('Project name (resolved by name)'),
      parent_task: z.string().optional().describe('Parent task title for subtasks'),
      area: lifeAreaSchema.optional().describe('Life area'),
      priority: priorityLevelSchema.optional().describe('Priority level'),
      deadline: z.string().optional().describe('Deadline date (YYYY-MM-DD)'),
      notes: z.string().optional().describe('Task notes'),
      status: taskStatusSchema.optional().default('inbox').describe('Initial status'),
    },
    async (params) => asContent(await handleCreateTask(params)),
  );

  server.tool(
    'update_task',
    'Update a task. Identify it by UUID or title search, then provide the fields to change.',
    {
      identifier: z.string().describe('Task UUID or title to search for'),
      title: z.string().optional().describe('New title'),
      notes: z.string().optional().describe('Updated notes'),
      status: taskStatusSchema.optional().describe('New status'),
      area: lifeAreaSchema.optional().describe('New area'),
      priority: priorityLevelSchema.optional().describe('New priority'),
      deadline: z.string().optional().describe('New deadline (YYYY-MM-DD)'),
      project: z.string().optional().describe('New project name; empty string detaches the task'),
      parent_task: z
        .string()
        .optional()
        .describe('New parent task title; empty string detaches the subtask'),
      sort_order: z.number().optional().describe('Manual sort order'),
    },
    async (params) => asContent(await handleUpdateTask(params)),
  );

  server.tool(
    'complete_task',
    'Mark a task as done. Sets status to done and completed_at to now.',
    {
      identifier: z.string().describe('Task UUID or title to search for'),
    },
    async (params) => asContent(await handleCompleteTask(params)),
  );

  server.tool(
    'delete_task',
    'Soft-delete a task (sets archived_at). The task is hidden but not destroyed.',
    {
      identifier: z.string().describe('Task UUID or title to search for'),
    },
    async (params) => asContent(await handleDeleteTask(params)),
  );
}
