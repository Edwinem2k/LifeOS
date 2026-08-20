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
  handleListNotes,
  handleCreateNote,
  handleUpdateNote,
  handleDeleteNote,
} from '../../src/tools/notes.js';

const client = () => getClient() as unknown as {
  from: ReturnType<typeof vi.fn>;
  _setResult: (r: { data: unknown; error: unknown }) => void;
  _queryBuilder: Record<string, ReturnType<typeof vi.fn>>;
};

describe('notes tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client()._setResult({ data: [], error: null });
    vi.mocked(resolveEntity).mockResolvedValue({
      ok: true,
      row: { id: 'note-1', title: 'Note A', body: 'Original body', kind: 'napkin' },
    });
  });

  it('list_notes returns a notes array scoped to the user and excludes archived rows', async () => {
    client()._setResult({
      data: [
        { id: '1', title: 'Note A', body: 'a' },
        { id: '2', title: 'Note B', body: 'b' },
      ],
      error: null,
    });

    const result = await handleListNotes({});
    expect(Array.isArray((result as { notes: unknown[] }).notes)).toBe(true);
    expect((result as { count: number }).count).toBe(2);
    expect(client().from).toHaveBeenCalledWith('notes');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(client()._queryBuilder.is).toHaveBeenCalledWith('archived_at', null);
    expect(client()._queryBuilder.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('list_notes applies kind, since and search filters', async () => {
    await handleListNotes({ kind: 'journal', since: '2026-01-01', search: 'lisbon' });

    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('kind', 'journal');
    expect(client()._queryBuilder.gte).toHaveBeenCalledWith('created_at', '2026-01-01');
    expect(client()._queryBuilder.or).toHaveBeenCalledWith(
      'title.ilike.%lisbon%,body.ilike.%lisbon%',
    );
  });

  it('create_note defaults kind to napkin and note_date to today', async () => {
    client()._setResult({ data: [{ id: 'new-1', body: 'Quick thought' }], error: null });

    const result = await handleCreateNote({ body: 'Quick thought' });
    expect(result).toMatchObject({ ok: true });

    const inserted = client()._queryBuilder.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      user_id: 'test-user',
      body: 'Quick thought',
      kind: 'napkin',
    });
    expect(inserted.note_date).toBe(new Date().toISOString().slice(0, 10));
    expect(audit).toHaveBeenCalledWith('insert', 'notes', 'new-1', expect.anything());
  });

  it('create_note honours explicit title, kind and note_date', async () => {
    client()._setResult({ data: [{ id: 'new-2', body: 'Standup' }], error: null });

    await handleCreateNote({
      body: 'Standup',
      title: 'Team standup',
      kind: 'meeting',
      note_date: '2026-03-04',
    });

    const inserted = client()._queryBuilder.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      title: 'Team standup',
      kind: 'meeting',
      note_date: '2026-03-04',
    });
  });

  it('update_note never writes the identifier as a column', async () => {
    client()._setResult({ data: [{ id: 'note-1', title: 'Renamed' }], error: null });

    const result = await handleUpdateNote({ identifier: 'Note A', title: 'Renamed' });
    expect(result).toMatchObject({ ok: true });
    expect(resolveEntity).toHaveBeenCalledWith('notes', 'title', 'Note A');

    const patch = client()._queryBuilder.update.mock.calls[0][0];
    expect(patch).toEqual({ title: 'Renamed' });
    expect(patch).not.toHaveProperty('identifier');
    expect(audit).toHaveBeenCalledWith('update', 'notes', 'note-1', expect.anything());
  });

  it('update_note errors when no fields are provided', async () => {
    const result = await handleUpdateNote({ identifier: 'Note A' });
    expect(result).toMatchObject({ ok: false, error: 'validation_error' });
  });

  it('update_note returns the resolution error when the note is not found', async () => {
    vi.mocked(resolveEntity).mockResolvedValueOnce({
      ok: false,
      error: 'not_found',
      message: 'No notes found matching "nonexistent".',
    });
    const result = await handleUpdateNote({ identifier: 'nonexistent', body: 'x' });
    expect(result).toEqual({
      ok: false,
      error: 'not_found',
      message: 'No notes found matching "nonexistent".',
    });
  });

  it('delete_note soft-deletes via archived_at', async () => {
    const result = await handleDeleteNote({ identifier: 'Note A' });
    expect(result).toMatchObject({ ok: true });

    const patch = client()._queryBuilder.update.mock.calls[0][0];
    expect(typeof patch.archived_at).toBe('string');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('id', 'note-1');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(audit).toHaveBeenCalledWith('delete', 'notes', 'note-1', expect.anything());
  });

  it('surfaces db errors as db_error', async () => {
    client()._setResult({ data: null, error: { message: 'boom' } });
    const result = await handleListNotes({});
    expect(result).toMatchObject({ ok: false, error: 'db_error', message: 'boom' });
  });
});
