import { getClient, USER_ID } from './supabase.js';

export type ResolveResult =
  | { ok: true; row: Record<string, any> }
  | {
      ok: false;
      error: 'not_found' | 'ambiguous' | 'db_error';
      message: string;
      candidates?: Record<string, unknown>[];
    };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Resolve an entity by name using case-insensitive ILIKE substring match.
 * Always scoped to USER_ID and `archived_at is null`.
 *
 * When several rows match the substring but exactly one matches the search term
 * verbatim (case-insensitively), that row wins — otherwise "Gym" could never be
 * addressed while "Gym warmup" exists.
 */
export async function resolveByName(
  table: string,
  nameColumn: string,
  searchTerm: string,
): Promise<ResolveResult> {
  const client = getClient();
  const { data, error } = await client
    .from(table)
    .select('*')
    .eq('user_id', USER_ID)
    .is('archived_at', null)
    .ilike(nameColumn, `%${searchTerm}%`);

  if (error) {
    return { ok: false, error: 'db_error', message: `Database error: ${error.message}` };
  }

  const rows = (data ?? []) as Record<string, any>[];

  if (rows.length === 0) {
    return {
      ok: false,
      error: 'not_found',
      message: `No ${table} found matching "${searchTerm}".`,
    };
  }

  if (rows.length === 1) {
    return { ok: true, row: rows[0] };
  }

  const needle = searchTerm.trim().toLowerCase();
  const exact = rows.filter(
    (row) => String(row[nameColumn] ?? '').trim().toLowerCase() === needle,
  );
  if (exact.length === 1) {
    return { ok: true, row: exact[0] };
  }

  return {
    ok: false,
    error: 'ambiguous',
    message: `Multiple ${table} match "${searchTerm}". Please be more specific.`,
    candidates: rows.map((row) => ({ id: row.id, [nameColumn]: row[nameColumn] })),
  };
}

/**
 * Resolve by ID or name. If the input looks like a UUID, resolve by ID directly.
 * Otherwise, use name resolution.
 */
export async function resolveEntity(
  table: string,
  nameColumn: string,
  idOrName: string,
): Promise<ResolveResult> {
  if (isUuid(idOrName)) {
    const client = getClient();
    const { data, error } = await client
      .from(table)
      .select('*')
      .eq('id', idOrName)
      .eq('user_id', USER_ID)
      .is('archived_at', null)
      .maybeSingle();

    if (error || !data) {
      return {
        ok: false,
        error: 'not_found',
        message: `No ${table} found with id "${idOrName}".`,
      };
    }
    return { ok: true, row: data as Record<string, any> };
  }

  return resolveByName(table, nameColumn, idOrName);
}
