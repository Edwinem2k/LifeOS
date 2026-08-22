import { describe, it, expect } from "vitest";
import { validateMetadata, type ItemFieldDef } from "./list-schema";
import { selectOptions } from "./list-schema";

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
