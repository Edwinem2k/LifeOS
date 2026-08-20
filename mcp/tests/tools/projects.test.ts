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
import {
  handleListProjects,
  handleCreateProject,
  handleUpdateProject,
  handleDeleteProject,
} from '../../src/tools/projects.js';

const client = () => getClient() as unknown as {
  from: ReturnType<typeof vi.fn>;
  _setResult: (r: { data: unknown; error: unknown }) => void;
  _queryBuilder: Record<string, ReturnType<typeof vi.fn>>;
};

describe('projects tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client()._setResult({ data: [], error: null });
    vi.mocked(resolveEntity).mockResolvedValue({
      ok: true,
      row: { id: 'proj-1', name: 'Project X', status: 'active', area: 'work' },
    });
  });

  it('list_projects queries the project_progress view scoped to the user', async () => {
    client()._setResult({
      data: [
        { project_id: 'proj-1', name: 'Project X', project_status: 'active', pct_complete: 50 },
        { project_id: 'proj-2', name: 'Project Y', project_status: 'idea', pct_complete: 0 },
      ],
      error: null,
    });

    const result = await handleListProjects({});
    expect(client().from).toHaveBeenCalledWith('project_progress');
    expect(Array.isArray((result as { projects: unknown[] }).projects)).toBe(true);
    expect((result as { count: number }).count).toBe(2);
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
  });

  it('list_projects does NOT filter archived_at (the view already excludes archived rows)', async () => {
    await handleListProjects({});
    expect(client()._queryBuilder.is).not.toHaveBeenCalledWith('archived_at', null);
  });

  it('list_projects filters by project_status (the view renames status)', async () => {
    await handleListProjects({ status: 'active', area: 'work' });
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('project_status', 'active');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('area', 'work');
    expect(client()._queryBuilder.eq).not.toHaveBeenCalledWith('status', 'active');
  });

  it('create_project inserts with user_id and a default status of idea, then audits', async () => {
    client()._setResult({ data: [{ id: 'new-1', name: 'New Project' }], error: null });

    const result = await handleCreateProject({ name: 'New Project', area: 'work' });
    expect(result).toMatchObject({ ok: true });

    const inserted = client()._queryBuilder.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      user_id: 'test-user',
      name: 'New Project',
      area: 'work',
      status: 'idea',
    });
    expect(audit).toHaveBeenCalledWith('insert', 'projects', 'new-1', expect.anything());
  });

  it('create_project passes through optional fields and an explicit status', async () => {
    client()._setResult({ data: [{ id: 'new-2', name: 'Big Move' }], error: null });

    await handleCreateProject({
      name: 'Big Move',
      area: 'environment',
      status: 'active',
      priority: 'high',
      target_date: '2026-12-31',
      description: 'Relocate',
      outcome: 'Boxes unpacked',
      success_check: 'Sleeping in the new place',
    });

    const inserted = client()._queryBuilder.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      status: 'active',
      priority: 'high',
      target_date: '2026-12-31',
      description: 'Relocate',
      outcome: 'Boxes unpacked',
      success_check: 'Sleeping in the new place',
    });
  });

  it('update_project never writes the identifier as a column and returns before/after', async () => {
    client()._setResult({ data: [{ id: 'proj-1', name: 'Renamed' }], error: null });

    const result = await handleUpdateProject({ identifier: 'Project X', name: 'Renamed' });
    expect(resolveEntity).toHaveBeenCalledWith('projects', 'name', 'Project X');

    const patch = client()._queryBuilder.update.mock.calls[0][0];
    expect(patch).toEqual({ name: 'Renamed' });
    expect(patch).not.toHaveProperty('identifier');
    expect(result).toMatchObject({ ok: true, after: { id: 'proj-1', name: 'Renamed' } });
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(audit).toHaveBeenCalledWith('update', 'projects', 'proj-1', expect.anything());
  });

  it('update_project errors when no fields are provided', async () => {
    const result = await handleUpdateProject({ identifier: 'Project X' });
    expect(result).toMatchObject({ ok: false, error: 'validation_error' });
    expect(client()._queryBuilder.update).not.toHaveBeenCalled();
  });

  it('update_project returns the resolution error when the project is not found', async () => {
    vi.mocked(resolveEntity).mockResolvedValueOnce({
      ok: false,
      error: 'not_found',
      message: 'No projects found matching "nope".',
    });
    const result = await handleUpdateProject({ identifier: 'nope', status: 'done' });
    expect(result).toEqual({
      ok: false,
      error: 'not_found',
      message: 'No projects found matching "nope".',
    });
  });

  it('update_project accepts the §3.5 narrative fields', async () => {
    client()._setResult({ data: [{ id: 'proj-1' }], error: null });
    await handleUpdateProject({
      identifier: 'Project X',
      current_status: 'Waiting on the landlord',
      next_steps: 'Chase by Friday',
      notes: 'Ref 12345',
    });
    expect(client()._queryBuilder.update.mock.calls[0][0]).toEqual({
      current_status: 'Waiting on the landlord',
      next_steps: 'Chase by Friday',
      notes: 'Ref 12345',
    });
  });

  it('delete_project soft-deletes via archived_at and audits', async () => {
    const result = await handleDeleteProject({ identifier: 'Project X' });
    expect(result).toMatchObject({ ok: true });
    const patch = client()._queryBuilder.update.mock.calls[0][0];
    expect(typeof patch.archived_at).toBe('string');
    expect(Object.keys(patch)).toEqual(['archived_at']);
    expect(audit).toHaveBeenCalledWith('delete', 'projects', 'proj-1', expect.anything());
  });

  it('delete_project returns the resolution error when the project is ambiguous', async () => {
    vi.mocked(resolveEntity).mockResolvedValueOnce({
      ok: false,
      error: 'ambiguous',
      message: 'Multiple projects match "Pro". Please be more specific.',
    });
    const result = await handleDeleteProject({ identifier: 'Pro' });
    expect(result).toMatchObject({ ok: false, error: 'ambiguous' });
  });

  it('surfaces db errors as db_error', async () => {
    client()._setResult({ data: null, error: { message: 'boom' } });
    const result = await handleListProjects({});
    expect(result).toMatchObject({ ok: false, error: 'db_error', message: 'boom' });
  });
});
