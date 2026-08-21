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
import { createMockQueryBuilder } from '../supabase.mock.js';
import {
  handleListLists,
  handleCreateList,
  handleListItems,
  handleCreateListItem,
  handleUpdateListItem,
  validateMetadata,
} from '../../src/tools/lists.js';

const client = () => getClient() as unknown as {
  from: ReturnType<typeof vi.fn>;
  _setResult: (r: { data: unknown; error: unknown }) => void;
  _queryBuilder: Record<string, ReturnType<typeof vi.fn>>;
};

const MOVIE_SCHEMA = [
  { key: 'director', label: 'Director', type: 'text' },
  { key: 'year', label: 'Year', type: 'number' },
  { key: 'watched', label: 'Watched', type: 'boolean' },
];

const UUID = '11111111-1111-1111-1111-111111111111';

describe('lists tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps implementations, so restore the default single-builder routing
    client().from.mockReturnValue(client()._queryBuilder);
    client()._setResult({ data: [], error: null });
    vi.mocked(resolveEntity).mockResolvedValue({
      ok: true,
      row: { id: 'list-1', name: 'Movies', item_schema: MOVIE_SCHEMA },
    });
  });

  // --- list_lists ---

  it('list_lists returns each list with item_count and item_schema, scoped to the user', async () => {
    const listsBuilder = createMockQueryBuilder({
      data: [
        { id: 'list-1', name: 'Movies', item_schema: MOVIE_SCHEMA },
        { id: 'list-2', name: 'Books', item_schema: null },
      ],
      error: null,
    }) as Record<string, any>;
    const itemsBuilder = createMockQueryBuilder({
      data: [{ list_id: 'list-1' }, { list_id: 'list-1' }, { list_id: 'list-2' }],
      error: null,
    }) as Record<string, any>;
    client().from.mockImplementation((table: string) =>
      table === 'lists' ? listsBuilder : itemsBuilder,
    );

    const result = (await handleListLists({})) as {
      lists: Array<Record<string, unknown>>;
      count: number;
    };

    expect(result.count).toBe(2);
    expect(result.lists[0]).toMatchObject({ name: 'Movies', item_count: 2 });
    expect(result.lists[0].item_schema).toEqual(MOVIE_SCHEMA);
    // a null item_schema is normalised to an empty array
    expect(result.lists[1]).toMatchObject({ name: 'Books', item_count: 1, item_schema: [] });

    expect(listsBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(listsBuilder.is).toHaveBeenCalledWith('archived_at', null);
    expect(itemsBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(itemsBuilder.is).toHaveBeenCalledWith('archived_at', null);
  });

  it('list_lists surfaces db errors as db_error', async () => {
    client()._setResult({ data: null, error: { message: 'boom' } });
    const result = await handleListLists({});
    expect(result).toMatchObject({ ok: false, error: 'db_error', message: 'boom' });
  });

  // --- create_list ---

  it('create_list applies kind and item_schema defaults and audits the insert', async () => {
    client()._setResult({ data: [{ id: 'new-1', name: 'Reading' }], error: null });

    const result = await handleCreateList({ name: 'Reading' });
    expect(result).toMatchObject({ ok: true });

    const inserted = client()._queryBuilder.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      user_id: 'test-user',
      name: 'Reading',
      kind: 'custom',
      item_schema: [],
    });
    expect(audit).toHaveBeenCalledWith('insert', 'lists', 'new-1', expect.anything());
  });

  it('create_list keeps an explicit kind and item_schema', async () => {
    client()._setResult({ data: [{ id: 'new-2', name: 'Movies' }], error: null });

    await handleCreateList({
      name: 'Movies',
      kind: 'movies',
      description: 'Films to watch',
      icon: '🎬',
      item_schema: MOVIE_SCHEMA,
    });

    const inserted = client()._queryBuilder.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      kind: 'movies',
      description: 'Films to watch',
      icon: '🎬',
      item_schema: MOVIE_SCHEMA,
    });
  });

  // --- list_items ---

  it('list_items filters by the resolved list, status and sort order', async () => {
    client()._setResult({
      data: [
        { id: 'item-1', title: 'Inception', status: 'open' },
        { id: 'item-2', title: 'Arrival', status: 'open' },
      ],
      error: null,
    });

    const result = (await handleListItems({ list: 'Movies', status: 'open' })) as {
      list: string;
      item_schema: unknown;
      items: unknown[];
      count: number;
    };

    expect(resolveEntity).toHaveBeenCalledWith('lists', 'name', 'Movies');
    expect(result.list).toBe('Movies');
    expect(result.item_schema).toEqual(MOVIE_SCHEMA);
    expect(result.count).toBe(2);
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('list_id', 'list-1');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('status', 'open');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(client()._queryBuilder.is).toHaveBeenCalledWith('archived_at', null);
    expect(client()._queryBuilder.order).toHaveBeenCalledWith('sort_order');
  });

  it('list_items propagates a list resolution failure', async () => {
    vi.mocked(resolveEntity).mockResolvedValueOnce({
      ok: false,
      error: 'not_found',
      message: 'No lists found matching "nope".',
    });
    const result = await handleListItems({ list: 'nope' });
    expect(result).toEqual({
      ok: false,
      error: 'not_found',
      message: 'No lists found matching "nope".',
    });
  });

  // --- create_list_item ---

  it('create_list_item inserts conforming metadata with defaults and audits', async () => {
    client()._setResult({ data: [{ id: 'item-9', title: 'Inception' }], error: null });

    const result = await handleCreateListItem({
      list: 'Movies',
      title: 'Inception',
      metadata: { director: 'Nolan', year: 2010, watched: true },
    });
    expect(result).toMatchObject({ ok: true });

    const inserted = client()._queryBuilder.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      user_id: 'test-user',
      list_id: 'list-1',
      title: 'Inception',
      status: 'open',
      metadata: { director: 'Nolan', year: 2010, watched: true },
    });
    expect(audit).toHaveBeenCalledWith('insert', 'list_items', 'item-9', expect.anything());
  });

  it('create_list_item rejects metadata keys not in the list item_schema', async () => {
    const result = await handleCreateListItem({
      list: 'Movies',
      title: 'Inception',
      metadata: { rating: 5 },
    });
    expect(result).toMatchObject({ ok: false, error: 'validation_error' });
    expect((result as { message: string }).message).toContain('rating');
    expect(client()._queryBuilder.insert).not.toHaveBeenCalled();
  });

  it('create_list_item rejects a metadata value of the wrong type', async () => {
    const result = await handleCreateListItem({
      list: 'Movies',
      title: 'Inception',
      metadata: { year: 'twenty ten' },
    });
    expect(result).toMatchObject({
      ok: false,
      error: 'validation_error',
      message: 'year must be a number',
    });
    expect(client()._queryBuilder.insert).not.toHaveBeenCalled();
  });

  it('create_list_item propagates a list resolution failure', async () => {
    vi.mocked(resolveEntity).mockResolvedValueOnce({
      ok: false,
      error: 'ambiguous',
      message: 'Multiple lists match "m".',
    });
    const result = await handleCreateListItem({ list: 'm', title: 'Inception' });
    expect(result).toMatchObject({ ok: false, error: 'ambiguous' });
  });

  // --- update_list_item ---

  it('update_list_item requires a list when the identifier is not a UUID', async () => {
    const result = await handleUpdateListItem({ identifier: 'Inception', title: 'Renamed' });
    expect(result).toMatchObject({ ok: false, error: 'validation_error' });
    expect((result as { message: string }).message).toContain('list');
  });

  it('update_list_item finds the item within the list and never writes the identifier', async () => {
    client()._setResult({
      data: [{ id: 'item-1', title: 'Inception', list_id: 'list-1' }],
      error: null,
    });

    const result = await handleUpdateListItem({
      identifier: 'Inception',
      list: 'Movies',
      title: 'Inception (2010)',
    });
    expect(result).toMatchObject({ ok: true });

    expect(client()._queryBuilder.ilike).toHaveBeenCalledWith('title', '%Inception%');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('list_id', 'list-1');

    const patch = client()._queryBuilder.update.mock.calls[0][0];
    expect(patch).toEqual({ title: 'Inception (2010)' });
    expect(patch).not.toHaveProperty('identifier');
    expect(audit).toHaveBeenCalledWith('update', 'list_items', 'item-1', expect.anything());
  });

  it('update_list_item returns not_found when no item matches in the list', async () => {
    client()._setResult({ data: [], error: null });
    const result = await handleUpdateListItem({
      identifier: 'Nope',
      list: 'Movies',
      status: 'done',
    });
    expect(result).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('update_list_item returns ambiguous with candidates when several items match', async () => {
    client()._setResult({
      data: [
        { id: 'item-1', title: 'Inception', list_id: 'list-1' },
        { id: 'item-2', title: 'Inception II', list_id: 'list-1' },
      ],
      error: null,
    });
    const result = await handleUpdateListItem({
      identifier: 'Inception',
      list: 'Movies',
      status: 'done',
    });
    expect(result).toMatchObject({ ok: false, error: 'ambiguous' });
    expect((result as { candidates: unknown[] }).candidates).toHaveLength(2);
  });

  it('update_list_item resolves list_items directly when the identifier is a UUID', async () => {
    vi.mocked(resolveEntity).mockResolvedValueOnce({
      ok: true,
      row: { id: 'item-1', title: 'Inception', list_id: 'list-1' },
    });
    client()._setResult({ data: [{ id: 'item-1', status: 'done' }], error: null });

    const result = await handleUpdateListItem({ identifier: UUID, status: 'done' });
    expect(result).toMatchObject({ ok: true });
    expect(resolveEntity).toHaveBeenCalledWith('list_items', 'title', UUID);
    expect(client()._queryBuilder.update.mock.calls[0][0]).toEqual({ status: 'done' });
  });

  it('update_list_item errors when no fields are provided', async () => {
    const result = await handleUpdateListItem({ identifier: UUID });
    expect(result).toMatchObject({ ok: false, error: 'validation_error' });
    expect(client()._queryBuilder.update).not.toHaveBeenCalled();
  });

  it('update_list_item validates metadata against the owning list item_schema', async () => {
    client()._setResult({
      data: [{ id: 'item-1', title: 'Inception', list_id: 'list-1' }],
      error: null,
    });
    const result = await handleUpdateListItem({
      identifier: 'Inception',
      list: 'Movies',
      metadata: { watched: 'yes' },
    });
    expect(result).toMatchObject({
      ok: false,
      error: 'validation_error',
      message: 'watched must be a boolean',
    });
    expect(client()._queryBuilder.update).not.toHaveBeenCalled();
  });

  // --- validateMetadata unit ---

  it('validateMetadata accepts conforming metadata and a missing schema', () => {
    expect(validateMetadata({ director: 'Nolan', year: 2010 }, MOVIE_SCHEMA)).toEqual({ ok: true });
    expect(validateMetadata({}, [])).toEqual({ ok: true });
    // null values are skipped rather than type-checked
    expect(validateMetadata({ year: null as unknown as number }, MOVIE_SCHEMA)).toEqual({ ok: true });
  });

  it('validateMetadata explains which keys are valid when the schema is empty', () => {
    const result = validateMetadata({ anything: 1 }, []);
    expect(result).toMatchObject({ ok: false, error: 'validation_error' });
    expect((result as { message: string }).message).toContain('no item_schema');
  });

  it('surfaces db errors as db_error on create_list_item', async () => {
    client()._setResult({ data: null, error: { message: 'boom' } });
    const result = await handleCreateListItem({ list: 'Movies', title: 'Inception' });
    expect(result).toMatchObject({ ok: false, error: 'db_error', message: 'boom' });
  });
});
