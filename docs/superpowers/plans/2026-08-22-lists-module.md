# Lists Module Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Lists module — pinned lists with per-list custom fields in a nav dropdown, plus ad-hoc lists that are created by an agent, ticked off, and archived.

**Architecture:** One `lists` table serves both classes, distinguished by a `pinned` flag. Each list's `item_schema` (jsonb) defines its custom fields; values live in `list_items.metadata`. A single pure module owns the schema vocabulary — validation, select-option derivation, and the mapping from schema fields to the existing FlyoutPanel field config — so the web app and the MCP server enforce identical rules.

**Tech Stack:** Next.js 16 (App Router), React 19, TanStack Query, supabase-js, Tailwind v4, Lucide, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-lists-module-design.md`

---

## Before you start

**Read these first:**
- The spec above, in full.
- `src/services/projects.ts` and `src/hooks/use-projects.ts` — the service/hook pattern every data task copies.
- `src/components/app/FlyoutPanel.tsx` — specifically the `FieldConfig` type at the top.
- `src/components/app/DataTable.tsx` — the `Column<T>` type at the top.

**Two corrections to the spec, discovered while planning. The plan is right; the spec is stale.**

1. **§5.4 says the flyout needs the `children` prop being added on `feat/habits-page`. It does not.** `FieldConfig` already supports `text | textarea | select | date | number`, which covers every schema type we need. Lists therefore has **no dependency on the habits branch at all** — do not wait for it, and do not modify `FlyoutPanel.tsx`.
2. **§5.4 lists a "Linked items" block. It is out of scope.** Promote-to-project is v2 (spec §5.6), so there is nothing to link yet. Omitting it is what keeps `FlyoutPanel` untouched.

**Migration number is 008.** Verified: `main` holds 001–005 and 007. `006_habits_area.sql` exists only on `feat/habits-page`, so 008 is free on both branches and will not collide on merge.

**Testing policy.** The web app has no test infrastructure today and no jsdom/RTL. This plan adds Vitest for **pure modules only** — matching the decision made on the habits branch. UI tasks have no automated tests; they end with a manual checklist (Task 13). Do not add component tests.

---

## File Structure

**Create:**
| Path | Responsibility |
|---|---|
| `supabase/migrations/008_lists_pinned_notes.sql` | `lists.pinned`, `lists.pin_order`, `list_items.notes`, and the four seeded pinned lists |
| `vitest.config.ts` | Root test runner for pure modules (see Task 2 — may already exist) |
| `src/lib/list-schema.ts` | **The one source of truth for the schema vocabulary.** Types, validation, select-option derivation, FieldConfig mapping, value coercion |
| `src/lib/list-schema.test.ts` | Unit tests for the above |
| `src/services/lists.ts` | Supabase reads/writes for lists and list items |
| `src/hooks/use-lists.ts` | TanStack Query wrappers |
| `src/components/app/NavDropdown.tsx` | Reusable hover/focus dropdown — the app's first |
| `src/components/app/ListIcon.tsx` | Maps a `lists.icon` string to a Lucide component |
| `src/components/app/ListItemFlyout.tsx` | Wraps FlyoutPanel; flattens metadata in, coerces out |
| `src/app/(app)/lists/page.tsx` | All lists — pinned / ad-hoc / archived |
| `src/app/(app)/lists/[id]/page.tsx` | One list |

**Modify:**
| Path | Change |
|---|---|
| `src/components/app/AppNav.tsx:5-13,44-47` | Add the Lists entry with its dropdown |
| `package.json` | Add the `test` script |
| `mcp/src/tools/lists.ts:25-53` | Teach `validateMetadata` the new vocabulary |
| `mcp/tests/tools/lists.test.ts` | Tests for the above |

**Do NOT touch:** `src/components/app/FlyoutPanel.tsx`, `src/components/app/DataTable.tsx`, `C:\dev\LifeOS-mcp` (the live server).

---

## Chunk 1: Foundation

### Task 1: Migration

**Files:**
- Create: `supabase/migrations/008_lists_pinned_notes.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 008: Lists module — pinned lists, per-item notes, and the four seeded pinned lists.

alter table lists      add column pinned    boolean not null default false;
alter table lists      add column pin_order integer;
alter table list_items add column notes     text;

comment on column lists.pinned is
  'Pinned lists appear in the Lists nav dropdown, ordered by pin_order. Everything else lives under "All lists".';
comment on column lists.pin_order is
  'Position among pinned lists, ascending. Nulls sort last.';
comment on column list_items.notes is
  'Freeform user prose. Deliberately a real column, not an item_schema field, so it is never schema-validated.';

-- Pinned lists ship seeded. There is no schema editor in v1 (spec §4.2);
-- new pinned lists are created by an agent via update_list, or by a later migration.
-- Icons are Lucide component names, not emoji (spec §5.5).
```

- [ ] **Step 2: Append the seed data**

Replace `<USER_ID>` with the real user id `633325fe-9ccd-4e75-a1e7-0df043b70e5a` before applying.

```sql
insert into lists (user_id, name, kind, icon, pinned, pin_order, description, item_schema) values
('<USER_ID>', 'Books', 'books', 'BookOpen', true, 1,
 'Reading list — what to read next, and what I made of it.',
 '[
   {"key":"author","label":"Author","type":"text","table":true},
   {"key":"reading_status","label":"Status","type":"select","table":true,"strict":true,
    "options":["to read","reading","finished","abandoned"]},
   {"key":"summary","label":"Summary","type":"text","multiline":true,
    "description":"Spoiler-free, 2-3 sentences. Never reveal plot turns or endings."},
   {"key":"form","label":"Form","type":"select","strict":true,"options":["Fiction","Non-fiction"]},
   {"key":"genre","label":"Genre","type":"select"},
   {"key":"recommended_by","label":"Recommended by","type":"text"},
   {"key":"rating","label":"Rating","type":"number"},
   {"key":"url","label":"Link","type":"url"}
 ]'::jsonb),

