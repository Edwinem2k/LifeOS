# LifeOS MCP Server Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a custom MCP server (42 tools) that gives Hermes, Claude Desktop, and Claude Code typed read/write access to the LifeOS Supabase database.

**Architecture:** Node.js stdio MCP server in `mcp/` subdirectory. Uses `@modelcontextprotocol/sdk` for MCP protocol, `supabase-js` for DB access, `zod` for input validation. Each tool file exports tool definitions (name, description, zod schema, handler). A shared `supabase.ts` provides the client and audit helper; `resolve.ts` handles name-based entity lookup.

**Tech Stack:** TypeScript, @modelcontextprotocol/sdk, @supabase/supabase-js, zod, dotenv, vitest (testing)

**Spec:** `docs/superpowers/specs/2026-08-19-lifeos-mcp-server-design.md`

---

## File Structure

```
mcp/
  package.json
  tsconfig.json
  .env.example
  .gitignore
  vitest.config.ts
  src/
    index.ts              — MCP server bootstrap, startup validation, registers all tools
    supabase.ts           — Supabase client, USER_ID constant, audit() helper
    resolve.ts            — resolveByName() generic name-to-id resolution
    types.ts              — Shared zod schemas for enums, tool registration helper type
    tools/
      tasks.ts            — 5 tools: list, create, update, complete, delete
      projects.ts         — 4 tools: list, create, update, delete
      goals.ts            — 4 tools: list, create, update, delete
      habits.ts           — 5 tools: list, log, create, update, delete
      notes.ts            — 4 tools: list, create, update, delete
      contacts.ts         — 4 tools: list, create, update, delete
      interactions.ts     — 2 tools: list, create
      lists.ts            — 5 tools: list_lists, create_list, list_items, create_item, update_item
      activities.ts       — 2 tools: list, log
      links.ts            — 2 tools: list, create
      views.ts            — 5 tools: today_agenda, project_progress, area_progress, weekly_review, exercises_available
  tests/
    supabase.mock.ts      — Shared mock factory for supabase-js
    resolve.test.ts
    tools/
      tasks.test.ts
      projects.test.ts
      goals.test.ts
      habits.test.ts
      notes.test.ts
      contacts.test.ts
      interactions.test.ts
      lists.test.ts
      activities.test.ts
      links.test.ts
      views.test.ts
```

---

## Cross-Cutting Patterns

**`identifier` pattern:** All update/complete/delete tools use a single `identifier: string` param (required) that accepts either a UUID or a name/title search term. This avoids the `id`/`title` collision where `title` could mean "which task?" or "new title value." The `resolveEntity()` function auto-detects UUIDs vs name searches. Each entity type resolves against its natural name column (tasks: `title`, projects: `name`, contacts: `full_name`, etc.).

**Handler + registration separation:** Each tool file exports handler functions (for testing) AND a `registerXTools(server)` function (for MCP registration). Tests import handlers directly; `index.ts` calls the register functions.

**All update tools** follow this shape: `identifier` (required), then optional fields to patch. All delete tools take just `identifier`. This applies to tasks, projects, goals, habits, notes, contacts, and list items.

---

## Chunk 1: Scaffold + Core Infrastructure

### Task 1: Project scaffold

**Files:**
- Create: `mcp/package.json`
- Create: `mcp/tsconfig.json`
- Create: `mcp/.env.example`
- Create: `mcp/.gitignore`
- Create: `mcp/vitest.config.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "lifeos-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "@supabase/supabase-js": "^2.112.0",
    "dotenv": "^16.4.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/node": "^20",
    "typescript": "^5",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create .env.example**

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
LIFEOS_USER_ID=your-user-uuid
LIFEOS_ACTOR=hermes
```

- [ ] **Step 4: Create .gitignore**

```
node_modules/
dist/
.env
```

- [ ] **Step 5: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    root: '.',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 6: Install dependencies**

Run: `cd C:\dev\LifeOS\mcp && npm install`
Expected: `node_modules` created, `package-lock.json` generated

- [ ] **Step 7: Verify TypeScript compiles**

Run: `cd C:\dev\LifeOS\mcp && npx tsc --noEmit`
Expected: no errors (no source files yet, should be clean)

- [ ] **Step 8: Commit**

```bash
cd C:\dev\LifeOS
git add mcp/package.json mcp/tsconfig.json mcp/.env.example mcp/.gitignore mcp/vitest.config.ts mcp/package-lock.json
git commit -m "feat(mcp): scaffold lifeos-mcp server package"
```

---

### Task 2: Shared types and enums

**Files:**
- Create: `mcp/src/types.ts`

- [ ] **Step 1: Create types.ts with zod enum schemas and tool registration type**

```typescript
import { z } from 'zod';

// --- Enums matching LifeOS Supabase schema (001_core_tables.sql) ---

export const lifeAreaSchema = z.enum([
  'money', 'health', 'growth', 'work', 'relationships', 'play', 'environment',
]);
export type LifeArea = z.infer<typeof lifeAreaSchema>;

export const projectStatusSchema = z.enum(['idea', 'active', 'paused', 'done']);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const taskStatusSchema = z.enum([
  'inbox', 'next_action', 'in_progress', 'waiting_for', 'blocked', 'someday', 'done',
]);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const goalKindSchema = z.enum(['goal', 'key_result']);
export const goalStatusSchema = z.enum([
  'not_started', 'in_progress', 'on_track', 'at_risk', 'done',
]);
export const goalHorizonSchema = z.enum(['annual', 'q1', 'q2', 'q3', 'q4']);

export const habitPolaritySchema = z.enum(['build', 'break']);
export const habitMetricTypeSchema = z.enum(['boolean', 'count', 'duration', 'value']);

export const activityTypeSchema = z.enum([
  'gym', 'yoga', 'kitesurf', 'run', 'walk', 'other',
]);

export const interactionKindSchema = z.enum(['call', 'meeting', 'message', 'note']);
export const interactionSourceSchema = z.enum(['manual', 'transcriber', 'agent']);

export const noteKindSchema = z.enum([
  'morning_pages', 'note', 'meeting', 'journal', 'napkin',
]);

export const listKindSchema = z.enum([
  'travel', 'movies', 'tv', 'books', 'games', 'shopping', 'custom',
]);
export const listItemStatusSchema = z.enum(['open', 'done']);

export const linkRelationSchema = z.enum([
  'related', 'blocks', 'mentions', 'contributes_to', 'attended', 'about',
]);

export const priorityLevelSchema = z.enum(['high', 'medium', 'low']);

// --- Tool registration helper ---

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  handler: (params: unknown) => Promise<unknown>;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd C:\dev\LifeOS\mcp && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd C:\dev\LifeOS
git add mcp/src/types.ts
git commit -m "feat(mcp): add shared zod enums and tool registration type"
```

