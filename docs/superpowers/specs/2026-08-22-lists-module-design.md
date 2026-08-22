# Lists Module — Design

**Date:** 22 August 2026
**Status:** design approved; ready for implementation planning
**Branch:** `feat/lists-module` (worktree `C:\dev\LifeOS-lists`)
**Mockup:** https://claude.ai/code/artifact/2b36cc79-daf2-4413-9f7a-b5bbd5a8b349

## 1. Why this module, and why now

`LIFE-OS-PLAN.md` §6 places Notes & Lists in Phase 4, but §4.5 carries the caveat
"lists earlier if trivial". Lists jumps its slot for one reason: it is the only remaining
module that is genuinely isolated. It has its own tables, its own page, no Today-page
surface and no required goal-linking, so it can be designed and built alongside the
in-flight Habits work without contention.

Activity Logs is the strict Phase 2 next step and stays next in line — it lands on the
Today page, reuses the habits streak/heatmap vocabulary and builds on components that
exist only on `feat/habits-page`, so it is cheap *after* that branch merges and expensive
before. CRM (Phase 3) follows.

## 2. The core idea

Two classes of list, one table, distinguished by a single flag.

**Pinned lists** are permanent, few, and richly structured. They appear in a nav dropdown
and carry purpose-built custom fields. Four ship in v1: Books, TV & Movies, Wishlist,
Business ideas.

**Ad-hoc lists** are disposable. They are typically created by a sentence to Hermes
("create a shopping list for Lidl this week"), have no custom fields at all, get ticked
off, and are archived manually when done.

Nothing in the schema distinguishes them beyond `lists.pinned`. The same page component,
the same services and the same MCP tools serve both.

### 2.1 Wishlist is not a shopping list

The pinned "Wishlist" holds considered purchases — things worth buying eventually
(a laptop, a standing desk), reviewed when browsing Amazon once a month. Grocery runs are
ad-hoc lists. Both were called "shopping" in early discussion; keeping that name for both
would have made the nav incoherent.

## 3. Data model

### 3.1 Migration

Three columns. Number to be assigned after the Habits branch lands (006 and 007 are taken).

```sql
alter table lists      add column pinned    boolean not null default false;
alter table lists      add column pin_order integer;
alter table list_items add column notes     text;
```

- `pinned` / `pin_order` drive the nav dropdown. `pin_order` sorts ascending; nulls last.
- `list_items.notes` holds user prose. It is a real column rather than an `item_schema`
  field because it is long-form, it is the user's own writing rather than structured
  metadata, and metadata is subject to schema validation that prose should not be.

No enum changes. `list_kind` and `list_item_status` are untouched.

### 3.2 Core columns do as much work as possible

The rule: **`item_schema` carries only what is not already core.**

| Need | Served by | Not a schema field because |
|---|---|---|
| Date added | `list_items.created_at` | Already written on insert; nothing to fill in |
| On the list / dealt with | `list_items.status` (`open`/`done`) | Shared vocabulary the whole app understands |
| Per-item prose | `list_items.notes` (new) | Long-form, and must not be schema-validated |
| Ordering | `list_items.sort_order` | Already exists |

### 3.3 status vs reading_status

`list_items.status` is a two-state enum shared by every list, and it means
*still on this list* versus *dealt with*. Book trackers conventionally want four or five
states, so Books carries its own `reading_status` select. These are deliberately two
different facts: a book you abandon is `status: done` (off the list) with
`reading_status: abandoned` (not read). One control cannot express both.

Extending the shared enum was rejected — it would impose book vocabulary on a Lidl list.

### 3.4 item_schema field definitions

Existing shape, unchanged:

```json
{ "key": "author", "label": "Author", "type": "text" }
```

Three additions to the type/flag vocabulary:

| Addition | Meaning |
|---|---|
| `type: "select"` | Renders as a chip and a dropdown rather than free text |
| `type: "url"` | Renders as a link; shows a ↗ affordance in the table row |
| `"strict": true` | Closed option set — only listed `options` accepted |
| `"multiline": true` | Renders as a paragraph block in the flyout, not an inline row |
| `"table": true` | This field earns a table column; all others are flyout-only |

