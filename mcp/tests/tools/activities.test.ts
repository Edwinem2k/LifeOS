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
import { resolveByName } from '../../src/resolve.js';
import { createMockQueryBuilder, type MockResult } from '../supabase.mock.js';
import { handleListActivities, handleLogActivity } from '../../src/tools/activities.js';

const client = () => getClient() as unknown as {
  from: ReturnType<typeof vi.fn>;
  _setResult: (r: { data: unknown; error: unknown }) => void;
  _queryBuilder: Record<string, ReturnType<typeof vi.fn>>;
};

/** A standalone query builder so multi-table handlers can be asserted per table. */
const builder = (result: MockResult) =>
  createMockQueryBuilder(result) as unknown as Record<string, ReturnType<typeof vi.fn>>;

describe('activities tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client()._setResult({ data: [], error: null });
    vi.mocked(resolveByName).mockResolvedValue({
      ok: true,
      row: { id: 'loc-1', name: 'Ginasio Lisboa' },
    });
  });

  // --- list_activities ---

  it('list_activities scopes to the user, skips archived rows and orders by occurred_at desc', async () => {
    client()._setResult({
      data: [{ id: 'act-1', activity_type: 'gym' }],
      error: null,
    });

    const result = await handleListActivities({ type: 'gym', since: '2026-08-01' });

    expect((result as { count: number }).count).toBe(1);
    expect(client().from).toHaveBeenCalledWith('activity_logs');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(client()._queryBuilder.is).toHaveBeenCalledWith('archived_at', null);
    // The tool param is `type`; the column is `activity_type`.
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('activity_type', 'gym');
    expect(client()._queryBuilder.gte).toHaveBeenCalledWith('occurred_at', '2026-08-01');
    expect(client()._queryBuilder.order).toHaveBeenCalledWith('occurred_at', { ascending: false });
  });

  it('list_activities attaches workout_sets to their parent activity', async () => {
    const activitiesBuilder = builder({
      data: [
        { id: 'act-1', activity_type: 'gym' },
        { id: 'act-2', activity_type: 'run' },
      ],
      error: null,
    });
    const setsBuilder = builder({
      data: [
        { id: 'set-1', activity_log_id: 'act-1', exercise: 'Bench Press', set_number: 1 },
        { id: 'set-2', activity_log_id: 'act-1', exercise: 'Bench Press', set_number: 2 },
      ],
      error: null,
    });
    client()
      .from.mockImplementationOnce(() => activitiesBuilder)
      .mockImplementationOnce(() => setsBuilder);

    const result = (await handleListActivities({})) as {
      activities: { id: string; workout_sets: unknown[] }[];
      count: number;
    };

    expect(result.count).toBe(2);
    expect(result.activities[0].workout_sets).toHaveLength(2);
    // Activities without sets still get an empty array.
    expect(result.activities[1].workout_sets).toEqual([]);
    expect(client().from).toHaveBeenNthCalledWith(2, 'workout_sets');
    expect(setsBuilder.in).toHaveBeenCalledWith('activity_log_id', ['act-1', 'act-2']);
    expect(setsBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(setsBuilder.is).toHaveBeenCalledWith('archived_at', null);
  });

  it('list_activities skips the workout_sets query when there are no activities', async () => {
    client()._setResult({ data: [], error: null });

    const result = await handleListActivities({});

    expect(result).toEqual({ activities: [], count: 0 });
    expect(client().from).toHaveBeenCalledTimes(1);
  });

  it('list_activities surfaces db errors as db_error', async () => {
    client()._setResult({ data: null, error: { message: 'boom' } });
    const result = await handleListActivities({});
    expect(result).toMatchObject({ ok: false, error: 'db_error', message: 'boom' });
  });

  // --- log_activity ---

  it('log_activity maps type to activity_type and always supplies occurred_at', async () => {
    client()._setResult({ data: [{ id: 'act-1', activity_type: 'gym' }], error: null });

    const result = await handleLogActivity({ type: 'gym', duration_min: 60, note: 'Leg day' });
    expect(result).toMatchObject({ ok: true });

    const inserted = client()._queryBuilder.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      user_id: 'test-user',
      activity_type: 'gym',
      duration_min: 60,
      note: 'Leg day',
    });
    expect(inserted).not.toHaveProperty('type');
    // activity_logs.occurred_at is NOT NULL with no DB default.
    expect(typeof inserted.occurred_at).toBe('string');
    expect(audit).toHaveBeenCalledWith('insert', 'activity_logs', 'act-1', expect.anything());
    expect((result as { workout_sets: unknown[]; warnings: string[] }).workout_sets).toEqual([]);
    expect((result as { warnings: string[] }).warnings).toEqual([]);
  });

  it('log_activity resolves a location name to location_id', async () => {
    client()._setResult({ data: [{ id: 'act-2' }], error: null });

    await handleLogActivity({ type: 'gym', location: 'Ginasio Lisboa' });

    expect(resolveByName).toHaveBeenCalledWith('locations', 'name', 'Ginasio Lisboa');
    expect(client()._queryBuilder.insert.mock.calls[0][0]).toMatchObject({ location_id: 'loc-1' });
  });

  it('log_activity propagates a failed location resolution', async () => {
    vi.mocked(resolveByName).mockResolvedValueOnce({
      ok: false,
      error: 'not_found',
      message: 'No locations found matching "nowhere".',
    });

    const result = await handleLogActivity({ type: 'gym', location: 'nowhere' });

    expect(result).toEqual({
      ok: false,
      error: 'not_found',
      message: 'No locations found matching "nowhere".',
    });
    expect(client().from).not.toHaveBeenCalled();
  });

  it('log_activity inserts workout sets with the resolved exercise_id', async () => {
    const activityBuilder = builder({ data: [{ id: 'act-9', activity_type: 'gym' }], error: null });
    const setsBuilder = builder({
      data: [{ id: 'set-1', activity_log_id: 'act-9', exercise: 'Bench Press' }],
      error: null,
    });
    client()
      .from.mockImplementationOnce(() => activityBuilder)
      .mockImplementationOnce(() => setsBuilder);
    vi.mocked(resolveByName).mockResolvedValue({
      ok: true,
      row: { id: 'ex-1', name: 'Bench Press' },
    });

    const result = (await handleLogActivity({
      type: 'gym',
      workout_sets: [
        { exercise: 'Bench Press', set_number: 1, reps: 8, weight_kg: 80, rpe: 8 },
        { exercise: 'Bench Press', set_number: 2, reps: 6, weight_kg: 85 },
      ],
    })) as { ok: true; workout_sets: unknown[]; warnings: string[] };

    expect(result.ok).toBe(true);
    expect(resolveByName).toHaveBeenCalledWith('exercises', 'name', 'Bench Press');

    const rows = setsBuilder.insert.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      user_id: 'test-user',
      activity_log_id: 'act-9',
      exercise_id: 'ex-1',
      exercise: 'Bench Press',
      set_number: 1,
      reps: 8,
      weight_kg: 80,
      rpe: 8,
    });
    expect(result.warnings).toEqual([]);
    expect(audit).toHaveBeenCalledWith('insert', 'workout_sets', 'act-9', expect.anything());
  });

  it('log_activity logs an unknown exercise with a null exercise_id and a warning', async () => {
    const activityBuilder = builder({ data: [{ id: 'act-10' }], error: null });
    const setsBuilder = builder({ data: [{ id: 'set-1' }], error: null });
    client()
      .from.mockImplementationOnce(() => activityBuilder)
      .mockImplementationOnce(() => setsBuilder);
    vi.mocked(resolveByName).mockResolvedValue({
      ok: false,
      error: 'not_found',
      message: 'No exercises found matching "Zercher Squat".',
    });

    const result = (await handleLogActivity({
      type: 'gym',
      workout_sets: [{ exercise: 'Zercher Squat', set_number: 1, reps: 5 }],
    })) as { ok: true; warnings: string[] };

    const rows = setsBuilder.insert.mock.calls[0][0] as Record<string, unknown>[];
    expect(rows[0].exercise_id).toBeNull();
    expect(rows[0].exercise).toBe('Zercher Squat');
    expect(result.warnings).toEqual([
      'Exercise "Zercher Squat" not in catalogue — logged without exercise_id.',
    ]);
  });

  it('log_activity surfaces an insert failure as db_error', async () => {
    client()._setResult({ data: null, error: { message: 'insert failed' } });
    const result = await handleLogActivity({ type: 'run' });
    expect(result).toMatchObject({ ok: false, error: 'db_error', message: 'insert failed' });
    expect(audit).not.toHaveBeenCalled();
  });
});