---

### Task 3: Supabase client and audit helper

**Files:**
- Create: `mcp/src/supabase.ts`

- [ ] **Step 1: Create supabase.ts**

```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from the mcp/ directory (not cwd — important when spawned by Hermes/Claude)
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '..', '.env') });

// --- Startup validation ---

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'LIFEOS_USER_ID', 'LIFEOS_ACTOR'] as const;
for (const key of required) {
  if (!process.env[key]) {
    console.error(`FATAL: Missing required env var: ${key}`);
    process.exit(1);
  }
}

export const SUPABASE_URL = process.env.SUPABASE_URL!;
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const USER_ID = process.env.LIFEOS_USER_ID!;
export const ACTOR = process.env.LIFEOS_ACTOR!;

// --- Supabase client (service role — bypasses RLS) ---

let _client: SupabaseClient | null = null;

export function getClient(): SupabaseClient {
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  }
  return _client;
}

// --- Audit helper ---

export async function audit(
  action: 'insert' | 'update' | 'delete',
  tableName: string,
  recordId: string | null,
  details: Record<string, unknown>,
): Promise<void> {
  const client = getClient();
  await client.from('agent_actions').insert({
    user_id: USER_ID,
    actor: ACTOR,
    action,
    table_name: tableName,
    record_id: recordId,
    details,
  });
}
```

Note: Uses explicit `.env` path resolution via `import.meta.url` so it works correctly when Hermes or Claude spawns the process from any working directory.

- [ ] **Step 2: Verify it compiles**

Run: `cd C:\dev\LifeOS\mcp && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd C:\dev\LifeOS
git add mcp/src/supabase.ts
git commit -m "feat(mcp): add supabase client with startup validation and audit helper"
```

---

### Task 4: Name-based entity resolution

**Files:**
- Create: `mcp/src/resolve.ts`
- Create: `mcp/tests/supabase.mock.ts`
- Create: `mcp/tests/resolve.test.ts`

- [ ] **Step 1: Create the Supabase mock factory**

```typescript
// mcp/tests/supabase.mock.ts
import { vi } from 'vitest';

/**
 * Creates a chainable mock that mimics supabase-js query builder.
 * Usage: const mock = createMockClient(); mock._setResult(data, error);
 */
export function createMockQueryBuilder(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const builder: Record<string, unknown> = {};
  const methods = [
    'from', 'select', 'insert', 'update', 'delete',
    'eq', 'neq', 'in', 'is', 'ilike', 'or', 'not', 'gte', 'lte', 'lt', 'gt',
    'order', 'limit', 'single', 'maybeSingle',
    'filter', 'range', 'textSearch',
  ];

  for (const method of methods) {
    builder[method] = vi.fn().mockReturnValue(builder);
  }

  // Terminal methods return the result
  builder.then = undefined; // Make it thenable
  const resultPromise = Promise.resolve(result);

  // Override: when awaited, return the result
  // The builder itself is a thenable
  Object.defineProperty(builder, 'then', {
    value: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      resultPromise.then(resolve, reject),
    writable: true,
    configurable: true,
  });

  return builder;
}

export function createMockClient(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const queryBuilder = createMockQueryBuilder(result);
  return {
    from: vi.fn().mockReturnValue(queryBuilder),
    _queryBuilder: queryBuilder,
  };
}
```

- [ ] **Step 2: Write the failing test for resolve.ts**

```typescript
// mcp/tests/resolve.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockClient } from './supabase.mock.js';

// Mock supabase module before importing resolve
vi.mock('../src/supabase.js', () => ({
  getClient: vi.fn(),
  USER_ID: 'test-user-id',
}));

import { resolveByName } from '../src/resolve.js';
import { getClient } from '../src/supabase.js';

describe('resolveByName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the row when exactly one match', async () => {
    const mockClient = createMockClient({
      data: [{ id: 'abc-123', name: 'Buy groceries' }],
      error: null,
    });
    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await resolveByName('tasks', 'title', 'groceries');
    expect(result).toEqual({
      ok: true,
      row: { id: 'abc-123', name: 'Buy groceries' },
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
    expect(result.error).toBe('ambiguous');
    expect(result.candidates).toHaveLength(2);
  });

  it('returns not_found when no matches', async () => {
    const mockClient = createMockClient({ data: [], error: null });
    vi.mocked(getClient).mockReturnValue(mockClient as never);

    const result = await resolveByName('tasks', 'title', 'nonexistent');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('not_found');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd C:\dev\LifeOS\mcp && npx vitest run tests/resolve.test.ts`
Expected: FAIL — `resolveByName` does not exist

- [ ] **Step 4: Implement resolve.ts**

```typescript
// mcp/src/resolve.ts
import { getClient, USER_ID } from './supabase.js';

export type ResolveResult =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; error: 'not_found' | 'ambiguous'; message: string; candidates?: Record<string, unknown>[] };

/**
 * Resolve an entity by name using case-insensitive ILIKE substring match.
 * Always scoped to USER_ID and archived_at is null.
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
    return { ok: false, error: 'not_found', message: `Database error: ${error.message}` };
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      error: 'not_found',
      message: `No ${table} found matching "${searchTerm}".`,
    };
  }

  if (data.length === 1) {
    return { ok: true, row: data[0] };
  }

  return {
    ok: false,
    error: 'ambiguous',
    message: `Multiple ${table} match "${searchTerm}". Please be more specific.`,
    candidates: data.map((row) => ({ id: row.id, [nameColumn]: row[nameColumn] })),
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
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (uuidRegex.test(idOrName)) {
    const client = getClient();
    const { data, error } = await client
      .from(table)
      .select('*')
      .eq('id', idOrName)
      .eq('user_id', USER_ID)
      .is('archived_at', null)
      .single();

    if (error || !data) {
      return { ok: false, error: 'not_found', message: `No ${table} found with id "${idOrName}".` };
    }
    return { ok: true, row: data };
  }

  return resolveByName(table, nameColumn, idOrName);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd C:\dev\LifeOS\mcp && npx vitest run tests/resolve.test.ts`
Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
cd C:\dev\LifeOS
git add mcp/src/resolve.ts mcp/tests/supabase.mock.ts mcp/tests/resolve.test.ts
git commit -m "feat(mcp): add name-based entity resolution with tests"
```

---

### Task 5: MCP server bootstrap (index.ts)

**Files:**
- Create: `mcp/src/index.ts`

- [ ] **Step 1: Create index.ts with MCP server bootstrap**

This file will be updated in later tasks to import and register tools. Start with the skeleton.

```typescript
// mcp/src/index.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import './supabase.js'; // Triggers startup validation