('<USER_ID>', 'TV & Movies', 'movies', 'Clapperboard', true, 2,
 'One queue for films and series.',
 '[
   {"key":"format","label":"Format","type":"select","table":true,"strict":true,
    "options":["Film","Series"]},
   {"key":"where_to_watch","label":"Where","type":"select","table":true},
   {"key":"summary","label":"Premise","type":"text","multiline":true,
    "description":"Spoiler-free premise. Never reveal plot turns or endings."},
   {"key":"director","label":"Director","type":"text"},
   {"key":"year","label":"Year","type":"number"},
   {"key":"genre","label":"Genre","type":"select"},
   {"key":"recommended_by","label":"Recommended by","type":"text"},
   {"key":"url","label":"Link","type":"url"}
 ]'::jsonb),

('<USER_ID>', 'Wishlist', 'custom', 'ShoppingBag', true, 3,
 'Considered purchases — things worth buying eventually, reviewed when browsing.',
 '[
   {"key":"buy_from","label":"Buy from","type":"select","table":true},
   {"key":"price","label":"Price","type":"number","table":true},
   {"key":"url","label":"Link","type":"url"},
   {"key":"priority","label":"Priority","type":"select","strict":true,
    "options":["now","soon","someday"]},
   {"key":"category","label":"Category","type":"select"}
 ]'::jsonb),

('<USER_ID>', 'Business ideas', 'custom', 'Lightbulb', true, 4,
 'Idea capture. Committing to one means creating a project by hand (v2 automates it).',
 '[
   {"key":"one_liner","label":"One-liner","type":"text","table":true},
   {"key":"conviction","label":"Conviction","type":"number","table":true},
   {"key":"category","label":"Category","type":"text"},
   {"key":"next_step","label":"Next step","type":"text"}
 ]'::jsonb);
```

- [ ] **Step 3: Apply it**

Apply via the Supabase SQL Editor (project `nhqxhntueexrzpyldvee`), matching how 005 was applied.

**Note:** the list `Books to read` already exists from the 22 Aug MCP write test and is NOT one of the four above. After applying, either archive it or merge its one item into `Books` — a data decision for Axel, not something this plan should guess at.

- [ ] **Step 4: Verify**

Run in the SQL Editor:
```sql
select name, pinned, pin_order, icon, jsonb_array_length(item_schema) as fields
from lists where archived_at is null order by pin_order nulls last;
```
Expected: four rows, `pinned = true`, `pin_order` 1–4, field counts 8, 8, 5, 4.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/008_lists_pinned_notes.sql
git commit -m "feat(db): 008 — lists.pinned, list_items.notes, seed four pinned lists"
```

---

### Task 2: Test infrastructure for pure modules

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Check whether it already exists**

Run: `ls vitest.config.ts`

The habits branch needs the same infrastructure for `habit-stats.ts`. **If the file already exists** (habits merged first), skip to Step 4 and only confirm the `test` script is present. Do not overwrite it.

- [ ] **Step 2: Create the config**

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Pure modules only — no jsdom, no component tests.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

- [ ] **Step 3: Add the test script**

In `package.json`, add to `scripts`:
```json
"test": "vitest run"
```

- [ ] **Step 4: Install and verify**

Run: `npm install -D vitest && npx vitest run --passWithNoTests`
Expected: exits 0, "No test files found" is fine at this stage.

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts package.json package-lock.json
git commit -m "chore: add vitest for pure modules"
```

---

### Task 3: Schema types and `validateMetadata`

This module is the heart of the feature. Everything else consumes it.

**Files:**
- Create: `src/lib/list-schema.ts`
- Test: `src/lib/list-schema.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { validateMetadata, type ItemFieldDef } from "./list-schema";

const BOOKS: ItemFieldDef[] = [
  { key: "author", label: "Author", type: "text" },
  { key: "rating", label: "Rating", type: "number" },
  { key: "url", label: "Link", type: "url" },
  { key: "genre", label: "Genre", type: "select" },
  { key: "form", label: "Form", type: "select", strict: true, options: ["Fiction", "Non-fiction"] },
];

