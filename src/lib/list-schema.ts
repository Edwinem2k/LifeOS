import type { FieldConfig } from "@/components/app/FlyoutPanel";

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
          // An open select is where "type it once and it is a suggestion forever"
          // actually happens for a human. A strict select stays closed on purpose:
          // that is what stops a typo becoming a permanent suggestion.
          ...(def.strict === true ? {} : { searchable: true, creatable: true }),
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
}): Record<string, unknown> {
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
