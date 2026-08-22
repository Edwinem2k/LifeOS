"use client";

import { FlyoutPanel, type FieldConfig } from "@/components/app/FlyoutPanel";
import { toast } from "@/components/app/Toast";
import { toFieldConfigs, flattenItem, coerceValue, type ItemFieldDef } from "@/lib/list-schema";
import type { ListItem } from "@/services/lists";

type Props = {
  item: ListItem;
  schema: ItemFieldDef[];
  /** Every item on the list — open select fields derive their options from these. */
  items: ListItem[];
  onSave: (data: Partial<ListItem>) => Promise<void>;
  onClose: () => void;
};

/**
 * EditableCell toasts its own generic "Error saving" once our promise settles, so a
 * specific reason has to be queued behind it to survive. Rethrowing is what makes the
 * cell roll back to the stored value rather than keep the rejected one on screen.
 */
function reportAndThrow(message: string): never {
  setTimeout(() => toast(message, "error"), 0);
  throw new Error(message);
}

/**
 * FlyoutPanel over a list item. Its whole job is the translation in `handleSave`:
 * the panel deals only in strings, but item metadata is typed jsonb.
 */
export function ListItemFlyout({ item, schema, items, onSave, onClose }: Props) {
  const data = flattenItem(item);

  const base: FieldConfig[] = [
    ...toFieldConfigs(schema, items),
    { key: "notes", label: "Notes", type: "textarea" },
  ];

  const fields: FieldConfig[] = base.map((field) => {
    // A strict select offers only its seeded options. An item holding a value that
    // has since left `options` would render as unselected and be silently overwritten
    // by the next save, so the value in hand is appended to keep it round-tripping.
    if (field.type !== "select" || !field.options) return field;
    const current = data[field.key];
    const value = current == null ? "" : String(current);
    if (value === "" || field.options.some((o) => o.value === value)) return field;
    return { ...field, options: [...field.options, { value, label: value }] };
  });

  async function handleSave(field: string, value: string) {
    if (field === "title") {
      await save({ title: value });
      return;
    }
    if (field === "notes") {
      await save({ notes: value || null });
      return;
    }

    const def = schema.find((d) => d.key === field);
    if (!def) return;

    let coerced: unknown;
    try {
      coerced = coerceValue(value, def);
    } catch (error) {
      reportAndThrow(error instanceof Error ? error.message : "Could not save that value");
    }

    // coerceValue uses bare Number(), so "Infinity" and "-Infinity" parse cleanly and
    // then JSON.stringify turns them into null on the way to jsonb — a silent wipe.
    if (def.type === "number" && coerced !== null && !Number.isFinite(coerced)) {
      reportAndThrow(`${def.label ?? def.key} must be a finite number`);
    }

    // metadata is written as a whole-object replacement and both validators reject the
    // entire object if it carries a key that is no longer in item_schema. Rebuilding
    // from the current schema drops orphans left behind by a schema change, so editing
    // an item heals it instead of failing with "Unknown field: <some field you removed>".
    const metadata: Record<string, unknown> = {};
    for (const d of schema) {
      const existing = item.metadata?.[d.key];
      if (existing !== undefined && existing !== null) metadata[d.key] = existing;
    }
    // An empty input coerces to null, which means delete the key rather than store null.
    if (coerced === null) delete metadata[field];
    else metadata[field] = coerced;

    await save({ metadata });
  }

  async function save(patch: Partial<ListItem>) {
    try {
      await onSave(patch);
    } catch (error) {
      reportAndThrow(error instanceof Error ? error.message : "Could not save that value");
    }
  }

  return (
    <FlyoutPanel
      title={item.title}
      titleField="title"
      fields={fields}
      data={data}
      onSave={handleSave}
      onClose={onClose}
    />
  );
}