describe("validateMetadata", () => {
  it("accepts metadata conforming to the schema", () => {
    expect(validateMetadata({ author: "Deutsch", rating: 4.2 }, BOOKS)).toEqual({ ok: true });
  });

  it("rejects a key that is not in the schema, and names the valid keys", () => {
    const result = validateMetadata({ publisher: "Penguin" }, BOOKS);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("publisher");
    expect(result.ok === false && result.message).toContain("author");
  });

  it("rejects a number field given a string", () => {
    const result = validateMetadata({ rating: "4.2" }, BOOKS);
    expect(result.ok === false && result.message).toBe("Rating must be a number");
  });

  it("treats url as a string", () => {
    expect(validateMetadata({ url: "https://example.com" }, BOOKS)).toEqual({ ok: true });
    expect(validateMetadata({ url: 42 }, BOOKS).ok).toBe(false);
  });

  it("accepts any string for an open select", () => {
    expect(validateMetadata({ genre: "Cli-fi" }, BOOKS)).toEqual({ ok: true });
  });

  it("rejects a value outside the options of a strict select", () => {
    const result = validateMetadata({ form: "Fim" }, BOOKS);
    expect(result.ok === false && result.message).toContain("Fiction");
  });

  it("accepts a listed value for a strict select", () => {
    expect(validateMetadata({ form: "Fiction" }, BOOKS)).toEqual({ ok: true });
  });

  it("ignores null and undefined values", () => {
    expect(validateMetadata({ rating: null, author: undefined }, BOOKS)).toEqual({ ok: true });
  });

  it("rejects every key when the schema is empty, and says so plainly", () => {
    const result = validateMetadata({ anything: "x" }, []);
    expect(result.ok === false && result.message).toContain("no custom fields");
  });

  it("accepts empty metadata against an empty schema", () => {
    expect(validateMetadata({}, [])).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lib/list-schema.test.ts`
Expected: FAIL — cannot resolve `./list-schema`.

- [ ] **Step 3: Implement**

```typescript
/**
 * The single source of truth for the list item_schema vocabulary.
 *
 * The MCP server enforces the same rules in mcp/src/tools/lists.ts. There is no
 * database constraint behind either, so if these two ever diverge, agents and the
 * web app will accept different data. Change both together.
 */

export type FieldType = "text" | "number" | "boolean" | "date" | "select" | "url";

export type ItemFieldDef = {
  key: string;
  label?: string;
  type: FieldType;
  /** Renders as a table column. Everything else is flyout-only. */
  table?: boolean;
  /** Renders as a paragraph block rather than an inline row. */
  multiline?: boolean;
  /** Closed option set — only `options` are accepted. */
  strict?: boolean;
  options?: string[];
  /** Guidance for whoever fills this in, human or agent. */
  description?: string;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; message: string };

function labelOf(def: ItemFieldDef): string {
  return def.label ?? def.key;
}

export function validateMetadata(
  metadata: Record<string, unknown>,
  schema: ItemFieldDef[],
): ValidationResult {
  const byKey = new Map(schema.map((d) => [d.key, d]));

  const unknown = Object.keys(metadata).filter((k) => !byKey.has(k));
  if (unknown.length > 0) {
    const valid = schema.map((d) => d.key).join(", ");
    return {
      ok: false,
      message: `Unknown field${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. ${
        valid ? `This list accepts: ${valid}.` : "This list has no custom fields."
      }`,
    };
  }

  for (const def of schema) {
    const value = metadata[def.key];
    if (value === undefined || value === null) continue;

    switch (def.type) {
      case "number":
        if (typeof value !== "number") {
          return { ok: false, message: `${labelOf(def)} must be a number` };
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") {
          return { ok: false, message: `${labelOf(def)} must be true or false` };
        }
        break;
      case "text":
      case "date":
      case "url":
      case "select":
        if (typeof value !== "string") {
          return { ok: false, message: `${labelOf(def)} must be text` };
        }
        break;
    }

    // A strict select is the only closed set. Open selects accept anything —
    // that is what lets a new value become a suggestion without configuration.
    if (def.type === "select" && def.strict) {
      const options = def.options ?? [];
      if (!options.includes(value as string)) {
        return {
          ok: false,
          message: `${labelOf(def)} must be one of: ${options.join(", ")}`,
        };
      }
    }
  }

  return { ok: true };
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/lib/list-schema.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/list-schema.ts src/lib/list-schema.test.ts
git commit -m "feat(lists): shared item_schema validation"
```

---

### Task 4: Select options are derived, never configured

The dropdown for a select field is its seeded `options` plus every value already used on that list. This is what makes "type a new store once and it's there forever" work with no options editor.

**Files:**
- Modify: `src/lib/list-schema.ts`
- Test: `src/lib/list-schema.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to the test file:

```typescript
import { selectOptions } from "./list-schema";

describe("selectOptions", () => {
  const field: ItemFieldDef = { key: "buy_from", type: "select", options: ["Amazon.es", "Worten"] };
  const items = [
    { metadata: { buy_from: "Decathlon" } },
    { metadata: { buy_from: "Amazon.es" } },
    { metadata: { buy_from: "Leroy Merlin" } },
    { metadata: {} },
  ];

  it("puts seeded options first, then values already in use", () => {
    expect(selectOptions(field, items)).toEqual([
      { value: "Amazon.es", label: "Amazon.es", seeded: true },
      { value: "Worten", label: "Worten", seeded: true },
      { value: "Decathlon", label: "Decathlon", seeded: false },
      { value: "Leroy Merlin", label: "Leroy Merlin", seeded: false },
    ]);
  });

  it("never lists a value twice", () => {
    const values = selectOptions(field, items).map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("returns only the seeded options for a strict field, ignoring stray values", () => {
    const strict: ItemFieldDef = { key: "format", type: "select", strict: true, options: ["Film", "Series"] };
    const stray = [{ metadata: { format: "Fim" } }];
    expect(selectOptions(strict, stray).map((o) => o.value)).toEqual(["Film", "Series"]);
  });

  it("ignores non-string values in use", () => {
    expect(selectOptions(field, [{ metadata: { buy_from: 42 } }]).map((o) => o.value))
      .toEqual(["Amazon.es", "Worten"]);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lib/list-schema.test.ts`
Expected: FAIL — `selectOptions is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/list-schema.ts`:

```typescript
export type SelectOption = { value: string; label: string; seeded: boolean };

/**
 * The options offered for a select field: its seeded options, then every distinct
 * value already used on this list. Using a value once makes it a permanent
 * suggestion — nothing is written back to item_schema, and there is no editor.
 *
 * A strict field ignores values in use, so a typo never becomes a suggestion.
 */
export function selectOptions(
  field: ItemFieldDef,
  items: Array<{ metadata?: Record<string, unknown> | null }>,
): SelectOption[] {
  const seeded = field.options ?? [];
  const out: SelectOption[] = seeded.map((value) => ({ value, label: value, seeded: true }));
  if (field.strict) return out;

  const seen = new Set(seeded);
  for (const item of items) {
    const value = item.metadata?.[field.key];
    if (typeof value !== "string" || value === "" || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label: value, seeded: false });
  }
  return out;
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/lib/list-schema.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/list-schema.ts src/lib/list-schema.test.ts
git commit -m "feat(lists): derive select options from seeds plus values in use"
```

---

### Task 5: Mapping schema fields onto FlyoutPanel and back

`FlyoutPanel` takes a flat `data` object and calls `onSave(field, value: string)` — always a string. List metadata is nested and typed. This task owns both directions of that translation. Get it wrong and numbers silently become strings in the database.

**Files:**
- Modify: `src/lib/list-schema.ts`
- Test: `src/lib/list-schema.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { toFieldConfigs, flattenItem, coerceValue } from "./list-schema";

describe("toFieldConfigs", () => {
  it("maps a multiline text field to a textarea", () => {
    const [config] = toFieldConfigs([{ key: "summary", label: "Summary", type: "text", multiline: true }], []);
    expect(config).toMatchObject({ key: "summary", label: "Summary", type: "textarea" });
  });

  it("maps a plain text field to text, inline", () => {
    const [config] = toFieldConfigs([{ key: "author", label: "Author", type: "text" }], []);
    expect(config).toMatchObject({ type: "text", inline: true });
  });

  it("maps url to text, because FlyoutPanel has no url type", () => {
    const [config] = toFieldConfigs([{ key: "url", label: "Link", type: "url" }], []);
    expect(config.type).toBe("text");
  });

  it("maps a select and carries its derived options", () => {
    const [config] = toFieldConfigs(
      [{ key: "buy_from", label: "Buy from", type: "select", options: ["Amazon.es"] }],
      [{ metadata: { buy_from: "Worten" } }],
    );
    expect(config.type).toBe("select");
    expect(config.options).toEqual([
      { value: "Amazon.es", label: "Amazon.es" },
      { value: "Worten", label: "Worten" },
    ]);
  });

  it("maps boolean to a yes/no select, since FlyoutPanel has no boolean", () => {
    const [config] = toFieldConfigs([{ key: "signed", label: "Signed", type: "boolean" }], []);
    expect(config.type).toBe("select");
    expect(config.options).toEqual([
      { value: "true", label: "Yes" },
      { value: "false", label: "No" },
    ]);
  });

  it("falls back to the key when a field has no label", () => {
    const [config] = toFieldConfigs([{ key: "one_liner", type: "text" }], []);
    expect(config.label).toBe("one_liner");
  });
});

describe("flattenItem", () => {
  it("lifts metadata to the top level alongside core fields", () => {
    const flat = flattenItem({ id: "1", title: "Chip War", notes: "n", metadata: { author: "Miller" } });
    expect(flat).toMatchObject({ title: "Chip War", notes: "n", author: "Miller" });
  });

  it("survives null metadata", () => {
    expect(flattenItem({ id: "1", title: "x", metadata: null }).title).toBe("x");
  });

  it("does not let a metadata key overwrite a core column", () => {
    const flat = flattenItem({ id: "1", title: "real", metadata: { title: "fake" } });
    expect(flat.title).toBe("real");
  });
});

describe("coerceValue", () => {
  it("turns the string from the flyout back into a number", () => {
    expect(coerceValue("4.2", { key: "rating", type: "number" })).toBe(4.2);
  });

  it("turns an empty string into null so the key clears", () => {
    expect(coerceValue("", { key: "rating", type: "number" })).toBeNull();
    expect(coerceValue("", { key: "author", type: "text" })).toBeNull();
  });

  it("rejects a number field that did not parse", () => {
    expect(() => coerceValue("abc", { key: "rating", type: "number" })).toThrow(/must be a number/);
  });

  it("turns the yes/no select back into a boolean", () => {
    expect(coerceValue("true", { key: "signed", type: "boolean" })).toBe(true);
    expect(coerceValue("false", { key: "signed", type: "boolean" })).toBe(false);
  });

  it("leaves text, select and url as strings", () => {
    expect(coerceValue("Deutsch", { key: "author", type: "text" })).toBe("Deutsch");
  });
});
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/lib/list-schema.test.ts`
Expected: FAIL — `toFieldConfigs is not a function`.

- [ ] **Step 3: Implement**

Append to `src/lib/list-schema.ts`:

```typescript
import type { FieldConfig } from "@/components/app/FlyoutPanel";

/**
 * Translates item_schema field definitions into FlyoutPanel's FieldConfig.
 *
 * FlyoutPanel has no url or boolean type, so url renders as text and boolean as a
 * yes/no select. Multiline text becomes a textarea and drops out of the inline
 * metadata row, so summaries render as a paragraph block.
 */
export function toFieldConfigs(
  schema: ItemFieldDef[],
  items: Array<{ metadata?: Record<string, unknown> | null }>,
): FieldConfig[] {
  return schema.map((def) => {
    const base = { key: def.key, label: def.label ?? def.key, placeholder: def.description };

    switch (def.type) {
      case "number":
        return { ...base, type: "number", inline: true };
      case "date":
        return { ...base, type: "date", inline: true };
      case "boolean":
        return {
          ...base,
          type: "select",
          inline: true,
          options: [
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ],
        };
      case "select":
        return {
          ...base,
          type: "select",
          inline: true,
          options: selectOptions(def, items).map(({ value, label }) => ({ value, label })),
        };
      case "text":
      case "url":
      default:
        return def.multiline
          ? { ...base, type: "textarea" }
          : { ...base, type: "text", inline: true };
    }
  });
}

/** Core columns win over metadata keys — a metadata `title` must not shadow the real one. */
export function flattenItem(item: {
  metadata?: Record<string, unknown> | null;
  [key: string]: unknown;
}): Record<string, any> {
  const { metadata, ...core } = item;
  return { ...(metadata ?? {}), ...core };
}

/** FlyoutPanel always hands back a string. Put it back in the shape the schema wants. */
export function coerceValue(raw: string, def: ItemFieldDef): unknown {
  if (raw === "") return null;

  switch (def.type) {
    case "number": {
      const parsed = Number(raw);
      if (Number.isNaN(parsed)) {
        throw new Error(`${def.label ?? def.key} must be a number`);
      }
      return parsed;
    }
    case "boolean":
      return raw === "true";
    default:
      return raw;
  }
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run src/lib/list-schema.test.ts`
Expected: PASS, 28 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/list-schema.ts src/lib/list-schema.test.ts
git commit -m "feat(lists): map item_schema to FlyoutPanel fields and back"
```

---

## Chunk 2: Data layer

### Task 6: Services

No tests — these are thin Supabase wrappers with no logic worth asserting, matching `services/projects.ts`. The logic lives in `list-schema.ts`, which is tested.

**Files:**
- Create: `src/services/lists.ts`

- [ ] **Step 1: Write it**

```typescript
import { createClient } from "@/lib/supabase-client";
import { validateMetadata, type ItemFieldDef } from "@/lib/list-schema";

export type List = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  notes: string | null;
  kind: string;
  icon: string | null;
  pinned: boolean;
  pin_order: number | null;
  item_schema: ItemFieldDef[];
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

export type ListItem = {
  id: string;
  user_id: string;
  list_id: string;
  title: string;
  status: "open" | "done";
  notes: string | null;
  metadata: Record<string, unknown>;
  sort_order: number | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

/** item_schema is jsonb and may be null or malformed on hand-edited rows. */
function normalise(row: any): List {
  return { ...row, item_schema: Array.isArray(row.item_schema) ? row.item_schema : [] };
}

export async function getLists(opts?: { includeArchived?: boolean }): Promise<List[]> {
  const supabase = createClient();
  let query = supabase.from("lists").select("*");
  if (!opts?.includeArchived) query = query.is("archived_at", null);

  const { data, error } = await query
    .order("pin_order", { ascending: true, nullsFirst: false })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(normalise);
}

export async function getList(id: string): Promise<List> {
  const supabase = createClient();
  const { data, error } = await supabase.from("lists").select("*").eq("id", id).single();
  if (error) throw error;
  return normalise(data);
}

export async function createList(data: Partial<List> & { name: string }): Promise<List> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { data: created, error } = await supabase
    .from("lists")
    .insert({ kind: "custom", item_schema: [], pinned: false, ...data, user_id: user.id })
    .select()
    .single();
  if (error) throw error;
  return normalise(created);
}

export async function updateList(id: string, data: Partial<List>): Promise<List> {
  const supabase = createClient();
  const { data: updated, error } = await supabase
    .from("lists").update(data).eq("id", id).select().single();
  if (error) throw error;
  return normalise(updated);
}

export async function archiveList(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("lists")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function getListItems(listId: string): Promise<ListItem[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("list_items")
    .select("*")
    .eq("list_id", listId)
    .is("archived_at", null)
    .order("sort_order", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data ?? []).map((row: any) => ({ ...row, metadata: row.metadata ?? {} }));
}

export async function createListItem(
  listId: string,
  title: string,
  schema: ItemFieldDef[],
  metadata: Record<string, unknown> = {},
): Promise<ListItem> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const check = validateMetadata(metadata, schema);
  if (!check.ok) throw new Error(check.message);

  // Match the MCP and the rest of the app: new items land at the bottom.
  const { data: maxRow } = await supabase
    .from("list_items")
    .select("sort_order")
    .eq("list_id", listId)
    .is("archived_at", null)
    .order("sort_order", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  const { data: created, error } = await supabase
    .from("list_items")
    .insert({
      list_id: listId,
      title,
      metadata,
      user_id: user.id,
      sort_order: (maxRow?.sort_order ?? 0) + 1,
    })
    .select()
    .single();
  if (error) throw error;
  return { ...created, metadata: created.metadata ?? {} };
}

export async function updateListItem(
  id: string,
  data: Partial<ListItem>,
  schema: ItemFieldDef[],
): Promise<ListItem> {
  const supabase = createClient();

  if (data.metadata) {
    const check = validateMetadata(data.metadata, schema);
    if (!check.ok) throw new Error(check.message);
  }

  const { data: updated, error } = await supabase
    .from("list_items").update(data).eq("id", id).select().single();
  if (error) throw error;
  return { ...updated, metadata: updated.metadata ?? {} };
}

export async function deleteListItem(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("list_items")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/lists.ts
git commit -m "feat(lists): supabase services"
```

---

### Task 7: Hooks

**Files:**
- Create: `src/hooks/use-lists.ts`

- [ ] **Step 1: Write it**

```typescript
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getLists, getList, createList, updateList, archiveList,
  getListItems, createListItem, updateListItem, deleteListItem,
  type List, type ListItem,
} from "@/services/lists";
import type { ItemFieldDef } from "@/lib/list-schema";

export function useLists(opts?: { includeArchived?: boolean }) {
  return useQuery({ queryKey: ["lists", opts], queryFn: () => getLists(opts) });
}

export function useList(id: string) {
  return useQuery({ queryKey: ["lists", id], queryFn: () => getList(id), enabled: !!id });
}

export function useListItems(listId: string) {
  return useQuery({
    queryKey: ["list-items", listId],
    queryFn: () => getListItems(listId),
    enabled: !!listId,
  });
}

export function useCreateList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createList,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists"] }),
  });
}

export function useUpdateList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<List> }) => updateList(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists"] }),
  });
}