// Tool imports will be added as each tool file is built
// import { registerTaskTools } from './tools/tasks.js';
// ...

const server = new McpServer({
  name: 'lifeos',
  version: '0.1.0',
});

// Tool registrations will be added here
// registerTaskTools(server);
// ...

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('LifeOS MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify it compiles**

Run: `cd C:\dev\LifeOS\mcp && npx tsc --noEmit`
Expected: no errors (tool imports are commented out)

- [ ] **Step 3: Commit**

```bash
cd C:\dev\LifeOS
git add mcp/src/index.ts
git commit -m "feat(mcp): add MCP server bootstrap skeleton"
```

---

## Chunk 2: Tasks + Projects Tools

### Task 6: Tasks tools (5 tools)

**Files:**
- Create: `mcp/src/tools/tasks.ts`
- Create: `mcp/tests/tools/tasks.test.ts`
- Modify: `mcp/src/index.ts` — uncomment tasks import + registration

This is the **reference implementation** — all subsequent tool files follow this pattern.

- [ ] **Step 1: Write failing tests for task tools**

```typescript
// mcp/tests/tools/tasks.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockClient } from '../supabase.mock.js';

// Mock supabase module using the shared mock factory
vi.mock('../../src/supabase.js', () => {
  const mock = createMockClient({
    data: [
      { id: '1', title: 'Task A', status: 'inbox', project_id: null },
      { id: '2', title: 'Task B', status: 'in_progress', project_id: 'proj-1' },
    ],
    error: null,
  });
  return {
    getClient: vi.fn(() => mock),
    USER_ID: 'test-user',
    ACTOR: 'test',
    audit: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('../../src/resolve.js', () => ({
  resolveEntity: vi.fn().mockResolvedValue({
    ok: true,
    row: { id: '1', title: 'Task A', status: 'inbox' },
  }),
  resolveByName: vi.fn().mockResolvedValue({
    ok: true,
    row: { id: 'proj-1', name: 'Project X', area: 'work', priority: 'high' },
  }),
}));

// Import AFTER mocks are set up
const { handleListTasks, handleCreateTask, handleCompleteTask } = await import(
  '../../src/tools/tasks.js'
);
import { resolveEntity } from '../../src/resolve.js';

describe('tasks tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list_tasks returns tasks array', async () => {
    const result = await handleListTasks({});
    expect(result).toBeDefined();
    expect(Array.isArray(result.tasks)).toBe(true);
  });

  it('create_task with project inherits area from project', async () => {
    const result = await handleCreateTask({ title: 'Test task', project: 'Project X' });
    expect(result).toBeDefined();
  });

  it('complete_task resolves by identifier', async () => {
    const result = await handleCompleteTask({ identifier: 'Task A' });
    expect(result).toBeDefined();
    expect(resolveEntity).toHaveBeenCalledWith('tasks', 'title', 'Task A');
  });

  it('complete_task returns error when task not found', async () => {
    vi.mocked(resolveEntity).mockResolvedValueOnce({
      ok: false,
      error: 'not_found',
      message: 'No tasks found matching "nonexistent".',
    });
    const result = await handleCompleteTask({ identifier: 'nonexistent' });
    expect(result).toEqual({
      ok: false,
      error: 'not_found',
      message: 'No tasks found matching "nonexistent".',
    });
  });
});
```

Note: Tests use the shared `createMockClient` factory from `supabase.mock.ts` (Task 4) for resilient mocking. The `identifier` pattern (not separate `id`/`title`) is used throughout — all update/complete/delete tools use a single `identifier` string that accepts either a UUID or a name search term.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd C:\dev\LifeOS\mcp && npx vitest run tests/tools/tasks.test.ts`
Expected: FAIL — module `../../src/tools/tasks.js` not found

- [ ] **Step 3: Implement tasks.ts**

```typescript
// mcp/src/tools/tasks.ts
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getClient, USER_ID, audit } from '../supabase.js';
import { resolveEntity, resolveByName } from '../resolve.js';
import { taskStatusSchema, lifeAreaSchema, priorityLevelSchema } from '../types.js';

// --- Handlers (exported for testing) ---

export async function handleListTasks(params: {
  project?: string;
  status?: string;
  area?: string;
  include_done?: boolean;
}) {
  const client = getClient();
  let query = client
    .from('tasks')
    .select('*, projects(name)')
    .eq('user_id', USER_ID)
    .is('archived_at', null);

  if (params.status) {
    query = query.eq('status', params.status);
  } else if (!params.include_done) {
    query = query.neq('status', 'done');
  }

  if (params.area) query = query.eq('area', params.area);

  if (params.project) {
    const resolved = await resolveByName('projects', 'name', params.project);
    if (!resolved.ok) return resolved;
    query = query.eq('project_id', resolved.row.id);
  }

  const { data, error } = await query.order('sort_order');
  if (error) return { error: 'db_error', message: error.message };
  return { tasks: data, count: data?.length ?? 0 };
}

export async function handleCreateTask(params: {
  title: string;
  project?: string;
  parent_task?: string;
  area?: string;
  priority?: string;
  deadline?: string;
  notes?: string;
  status?: string;
}) {
  const client = getClient();
  const row: Record<string, unknown> = {
    user_id: USER_ID,
    title: params.title,
    status: params.status ?? 'inbox',
  };

  if (params.notes) row.notes = params.notes;
  if (params.deadline) row.deadline = params.deadline;

  // Resolve project and inherit defaults
  if (params.project) {
    const resolved = await resolveByName('projects', 'name', params.project);
    if (!resolved.ok) return resolved;
    row.project_id = resolved.row.id;
    // Inherit from project when not explicitly set
    if (!params.area && resolved.row.area) row.area = resolved.row.area;
    if (!params.priority && resolved.row.priority) row.priority = resolved.row.priority;
    if (!params.deadline && resolved.row.target_date) row.deadline = resolved.row.target_date;
  }

  // Explicit params override inheritance
  if (params.area) row.area = params.area;
  if (params.priority) row.priority = params.priority;

  // Resolve parent task for subtasks
  if (params.parent_task) {
    const resolved = await resolveEntity('tasks', 'title', params.parent_task);
    if (!resolved.ok) return resolved;
    row.parent_task_id = resolved.row.id;
  }

  const { data, error } = await client
    .from('tasks')
    .insert(row)
    .select()
    .single();

  if (error) return { error: 'db_error', message: error.message };
  await audit('insert', 'tasks', data.id, { after: data });
  return { ok: true, task: data };
}