`item_schema` is `jsonb`, so none of this needs a migration.

### 3.5 Select options are never configured

A `select` field's dropdown is the union of its seeded `options` array and **the distinct
values already used for that field on that list**. Using a value once makes it a permanent
suggestion. Nothing is written back to `item_schema`, there is no options editor, and
validation stays type-only, so a novel value is never rejected.

`strict: true` opts a field out of this, for genuinely closed sets (`format` is only Film
or Series). Without it, a typo becomes a permanent suggestion.

## 4. The four seeded schemas

Seeded by migration. `●` marks a table column; everything else is flyout-only.

### Books
| Field | Type | Col | Notes |
|---|---|---|---|
| `author` | text | ● | |
| `reading_status` | select, strict | ● | to read · reading · finished · abandoned |
| `summary` | text, multiline | | Spoiler-free, 2–3 sentences. Contract stated in the field description |
| `form` | select, strict | | Fiction · Non-fiction |
| `genre` | select | | Open options |
| `recommended_by` | text | | The reason this list exists |
| `rating` | number | | Goodreads score |
| `url` | url | | |

### TV & Movies
One list, not two — `format` is a field rather than a separate list, because it is one queue.

| Field | Type | Col | Notes |
|---|---|---|---|
| `format` | select, strict | ● | Film · Series |
| `where_to_watch` | select | ● | Open options |
| `summary` | text, multiline | | Spoiler-free premise |
| `director` | text | | |
| `year` | number | | |
| `genre` | select | | |
| `recommended_by` | text | | Defined again here; deliberately not shared with Books |
| `url` | url | | |

### Wishlist
| Field | Type | Col | Notes |
|---|---|---|---|
| `buy_from` | select | ● | Open options; Hermes researches and fills this |
| `price` | number | ● | Tabular figures, right-aligned |
| `url` | url | | Product page |
| `priority` | select | | now · soon · someday |
| `category` | select | | tech · home · sport · gifts |

### Business ideas
| Field | Type | Col | Notes |
|---|---|---|---|
| `one_liner` | text | ● | |
| `conviction` | number | ● | 1–5 |
| `category` | select | | |
| `next_step` | text | | |

### 4.1 Field duplication is intentional

`recommended_by` is defined separately on Books and TV & Movies, and `genre` on both.
A shared field catalogue was rejected: §3.5 of the plan calls for "custom columns without
table sprawl", and three lines of duplicated JSON is cheaper than the machinery.

### 4.2 No schema editor in v1

New pinned lists are rare and are a Claude Code job. `update_list` already accepts a
replacement `item_schema`, so Hermes can do it too. A UI editor is deferred indefinitely.

## 5. UI

### 5.1 Navigation

`Lists` joins the top nav after Habits. Hover or focus opens a dropdown: pinned lists in
`pin_order` with open-item counts, a divider, then **All lists**.

Counts are *open* items, not totals — a wishlist showing 13 when 9 are outstanding misleads.

The `More` button in `AppNav.tsx` is currently a stub with no handler and no menu, so this
is the app's first dropdown. Build it as a reusable component; `More` inherits it later.

### 5.2 All lists (`/lists`)

Three bands: **Pinned**, **Ad-hoc**, **Archived** (collapsed). Cards show icon, name,
open/done counts, and the list's `item_schema` rendered in mono — visible because seeing
the fields is how a wrong one gets noticed. A dashed "New list" card sits at the end of
the ad-hoc band.

### 5.3 A list page

Reuses the existing DataTable, FilterBar/FilterPill, QuickAdd and FlyoutPanel patterns.

- Columns: checkbox (core `status`), title, then only the fields flagged `table: true`.
- `url` fields render as a ↗ affordance in a narrow trailing column.
- Filter pills derive from the list's own `reading_status`-style field where one exists,
  otherwise from core status.