export function useArchiveList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: archiveList,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["lists"] }),
  });
}

export function useCreateListItem(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ title, schema, metadata }: {
      title: string; schema: ItemFieldDef[]; metadata?: Record<string, unknown>;
    }) => createListItem(listId, title, schema, metadata),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["list-items", listId] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useUpdateListItem(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data, schema }: {
      id: string; data: Partial<ListItem>; schema: ItemFieldDef[];
    }) => updateListItem(id, data, schema),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["list-items", listId] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}

export function useDeleteListItem(listId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteListItem,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["list-items", listId] });
      qc.invalidateQueries({ queryKey: ["lists"] });
    },
  });
}
```

**Why `["lists"]` is invalidated on item mutations:** the nav dropdown shows open-item counts per list, so adding or ticking an item changes what the nav displays.

- [ ] **Step 2: Typecheck and commit**

Run: `npx tsc --noEmit`

```bash
git add src/hooks/use-lists.ts
git commit -m "feat(lists): query hooks"
```

---

## Chunk 3: Navigation and the all-lists page

### Task 8: ListIcon

**Files:**
- Create: `src/components/app/ListIcon.tsx`

- [ ] **Step 1: Write it**

```typescript
"use client";

import {
  BookOpen, Clapperboard, ShoppingBag, Lightbulb, List,
  Luggage, Home, Gift, Dumbbell, MapPin,
} from "lucide-react";

