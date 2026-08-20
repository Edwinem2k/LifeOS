import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockClient } from './supabase.mock.js';

vi.mock('../src/supabase.js', () => ({
  getClient: vi.fn(),
  USER_ID: 'test-user-id',
}));

import { resolveByName, resolveEntity } from '../src/resolve.js';
import { getClient } from '../src/supabase.js';

describe('resolveByName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the row when exactly one match', async () => {
    const mockClient = createMockClient({
      data: [{ id: 'abc-123', title: 'Buy groceries' }],
      error: null,
    });
    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await resolveByName('tasks', 'title', 'groceries');
    expect(result).toEqual({
      ok: true,
      row: { id: 'abc-123', title: 'Buy groceries' },
    });
  });

  it('returns ambiguous when multiple matches', async () => {
    const mockClient = createMockClient({
      data: [
        { id: '1', title: 'Buy groceries' },
        { id: '2', title: 'Return groceries' },
      ],
      error: null,
    });
    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await resolveByName('tasks', 'title', 'groceries');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toBe('ambiguous');
    expect(result.candidates).toHaveLength(2);
  });

  it('returns not_found when no matches', async () => {
    const mockClient = createMockClient({ data: [], error: null });
    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await resolveByName('tasks', 'title', 'nonexistent');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toBe('not_found');
  });

  it('prefers an exact case-insensitive match over substring matches', async () => {
    const mockClient = createMockClient({
      data: [
        { id: '1', title: 'Gym' },
        { id: '2', title: 'Gym warmup' },
      ],
      error: null,
    });
    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await resolveByName('tasks', 'title', 'gym');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.row.id).toBe('1');
  });
});

describe('resolveEntity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('looks up by id when given a UUID', async () => {
    const mockClient = createMockClient({
      data: [{ id: '633325fe-9ccd-4e75-a1e7-0df043b70e5a', title: 'By id' }],
      error: null,
    });
    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await resolveEntity('tasks', 'title', '633325fe-9ccd-4e75-a1e7-0df043b70e5a');
    expect(result.ok).toBe(true);
    expect(mockClient._queryBuilder.eq).toHaveBeenCalledWith(
      'id',
      '633325fe-9ccd-4e75-a1e7-0df043b70e5a',
    );
  });

  it('falls back to name search for non-UUID input', async () => {
    const mockClient = createMockClient({
      data: [{ id: '1', title: 'Buy milk' }],
      error: null,
    });
    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await resolveEntity('tasks', 'title', 'milk');
    expect(result.ok).toBe(true);
    expect(mockClient._queryBuilder.ilike).toHaveBeenCalledWith('title', '%milk%');
  });
});
