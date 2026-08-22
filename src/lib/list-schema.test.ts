import { describe, it, expect } from "vitest";
import { validateMetadata, type ItemFieldDef } from "./list-schema";
import { selectOptions } from "./list-schema";
import { toFieldConfigs, flattenItem, coerceValue } from "./list-schema";

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

  it("accepts a boolean field given true or false", () => {
    const schema: ItemFieldDef[] = [{ key: "signed", label: "Signed", type: "boolean" }];
    expect(validateMetadata({ signed: true }, schema)).toEqual({ ok: true });
    expect(validateMetadata({ signed: false }, schema)).toEqual({ ok: true });
  });

  it("rejects a boolean field given a string", () => {
    const schema: ItemFieldDef[] = [{ key: "signed", label: "Signed", type: "boolean" }];
    const result = validateMetadata({ signed: "yes" }, schema);
    expect(result.ok === false && result.message).toBe("Signed must be true or false");
  });

  it("accepts a date field given an ISO date string", () => {
    const schema: ItemFieldDef[] = [{ key: "published", label: "Published", type: "date" }];
    expect(validateMetadata({ published: "2026-08-22" }, schema)).toEqual({ ok: true });
  });

  it("rejects a date field given a number", () => {
    const schema: ItemFieldDef[] = [{ key: "published", label: "Published", type: "date" }];
    expect(validateMetadata({ published: 20260822 }, schema).ok).toBe(false);
  });
});

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
    expect(coerceValue("Cli-fi", { key: "genre", type: "select" })).toBe("Cli-fi");
    expect(coerceValue("https://example.com", { key: "url", type: "url" })).toBe("https://example.com");
  });
});