- Row click opens the flyout. QuickAdd sits below the table.
- Ad-hoc lists render the same component with an empty schema: checkbox and title only.

### 5.4 Flyout

FlyoutPanel with the `children` prop being added on the Habits branch (decision A there).
Contents: title, a metadata block of every schema field plus the free `added` date, then
`multiline` fields as paragraph blocks, then notes, then linked items.

### 5.5 Icons

List icons use **Lucide**, not emoji. Colour emoji render differently per OS — flat on
Windows, saturated on iOS — so the design is not ours to control. Lucide is already a
dependency, is monochrome, and takes area colours.

`lists.icon` is a plain `text` column, so it holds a Lucide name exactly as well as an
emoji. A future system-wide emoji pass (v2, out of scope here) can rewrite the values
without a migration; that pass should load Noto Color Emoji as a webfont so rendering is
device-independent.

### 5.6 Deliberately out of scope

- **Auto-archiving.** Archiving is manual, by the user or by Hermes.
- **Today page integration.** Lists are pull, not push. Today stays tasks/habits/events.
- **Promote to project.** A business idea becoming a project is rare and easy by hand. v2+.
- **Kanban view.** Table only. Revisit if it is actually missed.
- **In-app AI summaries.** The `summary` field is filled by Hermes or Claude via MCP.
  A Summarise button would need an Anthropic key and a server route in the Next app —
  the first in-app AI call, and infrastructure this module otherwise does not need.

## 6. MCP server

### 6.1 Delivered (this branch, complete)

Built TDD; 140 tests pass (from 131), `tsc` clean, stdio handshake confirms 45 tools
(from 42).

| Tool | Purpose |
|---|---|
| `archive_list` | Files away a finished ad-hoc list. Unblocks the Hermes shopping flow |
| `update_list` | Rename, re-icon, set `pinned`/`pin_order`, replace `item_schema` |
| `delete_list_item` | Soft-delete one item. Description steers agents to `status: done` for "bought it" |

Also fixed: `create_list_item` left `sort_order` null while the web app uses `max + 1`, so
agent-added and UI-added items interleaved unpredictably. Now matches the app.

Refactor: `update_list_item` held a private copy of the item-resolution logic that
`delete_list_item` also needed. Extracted to a shared `resolveListItem`; both use it.

### 6.2 Still to do

- `validateMetadata` must learn `select`, `url`, `strict` and `multiline`.
- The three tools above are on `feat/lists-module`. The live server runs from
  `C:\dev\LifeOS-mcp` pinned to `main` and will not see them until this branch merges and
  that worktree is pulled and rebuilt.

## 7. Web app

### 7.1 Shared validation

`validateMetadata` currently lives only in `mcp/src/tools/lists.ts`, with no database
constraint behind it. An agent cannot write an unknown key but the web app could, so the
rule must be shared: extract a pure module (`src/lib/list-schema.ts`) consumed by both,
the way `habit-stats.ts` was handled on the Habits branch.

### 7.2 Services and hooks

Mirror `projects.ts`: `getLists`, `getList`, `createList`, `updateList`, `archiveList`,
`getListItems`, `createListItem`, `updateListItem`, `deleteListItem`. Hooks invalidate
`["lists"]` and `["list-items", listId]`.

## 8. Known sharp edges

**Removing a field from `item_schema` is quiet, not clean.** Existing `list_items.metadata`
keeps the orphaned key invisibly, and a later write that resends it is rejected as an
unknown key. Any schema change needs a metadata cleanup pass alongside it.

**Unknown-key validation short-circuits.** A payload with both an unknown key and a wrong
type reports only the unknown key. Acceptable, but agents may need two round trips.

**Migration numbering** collides with the Habits branch. Assign after it merges.

## 9. Verification

- Unit tests for the shared schema module: each type, `strict` accept/reject, unknown key,
  empty schema.
- MCP handler tests already written and passing.
- Manual checklist over the four seeded lists: create, add, tick, filter, flyout edit,
  archive; plus one ad-hoc list created end-to-end through Hermes.
