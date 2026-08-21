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
  handleListGoals,
  handleCreateGoal,
  handleUpdateGoal,
  handleDeleteGoal,
} from '../../src/tools/goals.js';

const client = () => getClient() as unknown as {
  from: ReturnType<typeof vi.fn>;
  _setResult: (r: { data: unknown; error: unknown }) => void;
  _queryBuilder: Record<string, ReturnType<typeof vi.fn>>;
};

describe('goals tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client()._setResult({ data: [], error: null });
    vi.mocked(resolveEntity).mockResolvedValue({
      ok: true,
      row: { id: 'goal-1', title: 'Goal A', area: 'work', status: 'in_progress' },
    });
  });

  it('list_goals reads the goal_progress view, scopes to the user and groups by area', async () => {
    client()._setResult({
      data: [
        { goal_id: 'g1', title: 'Ship LifeOS', area: 'work', goal_status: 'in_progress', effective_pct: 40 },
        { goal_id: 'g2', title: 'Raise revenue', area: 'work', goal_status: 'on_track', effective_pct: 60 },
        { goal_id: 'g3', title: 'Run 500km', area: 'health', goal_status: 'at_risk', effective_pct: 20 },
      ],
      error: null,
    });

    const result = (await handleListGoals({})) as {
      goals_by_area: Record<string, unknown[]>;
      count: number;
    };

    expect(client().from).toHaveBeenCalledWith('goal_progress');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(result.count).toBe(3);
    expect(Object.keys(result.goals_by_area).sort()).toEqual(['health', 'work']);
    expect(result.goals_by_area.work).toHaveLength(2);
    expect(result.goals_by_area.health).toHaveLength(1);
  });

  it('list_goals never filters archived_at on the view and maps status to goal_status', async () => {
    await handleListGoals({ status: 'on_track', area: 'work', horizon: 'q3' });

    expect(client()._queryBuilder.is).not.toHaveBeenCalled();
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('goal_status', 'on_track');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('area', 'work');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('horizon', 'q3');
  });

  it('create_goal inserts with defaults, resolves parent_goal and audits', async () => {
    client()._setResult({ data: [{ id: 'new-1', title: 'Run 500km' }], error: null });

    const result = await handleCreateGoal({
      title: 'Run 500km',
      area: 'health',
      parent_goal: 'Goal A',
    });
    expect(result).toMatchObject({ ok: true });
    expect(resolveEntity).toHaveBeenCalledWith('goals', 'title', 'Goal A');

    const inserted = client()._queryBuilder.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      user_id: 'test-user',
      title: 'Run 500km',
      area: 'health',
      kind: 'goal',
      status: 'not_started',
      parent_goal_id: 'goal-1',
    });
    expect(audit).toHaveBeenCalledWith('insert', 'goals', 'new-1', expect.anything());
  });

  it('create_goal propagates a failed parent_goal resolution', async () => {
    vi.mocked(resolveEntity).mockResolvedValueOnce({
      ok: false,
      error: 'not_found',
      message: 'No goals found matching "nope".',
    });

    const result = await handleCreateGoal({ title: 'Child', area: 'work', parent_goal: 'nope' });
    expect(result).toEqual({
      ok: false,
      error: 'not_found',
      message: 'No goals found matching "nope".',
    });
    expect(client()._queryBuilder.insert).not.toHaveBeenCalled();
  });

  it('update_goal patches only provided fields and never writes the identifier', async () => {
    client()._setResult({ data: [{ id: 'goal-1', current_value: 120 }], error: null });

    const result = await handleUpdateGoal({
      identifier: 'Goal A',
      current_value: 120,
      status: 'on_track',
    });

    expect(result).toMatchObject({ ok: true });
    const patch = client()._queryBuilder.update.mock.calls[0][0];
    expect(patch).toEqual({ current_value: 120, status: 'on_track' });
    expect(patch).not.toHaveProperty('identifier');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('id', 'goal-1');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(audit).toHaveBeenCalledWith('update', 'goals', 'goal-1', expect.anything());
  });

  it('update_goal errors when no fields are provided', async () => {
    const result = await handleUpdateGoal({ identifier: 'Goal A' });
    expect(result).toMatchObject({ ok: false, error: 'validation_error' });
    expect(client()._queryBuilder.update).not.toHaveBeenCalled();
  });

  it('delete_goal soft-deletes via archived_at and audits', async () => {
    const result = await handleDeleteGoal({ identifier: 'Goal A' });
    expect(result).toMatchObject({ ok: true });

    const patch = client()._queryBuilder.update.mock.calls[0][0];
    expect(typeof patch.archived_at).toBe('string');
    expect(audit).toHaveBeenCalledWith('delete', 'goals', 'goal-1', expect.anything());
  });

  it('delete_goal returns the resolution error when the goal is not found', async () => {
    vi.mocked(resolveEntity).mockResolvedValueOnce({
      ok: false,
      error: 'ambiguous',
      message: 'Multiple goals match "Goal".',
    });
    const result = await handleDeleteGoal({ identifier: 'Goal' });
    expect(result).toMatchObject({ ok: false, error: 'ambiguous' });
  });

  it('surfaces db errors as db_error', async () => {
    client()._setResult({ data: null, error: { message: 'boom' } });
    const result = await handleListGoals({});
    expect(result).toMatchObject({ ok: false, error: 'db_error', message: 'boom' });
  });
});
