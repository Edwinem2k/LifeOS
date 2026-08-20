import { describe, it, expect, vi, beforeEach } from 'vitest';

// Self-contained factories: dynamic imports avoid the vi.mock hoisting trap.
vi.mock('../../src/supabase.js', async () => {
  const { vi: v } = await import('vitest');
  const { createMockClient } = await import('../supabase.mock.js');
  const mock = createMockClient({ data: [], error: null });
  return {
    getClient: v.fn(() => mock),
    USER_ID: 'test-user',
    ACTOR: 'test',
    audit: v.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../src/resolve.js', async () => {
  const { vi: v } = await import('vitest');
  return {
    resolveEntity: v.fn(),
    resolveByName: v.fn(),
    isUuid: (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  };
});

import { getClient, audit } from '../../src/supabase.js';
import { resolveEntity, resolveByName } from '../../src/resolve.js';
import {
  handleListTasks,
  handleCreateTask,
  handleUpdateTask,
  handleCompleteTask,
  handleDeleteTask,
} from '../../src/tools/tasks.js';

const client = () => getClient() as unknown as {
  from: ReturnType<typeof vi.fn>;
  _setResult: (r: { data: unknown; error: unknown }) => void;
  _queryBuilder: Record<string, ReturnType<typeof vi.fn>>;
};

describe('tasks tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client()._setResult({ data: [], error: null });
    vi.mocked(resolveEntity).mockResolvedValue({
      ok: true,
      row: { id: 'task-1', title: 'Task A', status: 'inbox' },
    });
    vi.mocked(resolveByName).mockResolvedValue({
      ok: true,
      row: { id: 'proj-1', name: 'Project X', area: 'work', priority: 'high', target_date: '2026-09-01' },
    });
  });

  it('list_tasks returns a tasks array scoped to the user and excludes done by default', async () => {
    client()._setResult({
      data: [
        { id: '1', title: 'Task A', status: 'inbox' },
        { id: '2', title: 'Task B', status: 'in_progress' },
      ],
      error: null,
    });

    const result = await handleListTasks({});
    expect(Array.isArray((result as { tasks: unknown[] }).tasks)).toBe(true);
    expect((result as { count: number }).count).toBe(2);
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(client()._queryBuilder.is).toHaveBeenCalledWith('archived_at', null);
    expect(client()._queryBuilder.neq).toHaveBeenCalledWith('status', 'done');
  });

  it('list_tasks propagates a project resolution failure', async () => {
    vi.mocked(resolveByName).mockResolvedValueOnce({
      ok: false,
      error: 'not_found',
      message: 'No projects found matching "nope".',
    });
    const result = await handleListTasks({ project: 'nope' });
    expect(result).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('create_task inherits area, priority and deadline from the project', async () => {
    client()._setResult({ data: [{ id: 'new-1', title: 'Test task' }], error: null });

    const result = await handleCreateTask({ title: 'Test task', project: 'Project X' });
    expect(result).toMatchObject({ ok: true });

    const inserted = client()._queryBuilder.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      user_id: 'test-user',
      title: 'Test task',
      status: 'inbox',
      project_id: 'proj-1',
      area: 'work',
      priority: 'high',
      deadline: '2026-09-01',
    });
    expect(audit).toHaveBeenCalledWith('insert', 'tasks', 'new-1', expect.anything());
  });

  it('create_task lets explicit params override project inheritance', async () => {
    client()._setResult({ data: [{ id: 'new-2', title: 'Test task' }], error: null });

    await handleCreateTask({
      title: 'Test task',
      project: 'Project X',
      area: 'health',
      priority: 'low',
      deadline: '2026-12-31',
    });

    const inserted = client()._queryBuilder.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({ area: 'health', priority: 'low', deadline: '2026-12-31' });
  });

  it('update_task never writes the identifier as a column', async () => {
    client()._setResult({ data: [{ id: 'task-1', title: 'Renamed' }], error: null });

    await handleUpdateTask({ identifier: 'Task A', title: 'Renamed' });

    const patch = client()._queryBuilder.update.mock.calls[0][0];
    expect(patch).toEqual({ title: 'Renamed' });
    expect(patch).not.toHaveProperty('identifier');
  });

  it('update_task errors when no fields are provided', async () => {
    const result = await handleUpdateTask({ identifier: 'Task A' });
    expect(result).toMatchObject({ ok: false, error: 'validation_error' });
  });

  it('update_task clears project_id when project is an empty string', async () => {
    client()._setResult({ data: [{ id: 'task-1' }], error: null });
    await handleUpdateTask({ identifier: 'Task A', project: '' });
    expect(client()._queryBuilder.update.mock.calls[0][0]).toEqual({ project_id: null });
  });

  it('complete_task resolves by identifier and sets status done', async () => {
    client()._setResult({ data: [{ id: 'task-1', status: 'done' }], error: null });

    const result = await handleCompleteTask({ identifier: 'Task A' });
    expect(result).toMatchObject({ ok: true });
    expect(resolveEntity).toHaveBeenCalledWith('tasks', 'title', 'Task A');

    const patch = client()._queryBuilder.update.mock.calls[0][0];
    expect(patch.status).toBe('done');
    expect(typeof patch.completed_at).toBe('string');
  });

  it('complete_task returns the resolution error when the task is not found', async () => {
    vi.mocked(resolveEntity).mockResolvedValueOnce({
      ok: false,
      error: 'not_found',
      message: 'No tasks found matching "nonexistent".',
    });
    const result = await handleCompleteTask({ identifier: 'nonexistent' });
    expect(result).toEqual({
      ok: false,
      error: 'not_found',
      message: 'No tasks found matching "nonexistent".',
    });
  });

  it('delete_task soft-deletes via archived_at', async () => {
    const result = await handleDeleteTask({ identifier: 'Task A' });
    expect(result).toMatchObject({ ok: true });
    const patch = client()._queryBuilder.update.mock.calls[0][0];
    expect(typeof patch.archived_at).toBe('string');
    expect(audit).toHaveBeenCalledWith('delete', 'tasks', 'task-1', expect.anything());
  });

  it('surfaces db errors as db_error', async () => {
    client()._setResult({ data: null, error: { message: 'boom' } });
    const result = await handleListTasks({});
    expect(result).toMatchObject({ ok: false, error: 'db_error', message: 'boom' });
  });
});
