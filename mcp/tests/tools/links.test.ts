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
import { resolveEntity } from '../../src/resolve.js';
import { createMockQueryBuilder, type MockResult } from '../supabase.mock.js';
import { handleListLinks, handleCreateLink, entityConfig } from '../../src/tools/links.js';

const client = () => getClient() as unknown as {
  from: ReturnType<typeof vi.fn>;
  _setResult: (r: { data: unknown; error: unknown }) => void;
  _queryBuilder: Record<string, ReturnType<typeof vi.fn>>;
};

/**
 * Routes each `from(table)` call to its own builder so multi-query handlers can
 * return different rows per table (and per repeat call on the same table).
 * Builders are recorded under `table#callIndex` for assertions.
 */
function routeFrom(results: Record<string, MockResult>) {
  const c = client();
  const counts: Record<string, number> = {};
  const builders: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};
  c.from.mockImplementation((table: string) => {
    const index = counts[table] ?? 0;
    counts[table] = index + 1;
    const key = `${table}#${index}`;
    const builder = createMockQueryBuilder(
      results[key] ?? results[table] ?? { data: [], error: null },
    ) as Record<string, ReturnType<typeof vi.fn>>;
    builders[key] = builder;
    return builder;
  });
  return builders;
}

describe('links tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const c = client();
    c.from.mockReset();
    c.from.mockReturnValue(c._queryBuilder);
    c._setResult({ data: [], error: null });
    vi.mocked(resolveEntity).mockResolvedValue({
      ok: true,
      row: { id: 'task-1', title: 'Task A' },
    });
  });

  // --- list_links ---

  it('list_links rejects an unknown entity_type and lists the valid types', async () => {
    const result = (await handleListLinks({ entity_type: 'sandwich', entity_id: 'x' })) as {
      ok: false;
      error: string;
      message: string;
    };
    expect(result).toMatchObject({ ok: false, error: 'validation_error' });
    for (const type of Object.keys(entityConfig)) {
      expect(result.message).toContain(type);
    }
  });

  it('list_links requires exactly one of entity_id / entity_name', async () => {
    const neither = await handleListLinks({ entity_type: 'task' });
    expect(neither).toMatchObject({ ok: false, error: 'validation_error' });

    const both = await handleListLinks({
      entity_type: 'task',
      entity_id: 'task-1',
      entity_name: 'Task A',
    });
    expect(both).toMatchObject({ ok: false, error: 'validation_error' });
  });

  it('list_links returns outgoing and incoming links with resolved other-end names', async () => {
    const builders = routeFrom({
      'links#0': {
        data: [
          {
            id: 'l1',
            src_type: 'task',
            src_id: 'task-1',
            dst_type: 'project',
            dst_id: 'proj-1',
            relation: 'contributes_to',
          },
        ],
        error: null,
      },
      'links#1': {
        data: [
          {
            id: 'l2',
            src_type: 'note',
            src_id: 'note-1',
            dst_type: 'task',
            dst_id: 'task-1',
            relation: 'mentions',
          },
        ],
        error: null,
      },
      projects: { data: { id: 'proj-1', name: 'Project X' }, error: null },
      notes: { data: { id: 'note-1', title: 'Kickoff note' }, error: null },
    });

    const result = (await handleListLinks({ entity_type: 'task', entity_id: 'task-1' })) as {
      entity_type: string;
      entity_id: string;
      count: number;
      links: Record<string, unknown>[];
    };

    expect(result.entity_type).toBe('task');
    expect(result.entity_id).toBe('task-1');
    expect(result.count).toBe(2);
    expect(result.links[0]).toMatchObject({
      id: 'l1',
      direction: 'outgoing',
      other_type: 'project',
      other_id: 'proj-1',
      other_name: 'Project X',
    });
    expect(result.links[1]).toMatchObject({
      id: 'l2',
      direction: 'incoming',
      other_type: 'note',
      other_id: 'note-1',
      other_name: 'Kickoff note',
    });

    // Both link queries are scoped to the user, and neither touches archived_at
    // (the links table has no such column).
    for (const key of ['links#0', 'links#1']) {
      expect(builders[key].eq).toHaveBeenCalledWith('user_id', 'test-user');
      expect(builders[key].is).not.toHaveBeenCalled();
    }
    expect(builders['links#0'].eq).toHaveBeenCalledWith('src_type', 'task');
    expect(builders['links#0'].eq).toHaveBeenCalledWith('src_id', 'task-1');
    expect(builders['links#1'].eq).toHaveBeenCalledWith('dst_type', 'task');
    expect(builders['links#1'].eq).toHaveBeenCalledWith('dst_id', 'task-1');
  });

  it('list_links resolves entity_name and propagates a resolution failure', async () => {
    vi.mocked(resolveEntity).mockResolvedValueOnce({
      ok: false,
      error: 'not_found',
      message: 'No tasks found matching "nope".',
    });

    const result = await handleListLinks({ entity_type: 'task', entity_name: 'nope' });
    expect(result).toEqual({
      ok: false,
      error: 'not_found',
      message: 'No tasks found matching "nope".',
    });
    expect(resolveEntity).toHaveBeenCalledWith('tasks', 'title', 'nope');
  });

  it('list_links yields other_name null when the other end cannot be resolved', async () => {
    routeFrom({
      'links#0': {
        data: [
          {
            id: 'l1',
            src_type: 'task',
            src_id: 'task-1',
            dst_type: 'project',
            dst_id: 'gone',
            relation: 'related',
          },
        ],
        error: null,
      },
      'links#1': { data: [], error: null },
      projects: { data: null, error: null },
    });

    const result = (await handleListLinks({ entity_type: 'task', entity_id: 'task-1' })) as {
      links: Record<string, unknown>[];
    };
    expect(result.links[0].other_name).toBeNull();
  });

  it('list_links surfaces db errors as db_error', async () => {
    client()._setResult({ data: null, error: { message: 'boom' } });
    const result = await handleListLinks({ entity_type: 'task', entity_id: 'task-1' });
    expect(result).toMatchObject({ ok: false, error: 'db_error', message: 'boom' });
  });

  // --- create_link ---

  it('create_link resolves both ends and inserts an agent-created link', async () => {
    client()._setResult({ data: [{ id: 'link-1', relation: 'contributes_to' }], error: null });
    vi.mocked(resolveEntity)
      .mockResolvedValueOnce({ ok: true, row: { id: 'task-1', title: 'Task A' } })
      .mockResolvedValueOnce({ ok: true, row: { id: 'goal-1', title: 'Goal G' } });

    const result = await handleCreateLink({
      src_type: 'task',
      src: 'Task A',
      dst_type: 'goal',
      dst: 'Goal G',
      relation: 'contributes_to',
    });

    expect(result).toMatchObject({ ok: true });
    expect(resolveEntity).toHaveBeenNthCalledWith(1, 'tasks', 'title', 'Task A');
    expect(resolveEntity).toHaveBeenNthCalledWith(2, 'goals', 'title', 'Goal G');

    const inserted = client()._queryBuilder.insert.mock.calls[0][0];
    expect(inserted).toEqual({
      user_id: 'test-user',
      src_type: 'task',
      src_id: 'task-1',
      dst_type: 'goal',
      dst_id: 'goal-1',
      relation: 'contributes_to',
      created_by: 'agent',
      suggested: false,
    });
    expect(audit).toHaveBeenCalledWith('insert', 'links', 'link-1', expect.anything());
  });

  it('create_link rejects an unknown dst_type and lists the valid types', async () => {
    const result = (await handleCreateLink({
      src_type: 'task',
      src: 'Task A',
      dst_type: 'sandwich',
      dst: 'BLT',
      relation: 'related',
    })) as { ok: false; error: string; message: string };

    expect(result).toMatchObject({ ok: false, error: 'validation_error' });
    expect(result.message).toContain('sandwich');
    for (const type of Object.keys(entityConfig)) {
      expect(result.message).toContain(type);
    }
    expect(client()._queryBuilder.insert).not.toHaveBeenCalled();
  });

  it('create_link propagates a dst resolution failure without inserting', async () => {
    vi.mocked(resolveEntity)
      .mockResolvedValueOnce({ ok: true, row: { id: 'task-1', title: 'Task A' } })
      .mockResolvedValueOnce({
        ok: false,
        error: 'ambiguous',
        message: 'Multiple goals match "G". Please be more specific.',
      });

    const result = await handleCreateLink({
      src_type: 'task',
      src: 'Task A',
      dst_type: 'goal',
      dst: 'G',
      relation: 'contributes_to',
    });

    expect(result).toMatchObject({ ok: false, error: 'ambiguous' });
    expect(client()._queryBuilder.insert).not.toHaveBeenCalled();
  });

  it('create_link surfaces a duplicate link as db_error and does not audit', async () => {
    client()._setResult({
      data: null,
      error: { message: 'duplicate key value violates unique constraint "links_src_type_..."' },
    });

    const result = await handleCreateLink({
      src_type: 'task',
      src: 'Task A',
      dst_type: 'goal',
      dst: 'Goal G',
      relation: 'related',
    });

    expect(result).toMatchObject({ ok: false, error: 'db_error' });
    expect(audit).not.toHaveBeenCalled();
  });
});
