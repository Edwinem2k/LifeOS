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
  handleListContacts,
  handleCreateContact,
  handleUpdateContact,
  handleDeleteContact,
} from '../../src/tools/contacts.js';

const client = () => getClient() as unknown as {
  from: ReturnType<typeof vi.fn>;
  _setResult: (r: { data: unknown; error: unknown }) => void;
  _queryBuilder: Record<string, ReturnType<typeof vi.fn>>;
};

describe('contacts tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client()._setResult({ data: [], error: null });
    vi.mocked(resolveEntity).mockResolvedValue({
      ok: true,
      row: { id: 'contact-1', full_name: 'Sarah Jones', company: 'Acme' },
    });
  });

  it('list_contacts queries the contacts table scoped to the user and non-archived', async () => {
    client()._setResult({
      data: [
        { id: '1', full_name: 'Sarah Jones' },
        { id: '2', full_name: 'Bob Smith' },
      ],
      error: null,
    });

    const result = await handleListContacts({});
    expect(Array.isArray((result as { contacts: unknown[] }).contacts)).toBe(true);
    expect((result as { count: number }).count).toBe(2);
    expect(client().from).toHaveBeenCalledWith('contacts');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(client()._queryBuilder.is).toHaveBeenCalledWith('archived_at', null);
  });

  it('list_contacts applies an ilike OR filter across name, nickname and company', async () => {
    await handleListContacts({ search: 'Sar' });
    expect(client()._queryBuilder.or).toHaveBeenCalledWith(
      'full_name.ilike.%Sar%,nickname.ilike.%Sar%,company.ilike.%Sar%',
    );
  });

  it('list_contacts uses the today_agenda view for needs_followup and does not filter archived_at', async () => {
    client()._setResult({
      data: [
        {
          item_type: 'follow_up',
          item_id: 'contact-1',
          item_title: 'Sarah Jones',
          item_time: null,
          item_details: { days_overdue: 5 },
        },
      ],
      error: null,
    });

    const result = await handleListContacts({ needs_followup: true });
    expect(client().from).toHaveBeenCalledWith('today_agenda');
    expect(client().from).not.toHaveBeenCalledWith('contacts');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('item_type', 'follow_up');
    expect(client()._queryBuilder.is).not.toHaveBeenCalled();
    expect((result as { count: number }).count).toBe(1);
    expect((result as { contacts: { item_id: string }[] }).contacts[0].item_id).toBe('contact-1');
  });

  it('create_contact inserts scoped to the user and stores emails/phones as arrays', async () => {
    client()._setResult({ data: [{ id: 'new-1', full_name: 'Ana Costa' }], error: null });

    const result = await handleCreateContact({
      full_name: 'Ana Costa',
      nickname: 'Ana',
      company: 'Acme',
      emails: ['ana@example.com', 'ana@work.com'],
      phones: ['+351900000000'],
      follow_up_interval_days: 30,
    });
    expect(result).toMatchObject({ ok: true });

    const inserted = client()._queryBuilder.insert.mock.calls[0][0];
    expect(inserted).toMatchObject({
      user_id: 'test-user',
      full_name: 'Ana Costa',
      nickname: 'Ana',
      company: 'Acme',
      emails: ['ana@example.com', 'ana@work.com'],
      phones: ['+351900000000'],
      follow_up_interval_days: 30,
    });
    expect(inserted).not.toHaveProperty('last_interaction_at');
    expect(audit).toHaveBeenCalledWith('insert', 'contacts', 'new-1', expect.anything());
  });

  it('update_contact patches only provided fields and never writes the identifier', async () => {
    client()._setResult({ data: [{ id: 'contact-1', company: 'NewCo' }], error: null });

    const result = await handleUpdateContact({ identifier: 'Sarah Jones', company: 'NewCo' });
    expect(result).toMatchObject({ ok: true });
    expect(resolveEntity).toHaveBeenCalledWith('contacts', 'full_name', 'Sarah Jones');

    const patch = client()._queryBuilder.update.mock.calls[0][0];
    expect(patch).toEqual({ company: 'NewCo' });
    expect(patch).not.toHaveProperty('identifier');
    expect(audit).toHaveBeenCalledWith('update', 'contacts', 'contact-1', expect.anything());
  });

  it('update_contact errors when no fields are provided', async () => {
    const result = await handleUpdateContact({ identifier: 'Sarah Jones' });
    expect(result).toMatchObject({ ok: false, error: 'validation_error' });
  });

  it('update_contact returns the resolution error when the contact is not found', async () => {
    vi.mocked(resolveEntity).mockResolvedValueOnce({
      ok: false,
      error: 'not_found',
      message: 'No contacts found matching "nobody".',
    });
    const result = await handleUpdateContact({ identifier: 'nobody', company: 'X' });
    expect(result).toEqual({
      ok: false,
      error: 'not_found',
      message: 'No contacts found matching "nobody".',
    });
  });

  it('delete_contact soft-deletes via archived_at and audits', async () => {
    const result = await handleDeleteContact({ identifier: 'Sarah Jones' });
    expect(result).toMatchObject({ ok: true });
    const patch = client()._queryBuilder.update.mock.calls[0][0];
    expect(typeof patch.archived_at).toBe('string');
    expect(client()._queryBuilder.eq).toHaveBeenCalledWith('user_id', 'test-user');
    expect(audit).toHaveBeenCalledWith('delete', 'contacts', 'contact-1', expect.anything());
  });

  it('surfaces db errors as db_error', async () => {
    client()._setResult({ data: null, error: { message: 'boom' } });
    const result = await handleListContacts({});
    expect(result).toMatchObject({ ok: false, error: 'db_error', message: 'boom' });
  });
});