/**
 * lists.icon holds a Lucide component name as plain text. Emoji render flat on
 * Windows and saturated on iOS, so they are not a design we control (spec §5.5).
 * Unknown or null names fall back to a generic list glyph rather than breaking.
 */
const ICONS = {
  BookOpen, Clapperboard, ShoppingBag, Lightbulb, List,
  Luggage, Home, Gift, Dumbbell, MapPin,
} as const;

export type ListIconName = keyof typeof ICONS;

export function ListIcon({ name, size = 16, className }: {
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const Icon = (name && ICONS[name as ListIconName]) || List;
  return <Icon size={size} className={className} />;
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
git add src/components/app/ListIcon.tsx
git commit -m "feat(lists): ListIcon with Lucide names"
```

---

### Task 9: NavDropdown

This is the app's first dropdown. `AppNav`'s `More` button is a stub with no handler — build this so `More` can adopt it later.

**Files:**
- Create: `src/components/app/NavDropdown.tsx`

- [ ] **Step 1: Write it**

```typescript
"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";

export type DropdownItem = {
  href: string;
  label: string;
  icon?: React.ReactNode;
  count?: number;
  muted?: boolean;
  dividerBefore?: boolean;
};

export function NavDropdown({ label, icon, items, active }: {
  label: string;
  icon: React.ReactNode;
  items: DropdownItem[];
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape, so keyboard users are not trapped.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (hostRef.current && !hostRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-sm transition-colors ${
          active
            ? "text-accent-primary border-b-2 border-accent-primary"
            : "text-text-secondary hover:text-text-primary"
        }`}
      >
        {icon}
        <span className="hidden sm:inline">{label}</span>
        <ChevronDown size={13} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute top-full left-0 mt-1.5 min-w-[236px] bg-elevated border border-border-default rounded-md shadow-lg p-1.5 z-50"
        >
          {items.map((item) => (
            <div key={item.href}>
              {item.dividerBefore && <div className="h-px bg-border-default my-1.5 mx-1" />}
              <Link
                href={item.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-sm text-sm hover:bg-card ${
                  item.muted ? "text-text-secondary" : "text-text-primary"
                }`}
              >
                {item.icon}
                <span className="flex-1">{item.label}</span>
                {item.count !== undefined && (
                  <span className="text-xs text-text-muted tabular-nums">{item.count}</span>
                )}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck and commit**

```bash
git add src/components/app/NavDropdown.tsx
git commit -m "feat: reusable NavDropdown"
```

---

### Task 10: Wire Lists into AppNav

**Files:**
- Modify: `src/components/app/AppNav.tsx`

- [ ] **Step 1: Make the changes**

Add to the imports on line 5: `ListIcon as ListGlyph` is not needed — import `List` from lucide-react and the new pieces:

```typescript
import { Home, FolderKanban, CheckSquare, Target, MoreHorizontal, List } from "lucide-react";
import { NavDropdown, type DropdownItem } from "./NavDropdown";
import { ListIcon } from "./ListIcon";
import { useLists } from "@/hooks/use-lists";
```

Inside `AppNav`, above the `return`:

```typescript
  const { data: lists = [] } = useLists();
  const pinned = lists.filter((l) => l.pinned);
  const adHocCount = lists.filter((l) => !l.pinned).length;

  const listItems: DropdownItem[] = [
    ...pinned.map((l) => ({
      href: `/lists/${l.id}`,
      label: l.name,
      icon: <ListIcon name={l.icon} size={15} />,
    })),
    {
      href: "/lists",
      label: "All lists",
      icon: <List size={15} />,
      muted: true,
      count: adHocCount,
      dividerBefore: true,
    },
  ];
```

Then insert the dropdown between the mapped nav items and the `More` button (after line 43's closing `})}`):

```tsx
          <NavDropdown
            label="Lists"
            icon={<List size={16} />}
            items={listItems}
            active={pathname.startsWith("/lists")}
          />
```

**Open-item counts are deliberately omitted from the dropdown at this stage.** Showing them means fetching every item of every list on every page load. Task 12 adds them from data the pages already hold.

- [ ] **Step 2: Verify in the browser**

Run: `npm run dev`, open http://localhost:3000

Expected: a **Lists** entry appears after Goals. Hovering opens a dropdown with the four seeded lists and "All lists". Links 404 for now — the pages come next.

- [ ] **Step 3: Commit**

```bash
git add src/components/app/AppNav.tsx
git commit -m "feat(lists): Lists dropdown in AppNav"
```

---

### Task 11: All lists page

**Files:**
- Create: `src/app/(app)/lists/page.tsx`

- [ ] **Step 1: Build the page**

Follow the composition of `src/app/(app)/projects/page.tsx` for the header and page shell. Requirements:

- `"use client"` at the top; data from `useLists({ includeArchived: true })`.
- Three bands, each with a small uppercase heading and a horizontal rule: **Pinned**, **Ad-hoc**, **Archived**.
  - Pinned: `l.pinned && !l.archived_at`, ordered by `pin_order`.
  - Ad-hoc: `!l.pinned && !l.archived_at`.
  - Archived: `l.archived_at != null`, rendered dimmed. Collapsed behind a "Archived · N" toggle.
- Each card is a `Link` to `/lists/${l.id}` showing `ListIcon`, name, an item-count line, and the list's `item_schema` keys joined with " · " in a small monospace line. A list with an empty schema reads "no custom fields".
- A dashed "New list" card at the end of the ad-hoc band calls `useCreateList` with `{ name: "Untitled list" }` and routes to the new list.
- Grid: `grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-3`.

Use existing tokens throughout (`bg-elevated`, `border-border-default`, `text-text-secondary`, `rounded-md`). Do not introduce new colours.

- [ ] **Step 2: Verify in the browser**

Open http://localhost:3000/lists

Expected: four pinned cards with their schema lines, an empty ad-hoc band with just the New list card, and no archived band until something is archived.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/lists/page.tsx"
git commit -m "feat(lists): all lists page"
```

---

### Task 12: Open-item counts in the dropdown

**Files:**
- Modify: `src/services/lists.ts`, `src/hooks/use-lists.ts`, `src/components/app/AppNav.tsx`

- [ ] **Step 1: Add a counts query**

In `src/services/lists.ts`:

```typescript
/** Open-item counts per list, for the nav. One query, not one per list. */
export async function getOpenCounts(): Promise<Record<string, number>> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("list_items")
    .select("list_id")
    .eq("status", "open")
    .is("archived_at", null);
  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of data ?? []) counts[row.list_id] = (counts[row.list_id] ?? 0) + 1;
  return counts;
}
```

In `src/hooks/use-lists.ts`:

```typescript
export function useOpenCounts() {
  return useQuery({ queryKey: ["list-open-counts"], queryFn: getOpenCounts });
}
```

Add `qc.invalidateQueries({ queryKey: ["list-open-counts"] })` to the `onSuccess` of `useCreateListItem`, `useUpdateListItem` and `useDeleteListItem`.

- [ ] **Step 2: Use it in AppNav**

Replace the `useLists()` line with both hooks and set `count: counts[l.id] ?? 0` on each pinned item.

- [ ] **Step 3: Verify and commit**

Expected: counts show in the dropdown and drop by one when an item is ticked.

```bash
git add src/services/lists.ts src/hooks/use-lists.ts src/components/app/AppNav.tsx
git commit -m "feat(lists): open-item counts in the nav dropdown"
```

---

## Chunk 4: The list page

### Task 13: ListItemFlyout

**Files:**
- Create: `src/components/app/ListItemFlyout.tsx`

- [ ] **Step 1: Build it**

A thin wrapper over `FlyoutPanel`. It must:

- Take `item: ListItem`, `schema: ItemFieldDef[]`, `items: ListItem[]` (for select options), `onSave`, `onClose`.
- Build `fields` as `[...toFieldConfigs(schema, items), { key: "notes", label: "Notes", type: "textarea" }]`.
- Pass `data={flattenItem(item)}` and `titleField="title"`.
- In `onSave(field, value)`:
  - `title` and `notes` are core columns — write them directly.
  - Anything else is a metadata key. Find its `ItemFieldDef`, run `coerceValue`, and write `{ metadata: { ...item.metadata, [field]: coerced } }`. A `null` result deletes the key rather than storing null.
  - Wrap `coerceValue` in try/catch and surface the message through the existing `Toast` component — a bad number must not fail silently.

- [ ] **Step 2: Typecheck and commit**

```bash
git add src/components/app/ListItemFlyout.tsx
git commit -m "feat(lists): item flyout"
```

---

### Task 14: The list page

**Files:**
- Create: `src/app/(app)/lists/[id]/page.tsx`

- [ ] **Step 1: Build it**

Follow `src/app/(app)/tasks/page.tsx` for table-plus-flyout composition. Requirements:

- Data: `useList(id)`, `useListItems(id)`.
- Columns, built from the schema:
  1. A checkbox column writing core `status` (`open` ⇄ `done`). Done rows render struck through and dimmed.
  2. `title`.
  3. One column per schema field where `table === true`, in schema order. Number fields right-align with `tabular-nums`.
  4. If the schema has any `url` field, a narrow trailing column rendering an external-link icon when the value is set.
- Select values render as pills, reusing `StatusPill` where the shape fits.
- Filters: if the schema has a strict select flagged `table`, render a `FilterPill` from its options. Otherwise filter on core status. Follow the existing convention of excluding done items from the default view.
- `QuickAdd` below the table calls `useCreateListItem` with the list's schema and an empty metadata object.
- Row click opens `ListItemFlyout`.
- Header: `ListIcon`, list name, an open/done count line, and an **Archive list** button calling `useArchiveList` then routing to `/lists`.
- **An empty schema must render cleanly** — that is the ad-hoc case, and it should show only checkbox and title.

- [ ] **Step 2: Verify in the browser**

Open a pinned list. Add an item, tick it, open the flyout, edit a select and a number.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/lists/[id]/page.tsx"
git commit -m "feat(lists): list page"
```

---

## Chunk 5: MCP parity and verification

### Task 15: Teach the MCP validator the new vocabulary

The MCP's `validateMetadata` predates `select`, `url`, `strict` and `multiline`. Until this lands, an agent can write `"Fim"` into a strict field that the web app would reject.

**Files:**
- Modify: `mcp/src/tools/lists.ts:25-53`
- Test: `mcp/tests/tools/lists.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the `validateMetadata` describe block in the MCP test file:

```typescript
  it('accepts any string for an open select', () => {
    const schema = [{ key: 'store', type: 'select' }];
    expect(validateMetadata({ store: 'FNAC' }, schema)).toEqual({ ok: true });
  });

  it('rejects a value outside the options of a strict select', () => {
    const schema = [{ key: 'format', type: 'select', strict: true, options: ['Film', 'Series'] }];
    const result = validateMetadata({ format: 'Fim' }, schema);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('Film');
  });

  it('accepts a listed value for a strict select', () => {
    const schema = [{ key: 'format', type: 'select', strict: true, options: ['Film', 'Series'] }];
    expect(validateMetadata({ format: 'Film' }, schema)).toEqual({ ok: true });
  });

  it('treats url as a string', () => {
    const schema = [{ key: 'url', type: 'url' }];
    expect(validateMetadata({ url: 'https://example.com' }, schema)).toEqual({ ok: true });
    expect(validateMetadata({ url: 42 }, schema).ok).toBe(false);
  });
```

`ItemFieldDef` in `mcp/src/tools/lists.ts` needs `strict?: boolean` and `options?: string[]` added, and the `validateMetadata` signature widened to accept them.

- [ ] **Step 2: Run and watch it fail**

Run: `cd mcp && npx vitest run tests/tools/lists.test.ts`
Expected: the strict-select test fails — `Fim` is currently accepted.

- [ ] **Step 3: Implement**

Extend the type-check switch to treat `select` and `url` as strings, then add the strict-options check after it. Mirror `src/lib/list-schema.ts` exactly — same rules, same order.

- [ ] **Step 4: Run and watch it pass**

Run: `cd mcp && npx vitest run && npx tsc --noEmit`
Expected: all tests pass (144), tsc clean.

- [ ] **Step 5: Expose the new field-def keys on the tools**

In the `itemFieldSchema` zod object near the registration block, add `strict`, `options`, `multiline`, `table` and `description` as optional, each with a `.describe()` explaining it. Without this, agents cannot create a list with a strict select.

- [ ] **Step 6: Verify the handshake**

Run the stdio handshake from the session notes; expected 45 tools, `create_list` advertising the new field-def keys.

- [ ] **Step 7: Commit**

```bash
git add mcp/src/tools/lists.ts mcp/tests/tools/lists.test.ts
git commit -m "feat(mcp): select, url, strict and multiline in item_schema validation"
```

---

### Task 16: Full verification

- [ ] **Step 1: Automated gates**

```bash
npx tsc --noEmit
npm run lint
npm run test
cd mcp && npx vitest run && npx tsc --noEmit && npm run build
```
All must pass clean. `npm run build` at the root must also succeed — Vercel runs it on push.

- [ ] **Step 2: Manual checklist**

There are no component tests, so walk this by hand:

- [ ] Lists appears in the nav; hover opens the dropdown; the four pinned lists are listed with counts; "All lists" is below a divider.
- [ ] Keyboard: tab to Lists, Enter opens, Escape closes, tab reaches the items.
- [ ] `/lists` shows pinned, ad-hoc and archived bands correctly.
- [ ] "New list" creates an ad-hoc list and lands on it.
- [ ] Books shows exactly two schema columns (author, reading_status) plus the link column.
- [ ] Adding a book via QuickAdd puts it at the bottom.
- [ ] Ticking the checkbox strikes the row through and decrements the nav count.
- [ ] The flyout shows all eight fields; summary renders as a paragraph, not an inline row.
- [ ] Editing `rating` to `4.2` persists as a number — check in the SQL editor that `metadata->>'rating'` is `4.2` and not `"4.2"`.
- [ ] Editing `rating` to `abc` shows a toast and does not save.
- [ ] `where_to_watch` on TV & Movies offers a seeded option; typing a new one and reopening shows it in the list.
- [ ] `format` refuses a value outside Film/Series.
- [ ] An ad-hoc list renders checkbox and title only, with no empty columns.
- [ ] Archive list moves it to the archived band and removes it from the nav.
- [ ] Ask Hermes to add an item to Books; it appears in the UI with correct ordering.

- [ ] **Step 3: Merge**

Follow superpowers:finishing-a-development-branch.

**After merging to `main`, the live MCP must be rebuilt** or Hermes and Claude Desktop keep running the old 42-tool build:

```bash
cd C:\dev\LifeOS-mcp && git pull && cd mcp && npm run build
```

---

## Notes for whoever executes this

**Do not touch `C:\dev\LifeOS-mcp`** during implementation — it is the live server for Claude Desktop and Hermes, pinned to `main`. Only rebuild it after the merge.

**Do not touch `C:\dev\LifeOS`** — that worktree belongs to the in-flight Habits work.

**If `vitest.config.ts` or a root `test` script already exists**, the habits branch merged first. Reuse them; do not overwrite.

**The `Books to read` list from the 22 Aug write test is not one of the four seeded lists.** Leave it alone unless Axel says what to do with it.

**Sharp edge worth remembering:** dropping a field from an `item_schema` leaves the orphaned key in existing `list_items.metadata`, invisible in the UI, and any later write that resends it is rejected as unknown. Any future schema change needs a cleanup pass alongside it.
