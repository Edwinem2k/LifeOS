import { vi } from 'vitest';

export interface MockResult {
  data: unknown;
  error: unknown;
}

/**
 * Creates a chainable mock that mimics the supabase-js query builder.
 * Every non-terminal method returns the builder itself; awaiting the builder
 * resolves to the configured result. `_setResult` swaps the result mid-test.
 */
export function createMockQueryBuilder(
  result: MockResult = { data: [], error: null },
) {
  const builder: Record<string, unknown> = {};
  const methods = [
    'select', 'insert', 'update', 'delete', 'upsert',
    'eq', 'neq', 'in', 'is', 'ilike', 'like', 'or', 'not',
    'gte', 'lte', 'lt', 'gt', 'contains', 'overlaps',
    'order', 'limit', 'range', 'filter', 'textSearch',
  ];

  for (const method of methods) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }

  let current: MockResult = result;

  // Terminal-ish methods still return a thenable so chaining keeps working.
  builder.single = vi.fn().mockImplementation(() => {
    const row = Array.isArray(current.data) ? (current.data[0] ?? null) : current.data;
    return makeThenable(builder, { data: row, error: current.error });
  });
  builder.maybeSingle = builder.single;

  builder._setResult = (next: MockResult) => {
    current = next;
  };
  builder._getResult = () => current;

  Object.defineProperty(builder, 'then', {
    value: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(current).then(resolve, reject),
    writable: true,
    configurable: true,
  });

  return builder;
}

/** Wraps a one-off result while preserving the builder's chainable surface. */
function makeThenable(builder: Record<string, unknown>, result: MockResult) {
  return {
    ...builder,
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      Promise.resolve(result).then(resolve, reject),
  };
}

export function createMockClient(result: MockResult = { data: [], error: null }) {
  const queryBuilder = createMockQueryBuilder(result);
  return {
    from: vi.fn().mockReturnValue(queryBuilder),
    _queryBuilder: queryBuilder,
    _setResult: (next: MockResult) => (queryBuilder as { _setResult: (r: MockResult) => void })._setResult(next),
  };
}