export async function handleUpdateTask(params: {
  identifier: string;
  title?: string;
  notes?: string;
  status?: string;
  area?: string;
  priority?: string;
  deadline?: string;
  project?: string;
  parent_task?: string;
  sort_order?: number;
}) {
  // identifier is used for lookup only — never written to the DB
  const resolved = await resolveEntity('tasks', 'title', params.identifier);
  if (!resolved.ok) return resolved;

  const before = resolved.row;
  const patch: Record<string, unknown> = {};

  // Only include fields that were explicitly provided (not undefined)
  if (params.title !== undefined) patch.title = params.title;
  if (params.notes !== undefined) patch.notes = params.notes;
  if (params.status !== undefined) patch.status = params.status;
  if (params.area !== undefined) patch.area = params.area;
  if (params.priority !== undefined) patch.priority = params.priority;
  if (params.deadline !== undefined) patch.deadline = params.deadline;
  if (params.sort_order !== undefined) patch.sort_order = params.sort_order;

  // Resolve project name to ID
  if (params.project !== undefined) {
    if (params.project === null || params.project === '') {
      patch.project_id = null;
    } else {
      const projResolved = await resolveByName('projects', 'name', params.project as string);
      if (!projResolved.ok) return projResolved;
      patch.project_id = projResolved.row.id;
    }
  }

  // Resolve parent task
  if (params.parent_task !== undefined) {
    if (params.parent_task === null || params.parent_task === '') {
      patch.parent_task_id = null;
    } else {
      const parentResolved = await resolveEntity('tasks', 'title', params.parent_task as string);
      if (!parentResolved.ok) return parentResolved;
      patch.parent_task_id = parentResolved.row.id;
    }
  }

  if (Object.keys(patch).length === 0) {
    return { error: 'validation_error', message: 'No fields to update.' };
  }

  const client = getClient();
  const { data, error } = await client
    .from('tasks')
    .update(patch)
    .eq('id', before.id)
    .eq('user_id', USER_ID)
    .select()
    .single();

  if (error) return { error: 'db_error', message: error.message };
  await audit('update', 'tasks', data.id, { before, after: data });
  return { ok: true, before, after: data };
}

export async function handleCompleteTask(params: { identifier: string }) {
  const resolved = await resolveEntity('tasks', 'title', params.identifier);
  if (!resolved.ok) return resolved;

  const before = resolved.row;
  const client = getClient();
  const { data, error } = await client
    .from('tasks')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('id', before.id)
    .eq('user_id', USER_ID)
    .select()
    .single();

  if (error) return { error: 'db_error', message: error.message };
  await audit('update', 'tasks', data.id, { before, after: data });
  return { ok: true, task: data };
}

export async function handleDeleteTask(params: { identifier: string }) {
  const resolved = await resolveEntity('tasks', 'title', params.identifier);
  if (!resolved.ok) return resolved;

  const client = getClient();
  const { error } = await client
    .from('tasks')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', resolved.row.id)
    .eq('user_id', USER_ID);

  if (error) return { error: 'db_error', message: error.message };
  await audit('delete', 'tasks', resolved.row.id as string, { before: resolved.row });
  return { ok: true, message: `Task "${resolved.row.title}" archived.` };
}

// --- MCP Registration ---

