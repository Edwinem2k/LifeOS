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
import { handleListInteractions, handleCreateInteraction } from '../../src/tools/interactions.js';

const client = () => getClient() as unknown as {
  from: ReturnType<typeof vi.fn>;
  _setResult: (r: { data: unknown; error: unknown }) => void;
  _queryBuilder: Record<string, ReturnType<typeof vi.fn>>;
};

describe('interactions tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client()._setResult({ data: [], error: null });
    vi.mocked(resolveEntity).mockResolvedValue({
      ok: true,
      row: { id: 'contact-1', full_name: 'Sarah Jones' },
    });
  });

  it('list_interactions scopes to the user, the contact and non-archived rows', async () => {
    client()._setResult({
      data: [
        { id: 'i-1', kind: 'call', summary: 'Caught up', occurred_at: '2026-08-19T10:00:00Z' },
        { id: 'i-2', kind: 'message', summary: 'Sent link', occurred_at: '2026-08-18T10:00:00Z' },
      ],
      error: null,
    });

    const result = await handleListInteractions({ contact: 'Sarah' });

    expect(resolveEntity).toHaveBeenCalledWith('contacts', 'full_name', 'Sarah');
    expect(result).toMatchObject({ contact: 'Sarah Jones', count: 2 });
    expect(Array.isArray((result as { interactions: unknown[] }).interactions)).toBe(true);
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('contact_id', 'contact-1');
    expect(client()._queryBuilder.is).toHaveBeenCalledWith('archived_at', null);
    expect(client()._queryBuilder.order).toHaveBeenCalledWith('occurred_at', { ascending: false });
  });

  it('list_interactions applies the optional kind and since filters', async () => {
    await handleListInteractions({ contact: 'Sarah', kind: 'call', since: '2026-08-01' });

    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('kind', 'call');
    expect(client()._queryBuilder.gte).toHaveBeenCalledWith('occurred_at', '2026-08-01');
  });

  it('list_interactions propagates a contact resolution failure', async () => {
    vi.mocked(resolveEntity).mockResolvedValueOnce({
      ok: false,
      error: 'not_found',
      message: 'No contacts found matching "nope".',
    });

    const result = await handleListInteractions({ contact: 'nope' });
    expect(result).toEqual({
      ok: false,
      error: 'not_found',
      message: 'No contacts found matching "nope".',
    });
    expect(client()._queryBuilder.select).not.toHaveBeenCalled();
  });

  it('create_interaction always supplies occurred_at and defaults source to agent', async () => {
    client()._setResult({ data: [{ id: 'new-1', summary: 'Called about the flat' }], error: null });

    const result = await handleCreateInteraction({
      contact: 'Sarah',
      kind: 'call',
      summary: 'Called about the flat',
    });

    expect(result).toMatchObject({ ok: true });

    const inserted = client()._queryBuilder.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      user_id: 'test-user',
      contact_id: 'contact-1',
      kind: 'call',
      summary: 'Called about the flat',
      source: 'agent',
    });
    expect(typeof inserted.occurred_at).toBe('string');
    expect(audit).toHaveBeenCalledWith('insert', 'interactions', 'new-1', expect.anything());
  });

  it('create_interaction honours explicit occurred_at and source', async () => {
    client()._setResult({ data: [{ id: 'new-2' }], error: null });

    await handleCreateInteraction({
      contact: 'Sarah',
      kind: 'meeting',
      summary: 'Coffee',
      occurred_at: '2026-08-15T09:30:00Z',
      source: 'manual',
    });

    const inserted = client()._queryBuilder.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      kind: 'meeting',
      occurred_at: '2026-08-15T09:30:00Z',
      source: 'manual',
    });
  });

  it('create_interaction never writes last_interaction_at (DB trigger owns it)', async () => {
    client()._setResult({ data: [{ id: 'new-3' }], error: null });

    await handleCreateInteraction({ contact: 'Sarah', kind: 'note', summary: 'Birthday soon' });

    const inserted = client()._queryBuilder.insert.mock.calls[0][0];
    expect(inserted).not.toHaveProperty('last_interaction_at');
    expect(inserted).not.toHaveProperty('contact');
  });

  it('create_interaction propagates a contact resolution failure without inserting', async () => {
    vi.mocked(resolveEntity).mockResolvedValueOnce({
      ok: false,
      error: 'ambiguous',
      message: 'Multiple contacts match "S". Please be more specific.',
    });

    const result = await handleCreateInteraction({ contact: 'S', kind: 'call', summary: 'Hi' });
    expect(result).toMatchObject({ ok: false, error: 'ambiguous' });
    expect(client()._queryBuilder.insert).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it('surfaces db errors as db_error', async () => {
    client()._setResult({ data: null, error: { message: 'boom' } });

    const listResult = await handleListInteractions({ contact: 'Sarah' });
    expect(listResult).toMatchObject({ ok: false, error: 'db_error', message: 'boom' });

    const createResult = await handleCreateInteraction({
      contact: 'Sarah',
      kind: 'call',
      summary: 'Hi',
    });
    expect(createResult).toMatchObject({ ok: false, error: 'db_error', message: 'boom' });
    expect(audit).not.toHaveBeenCalled();
  });
});
