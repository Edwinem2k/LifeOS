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
import {
  weekStart,
  handleTodayAgenda,
  handleProjectProgress,
  handleAreaProgress,
  handleWeeklyReview,
  handleExercisesAvailable,
} from '../../src/tools/views.js';

const client = () => getClient() as unknown as {
  from: ReturnType<typeof vi.fn>;
  _setResult: (r: { data: unknown; error: unknown }) => void;
  _queryBuilder: Record<string, ReturnType<typeof vi.fn>>;
};

describe('views tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client()._setResult({ data: [], error: null });
    vi.mocked(resolveByName).mockResolvedValue({
      ok: true,
      row: { id: 'proj-1', name: 'Project X', area: 'work' },
    });
  });

  // --- weekStart helper -----------------------------------------------------

  it('weekStart returns the Monday of the week for a mid-week date', () => {
    // 2026-08-20 is a Thursday -> Monday 2026-08-17
    expect(weekStart('2026-08-20')).toBe('2026-08-17');
  });

  it('weekStart returns the same day when given a Monday', () => {
    expect(weekStart('2026-08-17')).toBe('2026-08-17');
  });

  it('weekStart maps a Sunday to the PRECEDING Monday (Postgres week semantics)', () => {
    // 2026-08-23 is a Sunday -> belongs to the week starting Monday 2026-08-17
    expect(weekStart('2026-08-23')).toBe('2026-08-17');
    // 2026-01-04 is a Sunday -> Monday 2025-12-29 (crosses the year boundary)
    expect(weekStart('2026-01-04')).toBe('2025-12-29');
  });

  it('weekStart defaults to the current week when no date is given', () => {
    const result = weekStart();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The returned date must itself be a Monday.
    expect(new Date(`${result}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  // --- today_agenda ---------------------------------------------------------

  it('today_agenda groups rows by item_type and is scoped to the user', async () => {
    client()._setResult({
      data: [
        { user_id: 'test-user', item_type: 'event', item_id: 'e1', item_title: 'Standup' },
        { user_id: 'test-user', item_type: 'task', item_id: 't1', item_title: 'Ship it' },
        { user_id: 'test-user', item_type: 'habit', item_id: 'h1', item_title: 'Gym' },
        { user_id: 'test-user', item_type: 'follow_up', item_id: 'c1', item_title: 'Sarah' },
        { user_id: 'test-user', item_type: 'task', item_id: 't2', item_title: 'Also this' },
      ],
      error: null,
    });

    const result = (await handleTodayAgenda({})) as {
      agenda: Record<string, unknown[]>;
      count: number;
    };

    expect(client().from).toHaveBeenCalledWith('today_agenda');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    // Views already exclude archived rows — no archived_at column exists.
    expect(client()._queryBuilder.is).not.toHaveBeenCalled();

    expect(result.count).toBe(5);
    expect(result.agenda.events).toHaveLength(1);
    expect(result.agenda.tasks).toHaveLength(2);
    expect(result.agenda.habits).toHaveLength(1);
    expect(result.agenda.follow_ups).toHaveLength(1);
    // No writes from a read-only tool.
    expect(audit).not.toHaveBeenCalled();
  });

  it('today_agenda returns empty groups when there is nothing today', async () => {
    const result = (await handleTodayAgenda({})) as {
      agenda: Record<string, unknown[]>;
      count: number;
    };
    expect(result.count).toBe(0);
    expect(result.agenda).toEqual({ events: [], tasks: [], habits: [], follow_ups: [] });
  });

  // --- project_progress -----------------------------------------------------

  it('project_progress queries the view and filters by resolved project_id', async () => {
    client()._setResult({
      data: [{ project_id: 'proj-1', name: 'Project X', pct_complete: 40 }],
      error: null,
    });

    const result = (await handleProjectProgress({ project: 'Project X' })) as {
      projects: unknown[];
      count: number;
    };

    expect(client().from).toHaveBeenCalledWith('project_progress');
    expect(resolveByName).toHaveBeenCalledWith('projects', 'name', 'Project X');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('project_id', 'proj-1');
    expect(client()._queryBuilder.is).not.toHaveBeenCalled();
    expect(result.count).toBe(1);
  });

  it('project_progress propagates a project resolution failure', async () => {
    vi.mocked(resolveByName).mockResolvedValueOnce({
      ok: false,
      error: 'not_found',
      message: 'No projects found matching "nope".',
    });
    const result = await handleProjectProgress({ project: 'nope' });
    expect(result).toMatchObject({ ok: false, error: 'not_found' });
  });

  // --- area_progress --------------------------------------------------------

  it('area_progress applies optional area and horizon filters', async () => {
    client()._setResult({
      data: [{ area: 'health', horizon: 'q3', goal_count: 3, avg_pct: 55.5 }],
      error: null,
    });

    const result = (await handleAreaProgress({ area: 'health', horizon: 'q3' })) as {
      areas: unknown[];
      count: number;
    };

    expect(client().from).toHaveBeenCalledWith('area_progress');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('area', 'health');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('horizon', 'q3');
    expect(result.count).toBe(1);
  });

  it('area_progress omits filters when no params are given', async () => {
    await handleAreaProgress({});
    const eqCalls = client()._queryBuilder.eq.mock.calls;
    expect(eqCalls).toEqual([['user_id', 'test-user']]);
  });

  // --- weekly_review --------------------------------------------------------

  it('weekly_review filters on the computed Monday week_start', async () => {
    client()._setResult({
      data: [{ week_start: '2026-08-17', tasks_completed: 7, habits_pct: 62.5 }],
      error: null,
    });

    const result = (await handleWeeklyReview({ week: '2026-08-20' })) as {
      week_start: string;
      review: unknown;
    };

    expect(client().from).toHaveBeenCalledWith('weekly_review');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('week_start', '2026-08-17');
    expect(result.week_start).toBe('2026-08-17');
    expect(result.review).toMatchObject({ tasks_completed: 7 });
  });

  it('weekly_review returns null review when the week has no activity', async () => {
    client()._setResult({ data: [], error: null });
    const result = (await handleWeeklyReview({ week: '2026-08-23' })) as {
      week_start: string;
      review: unknown;
    };
    // Sunday resolves back to the preceding Monday.
    expect(result.week_start).toBe('2026-08-17');
    expect(result.review).toBeNull();
  });

  // --- exercises_available --------------------------------------------------

  it('exercises_available filters by resolved location_id', async () => {
    vi.mocked(resolveByName).mockResolvedValueOnce({
      ok: true,
      row: { id: 'loc-1', name: 'Home Gym' },
    });
    client()._setResult({
      data: [
        { exercise_id: 'ex-1', exercise_name: 'Push-up', location_id: 'loc-1' },
        { exercise_id: 'ex-2', exercise_name: 'Squat', location_id: 'loc-1' },
      ],
      error: null,
    });

    const result = (await handleExercisesAvailable({ location: 'Home Gym' })) as {
      exercises: unknown[];
      count: number;
    };

    expect(client().from).toHaveBeenCalledWith('exercises_available');
    expect(resolveByName).toHaveBeenCalledWith('locations', 'name', 'Home Gym');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('location_id', 'loc-1');
    expect(result.count).toBe(2);
  });

  it('exercises_available propagates a location resolution failure', async () => {
    vi.mocked(resolveByName).mockResolvedValueOnce({
      ok: false,
      error: 'ambiguous',
      message: 'Multiple locations match "gym". Please be more specific.',
    });
    const result = await handleExercisesAvailable({ location: 'gym' });
    expect(result).toMatchObject({ ok: false, error: 'ambiguous' });
  });

  // --- error surface --------------------------------------------------------

  it('surfaces db errors as db_error across the view tools', async () => {
    client()._setResult({ data: null, error: { message: 'boom' } });

    expect(await handleTodayAgenda({})).toMatchObject({ ok: false, error: 'db_error', message: 'boom' });
    expect(await handleProjectProgress({})).toMatchObject({ ok: false, error: 'db_error', message: 'boom' });
    expect(await handleAreaProgress({})).toMatchObject({ ok: false, error: 'db_error', message: 'boom' });
    expect(await handleWeeklyReview({})).toMatchObject({ ok: false, error: 'db_error', message: 'boom' });
    expect(await handleExercisesAvailable({})).toMatchObject({ ok: false, error: 'db_error', message: 'boom' });
  });
});
