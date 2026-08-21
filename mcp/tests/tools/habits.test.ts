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
  handleListHabits,
  handleLogHabit,
  handleCreateHabit,
  handleUpdateHabit,
  handleDeleteHabit,
} from '../../src/tools/habits.js';

const client = () => getClient() as unknown as {
  from: ReturnType<typeof vi.fn>;
  _setResult: (r: { data: unknown; error: unknown }) => void;
  _queryBuilder: Record<string, ReturnType<typeof vi.fn>>;
};

describe('habits tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client()._setResult({ data: [], error: null });
    vi.mocked(resolveEntity).mockResolvedValue({
      ok: true,
      row: { id: 'habit-1', name: 'Gym', polarity: 'build', metric_type: 'boolean', active: true },
    });
    vi.mocked(resolveByName).mockResolvedValue({
      ok: true,
      row: { id: 'habit-1', name: 'Gym', polarity: 'build', metric_type: 'boolean', active: true },
    });
  });

  it('list_habits queries the habit_stats view scoped to the user, active-only by default', async () => {
    client()._setResult({
      data: [
        {
          habit_id: 'habit-1',
          user_id: 'test-user',
          name: 'Gym',
          polarity: 'build',
          active: true,
          rate_30d: 66.7,
          rate_90d: 55.5,
          current_streak: 3,
          longest_streak: 12,
          strength_score: 61.2,
        },
        {
          habit_id: 'habit-2',
          user_id: 'test-user',
          name: 'Meditate',
          polarity: 'build',
          active: true,
          rate_30d: 90,
          rate_90d: 80,
          current_streak: 10,
          longest_streak: 30,
          strength_score: 85,
        },
      ],
      error: null,
    });

    const result = await handleListHabits({});
    expect(client().from).toHaveBeenCalledWith('habit_stats');
    expect((result as { count: number }).count).toBe(2);
    expect(Array.isArray((result as { habits: unknown[] }).habits)).toBe(true);
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('active', true);
    // The view already excludes archived habits — never filter archived_at against it.
    expect(client()._queryBuilder.is).not.toHaveBeenCalled();
  });

  it('list_habits omits the active filter when active_only is false', async () => {
    await handleListHabits({ active_only: false });
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(client()._queryBuilder.eq).not.toHaveBeenCalledWith('active', true);
  });

  it('log_habit inserts a habit_log with defaults and returns refreshed stats', async () => {
    client()._setResult({
      data: [{ id: 'log-1', habit_id: 'habit-1', value: 1, current_streak: 4 }],
      error: null,
    });

    const result = await handleLogHabit({ habit: 'Gym' });
    expect(resolveByName).toHaveBeenCalledWith('habits', 'name', 'Gym');
    expect(result).toMatchObject({ ok: true });

    const inserted = client()._queryBuilder.insert.mock.calls[0][0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      user_id: 'test-user',
      habit_id: 'habit-1',
      value: 1,
    });
    expect(typeof inserted.logged_at).toBe('string');

    expect(client().from).toHaveBeenCalledWith('habit_logs');
    expect(client().from).toHaveBeenCalledWith('habit_stats');
    expect(audit).toHaveBeenCalledWith('insert', 'habit_logs', 'log-1', expect.anything());
    expect((result as { stats: unknown }).stats).toBeTruthy();
  });

  it('log_habit honours explicit value, note and logged_at', async () => {
    client()._setResult({ data: [{ id: 'log-2', habit_id: 'habit-1' }], error: null });

    await handleLogHabit({
      habit: 'Gym',
      value: 45,
      note: 'legs day',
      logged_at: '2026-08-19T07:30:00.000Z',
    });

    expect(client()._queryBuilder.insert.mock.calls[0][0]).toMatchObject({
      value: 45,
      note: 'legs day',
      logged_at: '2026-08-19T07:30:00.000Z',
    });
  });

  it('log_habit propagates a habit resolution failure', async () => {
    vi.mocked(resolveByName).mockResolvedValueOnce({
      ok: false,
      error: 'not_found',
      message: 'No habits found matching "nope".',
    });
    const result = await handleLogHabit({ habit: 'nope' });
    expect(result).toEqual({
      ok: false,
      error: 'not_found',
      message: 'No habits found matching "nope".',
    });
    expect(client()._queryBuilder.insert).not.toHaveBeenCalled();
  });

  it('create_habit applies schema defaults and audits the insert', async () => {
    client()._setResult({ data: [{ id: 'habit-9', name: 'Read' }], error: null });

    const result = await handleCreateHabit({ name: 'Read' });
    expect(result).toMatchObject({ ok: true });

    expect(client()._queryBuilder.insert.mock.calls[0][0]).toMatchObject({
      user_id: 'test-user',
      name: 'Read',
      schedule: { type: 'daily' },
      metric_type: 'boolean',
      polarity: 'build',
    });
    expect(audit).toHaveBeenCalledWith('insert', 'habits', 'habit-9', expect.anything());
  });

  it('create_habit passes through explicit schedule, polarity, metric_type and target_value', async () => {
    client()._setResult({ data: [{ id: 'habit-10', name: 'Smoke' }], error: null });

    await handleCreateHabit({
      name: 'Smoke',
      schedule: { type: 'per_week', count: 3 },
      metric_type: 'count',
      polarity: 'break',
      target_value: 3,
    });

    expect(client()._queryBuilder.insert.mock.calls[0][0]).toMatchObject({
      schedule: { type: 'per_week', count: 3 },
      metric_type: 'count',
      polarity: 'break',
      target_value: 3,
    });
  });

  it('update_habit never writes the identifier as a column', async () => {
    client()._setResult({ data: [{ id: 'habit-1', name: 'Gym Renamed' }], error: null });

    const result = await handleUpdateHabit({ identifier: 'Gym', name: 'Gym Renamed', active: false });
    expect(result).toMatchObject({ ok: true });
    expect(resolveEntity).toHaveBeenCalledWith('habits', 'name', 'Gym');

    const patch = client()._queryBuilder.update.mock.calls[0][0];
    expect(patch).toEqual({ name: 'Gym Renamed', active: false });
    expect(patch).not.toHaveProperty('identifier');
    expect(audit).toHaveBeenCalledWith('update', 'habits', 'habit-1', expect.anything());
  });

  it('update_habit errors when no fields are provided', async () => {
    const result = await handleUpdateHabit({ identifier: 'Gym' });
    expect(result).toMatchObject({ ok: false, error: 'validation_error' });
    expect(client()._queryBuilder.update).not.toHaveBeenCalled();
  });

  it('delete_habit soft-deletes via archived_at and audits', async () => {
    const result = await handleDeleteHabit({ identifier: 'Gym' });
    expect(result).toMatchObject({ ok: true });

    const patch = client()._queryBuilder.update.mock.calls[0][0];
    expect(typeof patch.archived_at).toBe('string');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(audit).toHaveBeenCalledWith('delete', 'habits', 'habit-1', expect.anything());
  });

  it('delete_habit returns the resolution error when the habit is not found', async () => {
    vi.mocked(resolveEntity).mockResolvedValueOnce({
      ok: false,
      error: 'ambiguous',
      message: 'Multiple habits match "G". Please be more specific.',
    });
    const result = await handleDeleteHabit({ identifier: 'G' });
    expect(result).toMatchObject({ ok: false, error: 'ambiguous' });
  });

  it('surfaces db errors as db_error', async () => {
    client()._setResult({ data: null, error: { message: 'boom' } });
    const result = await handleListHabits({});
    expect(result).toMatchObject({ ok: false, error: 'db_error', message: 'boom' });
  });
});