export function registerTaskTools(server: McpServer) {
  server.tool(
    'list_tasks',
    'List tasks, optionally filtered by project, status, or area. Excludes done tasks by default.',
    {
      project: z.string().optional().describe('Project name to filter by'),
      status: taskStatusSchema.optional().describe('Filter by status'),
      area: lifeAreaSchema.optional().describe('Filter by life area'),
      include_done: z.boolean().optional().default(false).describe('Include completed tasks'),
    },
    async ({ project, status, area, include_done }) => {
      const result = await handleListTasks({ project, status, area, include_done });
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'create_task',
    'Create a new task. If a project is specified, area/priority/deadline inherit from the project unless explicitly set.',
    {
      title: z.string().describe('Task title'),
      project: z.string().optional().describe('Project name (resolved by name)'),
      parent_task: z.string().optional().describe('Parent task title for subtasks'),
      area: lifeAreaSchema.optional().describe('Life area'),
      priority: priorityLevelSchema.optional().describe('Priority level'),
      deadline: z.string().optional().describe('Deadline date (YYYY-MM-DD)'),
      notes: z.string().optional().describe('Task notes'),
      status: taskStatusSchema.optional().default('inbox').describe('Initial status'),
    },
    async (params) => {
      const result = await handleCreateTask(params);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'update_task',
    'Update a task. Identify it by UUID or title search, then provide fields to change.',
    {
      identifier: z.string().describe('Task UUID or title to search for'),
      title: z.string().optional().describe('New title'),
      notes: z.string().optional().describe('Updated notes'),
      status: taskStatusSchema.optional().describe('New status'),
      area: lifeAreaSchema.optional().describe('New area'),
      priority: priorityLevelSchema.optional().describe('New priority'),
      deadline: z.string().optional().describe('New deadline (YYYY-MM-DD)'),
      project: z.string().optional().describe('New project name'),
      parent_task: z.string().optional().describe('New parent task (for subtasks)'),
      sort_order: z.number().optional().describe('Manual sort order'),
    },
    async (params) => {
      const result = await handleUpdateTask(params);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'complete_task',
    'Mark a task as done. Sets status to done and completed_at to now.',
    {
      identifier: z.string().describe('Task UUID or title to search for'),
    },
    async (params) => {
      const result = await handleCompleteTask(params);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    'delete_task',
    'Soft-delete a task (sets archived_at). The task is hidden but not destroyed.',
    {
      identifier: z.string().describe('Task UUID or title to search for'),
    },
    async (params) => {
      const result = await handleDeleteTask(params);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\dev\LifeOS\mcp && npx vitest run tests/tools/tasks.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Update index.ts to register task tools**

Uncomment the tasks import and registration in `mcp/src/index.ts`:

```typescript
import { registerTaskTools } from './tools/tasks.js';
// ... in server setup:
registerTaskTools(server);
```

- [ ] **Step 6: Verify full project compiles**

Run: `cd C:\dev\LifeOS\mcp && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
cd C:\dev\LifeOS
git add mcp/src/tools/tasks.ts mcp/tests/tools/tasks.test.ts mcp/src/index.ts
git commit -m "feat(mcp): add task tools (list, create, update, complete, delete)"
```

---

### Task 7: Projects tools (4 tools)

**Files:**
- Create: `mcp/src/tools/projects.ts`
- Create: `mcp/tests/tools/projects.test.ts`
- Modify: `mcp/src/index.ts` — add projects import + registration

Follow the exact same pattern as Task 6 (tasks.ts). Key differences:

**Handler specifics:**
- `handleListProjects`: query the `project_progress` **view** directly (NOT the projects table — the view already includes project fields plus computed stats). Columns: `project_id`, `name`, `project_status`, `area`, `total_tasks`, `done_tasks`, `pct_complete`, `blocked_count`, `overdue_count`. Filter by `project_status` (not `status` — the view renames it), `area`.

```typescript
// Key code: query the view, not the table
const { data, error } = await client
  .from('project_progress')
  .select('*')
  .eq('user_id', USER_ID);
```

- `handleCreateProject`: required fields: `name`, `area`. Optional: `status` (default 'idea'), `priority`, `target_date`, `description`, `outcome`, `success_check`.
- `handleUpdateProject`: resolve by `identifier` (name or UUID) via `resolveEntity('projects', 'name', ...)`. Mutable fields: `name`, `description`, `status`, `priority`, `area`, `target_date`, `color`, `current_status`, `next_steps`, `notes`, `outcome`, `success_check`. Uses same `identifier` pattern as tasks — single param, not separate `id`/`name`.
- `handleDeleteProject`: soft delete via `archived_at`. Uses `identifier` param.

**Registration:** each tool uses `server.tool(name, description, zodSchema, handler)` — same pattern as tasks.

- [ ] **Step 1: Write tests for projects tools** (3 tests minimum: list, create, update)
- [ ] **Step 2: Run tests to verify they fail**
- [ ] **Step 3: Implement projects.ts following tasks.ts pattern**
- [ ] **Step 4: Run tests to verify they pass**

Run: `cd C:\dev\LifeOS\mcp && npx vitest run tests/tools/projects.test.ts`

- [ ] **Step 5: Add import + registration to index.ts**

```typescript
import { registerProjectTools } from './tools/projects.js';
registerProjectTools(server);
```

- [ ] **Step 6: Verify full project compiles**

Run: `cd C:\dev\LifeOS\mcp && npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add mcp/src/tools/projects.ts mcp/tests/tools/projects.test.ts mcp/src/index.ts
git commit -m "feat(mcp): add project tools (list, create, update, delete)"
```

---

## Chunk 3: Goals + Habits + Notes

### Task 8: Goals tools (4 tools)

**Files:**
- Create: `mcp/src/tools/goals.ts`
- Create: `mcp/tests/tools/goals.test.ts`
- Modify: `mcp/src/index.ts`

**Handler specifics:**
- `handleListGoals`: query `goal_progress` view (migration 003 — NOT the 002 version). View columns: `goal_id`, `user_id`, `title`, `kind`, `area`, `horizon`, `goal_status`, `target_value`, `current_value`, `unit`, `progress_mode`, `direct_pct`, `kr_count`, `kr_done_count`, `kr_pct`, `effective_pct`. Only returns `kind = 'goal'` rows (view already filters this). Group results by `area` in the response.
- `handleCreateGoal`: required: `title`, `area`. Optional: `kind` (default 'goal'), `horizon`, `target_value`, `unit`, `parent_goal` (resolved by title to `parent_goal_id`), `due_date`, `notes`, `status` (default 'not_started').
- `handleUpdateGoal`: resolve by `id` or `title`. Mutable: `title`, `status`, `area`, `horizon`, `target_value`, `current_value`, `unit`, `due_date`, `notes`, `progress_mode`.
- `handleDeleteGoal`: soft delete.

- [ ] **Step 1: Write tests** (3 tests: list returns grouped by area, create with parent_goal resolution, update)
- [ ] **Step 2: Run tests — expect fail**
- [ ] **Step 3: Implement goals.ts**
- [ ] **Step 4: Run tests — expect pass**
- [ ] **Step 5: Register in index.ts**
- [ ] **Step 6: Compile check**
- [ ] **Step 7: Commit**

```bash
git commit -m "feat(mcp): add goal tools (list, create, update, delete)"
```

---

### Task 9: Habits tools (5 tools)

**Files:**
- Create: `mcp/src/tools/habits.ts`
- Create: `mcp/tests/tools/habits.test.ts`
- Modify: `mcp/src/index.ts`

**Handler specifics:**
- `handleListHabits`: query `habit_stats` view. Columns: `habit_id`, `user_id`, `name`, `polarity`, `active`, `rate_30d`, `rate_90d`, `current_streak`, `longest_streak`, `strength_score`. Filter by `active` if `active_only` is true (default).
- `handleLogHabit`: resolve habit by `name` via `resolveByName('habits', 'name', ...)`. Insert into `habit_logs`: `user_id`, `habit_id`, `value` (default 1), `note`, `logged_at` (default `new Date().toISOString()` — DB column has NO default, tool must always provide). After inserting, re-query `habit_stats` view for this habit to return updated streak info.

```typescript
// Key code: log then fetch updated stats
const { data: logEntry } = await client.from('habit_logs').insert({
  user_id: USER_ID,
  habit_id: resolved.row.id,
  value: params.value ?? 1,
  note: params.note,
  logged_at: params.logged_at ?? new Date().toISOString(),
}).select().single();

// Fetch updated stats from the view
const { data: stats } = await client
  .from('habit_stats')
  .select('*')
  .eq('habit_id', resolved.row.id)
  .eq('user_id', USER_ID)
  .single();

return { ok: true, logged: logEntry, stats };
```
- `handleCreateHabit`: required: `name`. Optional: `schedule` (default `{"type":"daily"}`), `metric_type` (default 'boolean'), `polarity` (default 'build'), `target_value`.
- `handleUpdateHabit`: resolve by `id` or `name`. Mutable: `name`, `schedule`, `metric_type`, `polarity`, `target_value`, `active`.
- `handleDeleteHabit`: soft delete.

- [ ] **Step 1: Write tests** (3 tests: list with stats, log_habit creates habit_log, create)
- [ ] **Step 2: Run tests — expect fail**
- [ ] **Step 3: Implement habits.ts**
- [ ] **Step 4: Run tests — expect pass**
- [ ] **Step 5: Register in index.ts**
- [ ] **Step 6: Compile check**
- [ ] **Step 7: Commit**

```bash
git commit -m "feat(mcp): add habit tools (list, log, create, update, delete)"
```

---

### Task 10: Notes tools (4 tools)

**Files:**
- Create: `mcp/src/tools/notes.ts`
- Create: `mcp/tests/tools/notes.test.ts`
- Modify: `mcp/src/index.ts`

**Handler specifics:**
- `handleListNotes`: query `notes` table. Filter by `kind`, `since` (created_at >= since). `search` param: use `.or(`title.ilike.%term%,body.ilike.%term%`)`. Order by `created_at desc`.
- `handleCreateNote`: required: `body`. Optional: `title`, `kind` (default 'napkin'), `note_date` (default today as `YYYY-MM-DD`).
- `handleUpdateNote`: resolve by `id` or `title`. Mutable: `title`, `body`, `kind`, `note_date`.
- `handleDeleteNote`: soft delete.

- [ ] **Step 1-7: Same pattern as above**

```bash
git commit -m "feat(mcp): add note tools (list, create, update, delete)"
```

---

## Chunk 4: Contacts + Interactions + Lists

### Task 11: Contacts tools (4 tools)

**Files:**
- Create: `mcp/src/tools/contacts.ts`
- Create: `mcp/tests/tools/contacts.test.ts`
- Modify: `mcp/src/index.ts`

**Handler specifics:**
- `handleListContacts`: query `contacts`. `search` param: `.or(`full_name.ilike.%term%,nickname.ilike.%term%,company.ilike.%term%`)`. `needs_followup`: use the `today_agenda` view filtered to `item_type = 'follow_up'` — it already computes which contacts are overdue. Alternatively, compute in the handler:

```typescript
// Key code: contacts needing follow-up
if (params.needs_followup) {
  // Use the today_agenda view which already handles the date arithmetic
  const { data } = await client
    .from('today_agenda')
    .select('*')
    .eq('user_id', USER_ID)
    .eq('item_type', 'follow_up');
  return { contacts: data };
}
```

- `handleCreateContact`: required: `full_name`. Optional: all other fields. `emails` and `phones` are `jsonb` columns — accept as arrays of strings, store directly as jsonb.
- `handleUpdateContact`: resolve by `id` or `full_name`.
- `handleDeleteContact`: soft delete.

- [ ] **Step 1-7: Same pattern**

```bash
git commit -m "feat(mcp): add contact tools (list, create, update, delete)"
```

---

### Task 12: Interactions tools (2 tools)

**Files:**
- Create: `mcp/src/tools/interactions.ts`
- Create: `mcp/tests/tools/interactions.test.ts`
- Modify: `mcp/src/index.ts`

**Handler specifics:**
- `handleListInteractions`: requires `contact` (resolved by name). Filter by `kind`, `since`. Order by `occurred_at desc`.
- `handleCreateInteraction`: resolve `contact` by name to `contact_id`. Required: `contact`, `kind`, `summary`. Optional: `occurred_at` (default now — DB has no default), `source` (default 'agent').

- [ ] **Step 1-7: Same pattern**

```bash
git commit -m "feat(mcp): add interaction tools (list, create)"
```

---

### Task 13: Lists tools (5 tools)

**Files:**
- Create: `mcp/src/tools/lists.ts`
- Create: `mcp/tests/tools/lists.test.ts`
- Modify: `mcp/src/index.ts`

**Handler specifics:**
- `handleListLists`: query `lists` table + count items per list (separate query or join). Return with `item_count` and `item_schema`.
- `handleCreateList`: required: `name`. Optional: `kind` (default 'custom'), `description`, `icon`, `item_schema` (default `[]`).
- `handleListItems`: resolve `list` by name. Query `list_items` where `list_id = resolved.id`. Filter by `status`. Order by `sort_order`.
- `handleCreateListItem`: resolve `list` by name. Fetch the list's `item_schema`. Validate `metadata` keys against schema (reject unknown keys, check types). Required: `list`, `title`. Optional: `metadata`, `status` (default 'open').
- `handleUpdateListItem`: resolve by `id` or by `title + list` (need both to disambiguate across lists). Mutable: `title`, `status`, `metadata`, `sort_order`.

**Metadata validation logic** (for `handleCreateListItem` and `handleUpdateListItem`):
```typescript
function validateMetadata(metadata: Record<string, unknown>, schema: Array<{ key: string; type: string }>) {
  const validKeys = new Set(schema.map(s => s.key));
  const unknownKeys = Object.keys(metadata).filter(k => !validKeys.has(k));
  if (unknownKeys.length > 0) {
    return { ok: false, error: 'validation_error', message: `Unknown metadata keys: ${unknownKeys.join(', ')}. Valid: ${[...validKeys].join(', ')}` };
  }
  // Type checking: schema types are 'text', 'number', 'boolean', 'date'
  for (const def of schema) {
    if (metadata[def.key] !== undefined) {
      const val = metadata[def.key];
      if (def.type === 'number' && typeof val !== 'number') {
        return { ok: false, error: 'validation_error', message: `${def.key} must be a number` };
      }
      if (def.type === 'boolean' && typeof val !== 'boolean') {
        return { ok: false, error: 'validation_error', message: `${def.key} must be a boolean` };
      }
    }
  }
  return { ok: true };
}
```

- [ ] **Step 1-7: Same pattern**

```bash
git commit -m "feat(mcp): add list tools (list_lists, create_list, list_items, create_item, update_item)"
```

---

## Chunk 5: Activities + Links + Views + Integration + Deploy

### Task 14: Activities tools (2 tools)

**Files:**
- Create: `mcp/src/tools/activities.ts`
- Create: `mcp/tests/tools/activities.test.ts`
- Modify: `mcp/src/index.ts`

**Handler specifics:**
- `handleListActivities`: query `activity_logs`. Filter by `type`, `since`. For gym activities, also fetch `workout_sets` where `activity_log_id` matches. Return as nested structure.
- `handleLogActivity`: required: `type`. Optional: `occurred_at` (default `new Date().toISOString()` — DB has NO default), `duration_min`, `note`, `details` (jsonb), `location` (resolved by name to `location_id`), `workout_sets` array.

**Workout sets logic:**
```typescript
// After inserting the activity_log row:
if (params.workout_sets?.length) {
  const warnings: string[] = [];
  const sets = [];
  for (const ws of params.workout_sets) {
    // Try to resolve exercise by name
    const exerciseResult = await resolveByName('exercises', 'name', ws.exercise);
    const exerciseId = exerciseResult.ok ? exerciseResult.row.id : null;
    if (!exerciseResult.ok) {
      warnings.push(`Exercise "${ws.exercise}" not in catalogue — logged without exercise_id.`);
    }
    sets.push({
      user_id: USER_ID,
      activity_log_id: activityRow.id,
      exercise_id: exerciseId,
      exercise: ws.exercise,
      set_number: ws.set_number,
      reps: ws.reps,
      weight_kg: ws.weight_kg,
      rpe: ws.rpe,
      note: ws.note,
    });
  }
  await client.from('workout_sets').insert(sets);
  return { ok: true, activity: activityRow, workout_sets: sets, warnings };
}
```

- [ ] **Step 1-7: Same pattern**

```bash
git commit -m "feat(mcp): add activity tools (list, log with workout sets)"
```

---

### Task 15: Links tools (2 tools)

**Files:**
- Create: `mcp/src/tools/links.ts`
- Create: `mcp/tests/tools/links.test.ts`
- Modify: `mcp/src/index.ts`

**Handler specifics:**
- `handleListLinks`: given `entity_type` and `entity_id` or `entity_name`, find all links where `(src_type = type AND src_id = id) OR (dst_type = type AND dst_id = id)`. For each linked entity, resolve its name by querying the target table. Return with resolved names.
- `handleCreateLink`: resolve both `src` and `dst` by name in their respective tables. The `src_type` and `dst_type` tell which table to query (e.g., `src_type='task'` → table `tasks`, name column `title`). Insert with `created_by = 'agent'`, `suggested = false`.

**Table-to-name-column mapping:**
```typescript
const entityConfig: Record<string, { table: string; nameCol: string }> = {
  task: { table: 'tasks', nameCol: 'title' },
  project: { table: 'projects', nameCol: 'name' },
  goal: { table: 'goals', nameCol: 'title' },
  habit: { table: 'habits', nameCol: 'name' },
  contact: { table: 'contacts', nameCol: 'full_name' },
  note: { table: 'notes', nameCol: 'title' },
  list: { table: 'lists', nameCol: 'name' },
  list_item: { table: 'list_items', nameCol: 'title' },
  event: { table: 'events', nameCol: 'title' },
  document: { table: 'documents', nameCol: 'title' },
  activity_log: { table: 'activity_logs', nameCol: 'note' },  // note is optional — prefer UUID for activity_logs
};
```

**Important:** `activity_log` uses `note` for name resolution, which is unreliable (many logs may have no note, or similar notes). The `create_link` tool description should advise using UUIDs for activity log references. Add to the tool description: "For activity_log entities, use the UUID — name resolution is unreliable."
```

- [ ] **Step 1-7: Same pattern**

```bash
git commit -m "feat(mcp): add link tools (list, create)"
```

---

### Task 16: Views / aggregate tools (5 tools)

**Files:**
- Create: `mcp/src/tools/views.ts`
- Create: `mcp/tests/tools/views.test.ts`
- Modify: `mcp/src/index.ts`

**Handler specifics:**

All view tools are read-only queries against existing Postgres views.

- `handleTodayAgenda`: query `today_agenda` view. Filter by `user_id`. Return as-is (already structured with `item_type`, `item_id`, `item_title`, `item_time`, `item_details`).

- `handleProjectProgress`: query `project_progress` view. Optional `project` filter (resolve by name, then filter by `project_id`). Columns: `project_id`, `name`, `project_status`, `area`, `total_tasks`, `done_tasks`, `pct_complete`, `blocked_count`, `overdue_count`.

- `handleAreaProgress`: query `area_progress` view (migration 003). Optional `area`, `horizon` filters. Columns: `area`, `horizon`, `goal_count`, `avg_pct`.

- `handleWeeklyReview`: query `weekly_review` view. Filter by `week` date: find the row where `week_start` matches `date_trunc('week', week_param)`. If no `week` param, use current week. Columns: `week_start`, `tasks_completed`, `habits_pct`, `activities_logged`, `interactions_had`, `notes_written`.

- `handleExercisesAvailable`: query `exercises_available` view. Optional `location` filter (resolve by name, then filter by `location_id`). Columns: `location_name`, `exercise_name`, `muscle_groups`, `required_equipment`.

- [ ] **Step 1: Write tests** (5 tests: one per view tool)
- [ ] **Step 2: Run tests — expect fail**
- [ ] **Step 3: Implement views.ts**
- [ ] **Step 4: Run tests — expect pass**
- [ ] **Step 5: Register in index.ts**
- [ ] **Step 6: Compile check**
- [ ] **Step 7: Commit**

```bash
git commit -m "feat(mcp): add view tools (today_agenda, project_progress, area_progress, weekly_review, exercises_available)"
```

---

### Task 17: Final index.ts integration + build

**Files:**
- Modify: `mcp/src/index.ts` — verify all 11 tool files are imported and registered

- [ ] **Step 1: Verify index.ts has all imports**

Final `index.ts` should have:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import './supabase.js';

import { registerTaskTools } from './tools/tasks.js';
import { registerProjectTools } from './tools/projects.js';
import { registerGoalTools } from './tools/goals.js';
import { registerHabitTools } from './tools/habits.js';
import { registerNoteTools } from './tools/notes.js';
import { registerContactTools } from './tools/contacts.js';
import { registerInteractionTools } from './tools/interactions.js';
import { registerListTools } from './tools/lists.js';
import { registerActivityTools } from './tools/activities.js';
import { registerLinkTools } from './tools/links.js';
import { registerViewTools } from './tools/views.js';

const server = new McpServer({
  name: 'lifeos',
  version: '0.1.0',
});

registerTaskTools(server);
registerProjectTools(server);
registerGoalTools(server);
registerHabitTools(server);
registerNoteTools(server);
registerContactTools(server);
registerInteractionTools(server);
registerListTools(server);
registerActivityTools(server);
registerLinkTools(server);
registerViewTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('LifeOS MCP server running on stdio');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run all tests**

Run: `cd C:\dev\LifeOS\mcp && npx vitest run`
Expected: all tests pass

- [ ] **Step 3: Build**

Run: `cd C:\dev\LifeOS\mcp && npm run build`
Expected: `dist/` directory created with compiled JS

- [ ] **Step 4: Smoke test locally**

Create a temporary `.env` in `mcp/` with real Supabase credentials (from 1Password). Then:

On Windows (bash shell):
Run: `cd C:\dev\LifeOS\mcp && echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"}" | node dist/index.js`
Expected: JSON response listing all 42 tools

- [ ] **Step 5: Commit**

```bash
cd C:\dev\LifeOS
git add mcp/src/index.ts
git commit -m "feat(mcp): wire all 42 tools into MCP server, build passes"
```

---

### Task 18: Deploy to Hetzner + register with Hermes

**Files:**
- Modify: `~/hermes/docker-compose.yml` on VPS (add volume mount)
- No local code changes — deployment operations only

**Important context:** Hermes runs inside a Docker container (`nousresearch/hermes-agent:latest`). The MCP server must be accessible from inside the container, and Node.js must be available there. We use a bind mount to make the host directory visible inside the container.

- [ ] **Step 1: Check if Node.js is available inside the Hermes container**

```bash
ssh root@204.168.139.178 "docker exec hermes which node || docker exec hermes node --version"
```

If Node.js is NOT available inside the container, install it:
```bash
ssh root@204.168.139.178 "docker exec hermes bash -c 'apt-get update && apt-get install -y nodejs npm'"
```

If apt is not available (Alpine-based image), use:
```bash
ssh root@204.168.139.178 "docker exec hermes bash -c 'apk add nodejs npm'"
```

Note: This survives restarts but is LOST on container recreation. If Node.js needs to persist, build a custom Dockerfile. Document in `~/hermes/README.md`.

- [ ] **Step 2: SSH to Hetzner and create directory + copy files**

```bash
ssh root@204.168.139.178 "mkdir -p /opt/lifeos-mcp"
```

```bash
cd C:\dev\LifeOS\mcp
npm run build
rsync -avz --exclude node_modules --exclude .env --exclude tests dist package.json package-lock.json root@204.168.139.178:/opt/lifeos-mcp/
```

Note: `dist` without trailing slash preserves the directory structure, so files end up at `/opt/lifeos-mcp/dist/index.js`.

- [ ] **Step 3: Install production deps on VPS**

```bash
ssh root@204.168.139.178 "cd /opt/lifeos-mcp && npm install --production"
```

- [ ] **Step 4: Create .env on VPS**

```bash
ssh root@204.168.139.178
cat > /opt/lifeos-mcp/.env << 'EOF'
SUPABASE_URL=https://nhqxhntueexrzpyldvee.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from 1Password>
LIFEOS_USER_ID=633325fe-9ccd-4e75-a1e7-0df043b70e5a
LIFEOS_ACTOR=hermes
EOF
chmod 600 /opt/lifeos-mcp/.env
```

Note: Get `SUPABASE_SERVICE_ROLE_KEY` from 1Password. The user ID is from the project memory.

- [ ] **Step 5: Add volume mount to docker-compose.yml**

Edit `~/hermes/docker-compose.yml` to add the bind mount:

```yaml
volumes:
  - hermes-data:/opt/data
  - /opt/lifeos-mcp:/opt/lifeos-mcp:ro  # LifeOS MCP server (read-only)
```

The `.env` file is inside the mounted directory, so it's accessible from within the container.

- [ ] **Step 6: Restart the Hermes container**

```bash
ssh root@204.168.139.178 "cd ~/hermes && docker compose down && docker compose up -d"
```

- [ ] **Step 7: Re-apply the codex.py patch if needed**

The Hermes container was rebuilt — check if the `reasoning.effort` patch at `/opt/hermes/agent/transports/codex.py` needs re-applying. See `~/hermes/README.md` for instructions.

- [ ] **Step 8: Test MCP server inside the container**

```bash
ssh root@204.168.139.178 "docker exec hermes bash -c 'cd /opt/lifeos-mcp && echo \"{\\\"jsonrpc\\\":\\\"2.0\\\",\\\"id\\\":1,\\\"method\\\":\\\"tools/list\\\"}\" | node dist/index.js'"
```
Expected: JSON listing 42 tools

- [ ] **Step 9: Register with Hermes**

```bash
ssh root@204.168.139.178 "docker exec hermes hermes mcp add lifeos --command 'node /opt/lifeos-mcp/dist/index.js'"
```

Note: Check `~/hermes/README.md` for the exact Hermes MCP CLI syntax. The `--command` flag may need the full path.

- [ ] **Step 10: Test via Telegram**

Send Hermes a message: "What's on my agenda today?"
Expected: Hermes uses the `today_agenda` tool and returns results from LifeOS.

- [ ] **Step 11: Update deployment docs**

Update `~/hermes/README.md` on the VPS with the LifeOS MCP setup instructions:
- Volume mount added to docker-compose.yml
- Node.js installation step (if needed)
- How to update the MCP server (rsync + restart)
- How to verify it works

---

### Task 19: Configure Claude Desktop + Claude Code

**Files:**
- Modify: `%APPDATA%\Claude\claude_desktop_config.json` (Claude Desktop)
- Modify: `C:\dev\LifeOS\.claude\settings.json` or run `claude mcp add` (Claude Code)

- [ ] **Step 1: Build locally if not already done**

Run: `cd C:\dev\LifeOS\mcp && npm run build`

- [ ] **Step 2: Create local .env**

Create `C:\dev\LifeOS\mcp\.env`:
```
SUPABASE_URL=https://nhqxhntueexrzpyldvee.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<from 1Password>
LIFEOS_USER_ID=633325fe-9ccd-4e75-a1e7-0df043b70e5a
LIFEOS_ACTOR=claude_desktop
```

- [ ] **Step 3: Add to Claude Desktop config**

Add to `%APPDATA%\Claude\claude_desktop_config.json` under `mcpServers`:
```json
{
  "lifeos": {
    "command": "node",
    "args": ["C:\\dev\\LifeOS\\mcp\\dist\\index.js"],
    "env": {
      "LIFEOS_ACTOR": "claude_desktop"
    }
  }
}
```

- [ ] **Step 4: Add to Claude Code**

Run: `claude mcp add lifeos -- node C:\dev\LifeOS\mcp\dist\index.js`

Or add to project settings with `LIFEOS_ACTOR=claude_code`.

- [ ] **Step 5: Test Claude Desktop**

Open Claude Desktop, ask: "List my LifeOS projects"
Expected: Uses `list_projects` tool, returns project data

- [ ] **Step 6: Test Claude Code**

In a Claude Code session: ask to list tasks
Expected: Uses `list_tasks` tool
