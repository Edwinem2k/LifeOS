import { describe, it, expect } from "vitest";
import {
  startOfDay, addDays, isoWeekday, startOfWeek, normalizeSchedule, periods,
  overlapsWindow,
} from "./habit-stats";

/* ================================================================== */
/* SHARED FIXTURES — declared ONCE. Later tasks reuse these.          */
/*                                                                     */
/* Verified calendar:                                                  */
/*   Mon 17 Aug 2026 .. Sun 23 Aug 2026                                */
/*   Mon 24 Aug 2026 .. Sun 30 Aug 2026                                */
/*   27 Jul, 3 Aug, 10 Aug and 28 Dec 2026 are all Mondays             */
/* ================================================================== */

export const MON17 = new Date(2026, 7, 17);
export const TUE18 = new Date(2026, 7, 18);
export const WED19 = new Date(2026, 7, 19);
export const THU20 = new Date(2026, 7, 20);
export const FRI21 = new Date(2026, 7, 21);
export const SAT22 = new Date(2026, 7, 22);
export const SUN23 = new Date(2026, 7, 23);

export const THU20_NOON = new Date(2026, 7, 20, 12, 0);
export const NEXT_MIDNIGHT = new Date(2026, 7, 21); // `to` while now is Thu 20th
export const EPOCH = new Date(0);

export const logsOn = (...ds: Date[]) => ds.map((d) => ({ loggedAt: d }));

describe("date helpers", () => {
  it("startOfDay strips the time in local terms", () => {
    const d = startOfDay(new Date(2026, 7, 20, 15, 30));
    expect(d.getHours()).toBe(0);
    expect(d.getDate()).toBe(20);
  });

  it("addDays crosses month boundaries", () => {
    const d = addDays(new Date(2026, 7, 31), 1);
    expect(d.getMonth()).toBe(8);
    expect(d.getDate()).toBe(1);
  });

  it("isoWeekday returns 1 for Monday and 7 for Sunday", () => {
    expect(isoWeekday(MON17)).toBe(1);
    expect(isoWeekday(SUN23)).toBe(7);
  });

  it("startOfWeek returns the Monday of that week", () => {
    const w = startOfWeek(THU20);
    expect(w.getDate()).toBe(17);
    expect(isoWeekday(w)).toBe(1);
  });

  it("startOfWeek on a Sunday returns the preceding Monday", () => {
    expect(startOfWeek(SUN23).getDate()).toBe(17);
  });

  it("startOfWeek does not split a week across a year boundary", () => {
    // Mon 28 Dec 2026 .. Sun 3 Jan 2027 is ONE week. Week-NUMBER keying
    // would split it, because getFullYear() disagrees with the ISO
    // week-year across Dec 29 - Jan 3.
    const a = startOfWeek(new Date(2026, 11, 28));
    const b = startOfWeek(new Date(2027, 0, 3));
    expect(a.getTime()).toBe(b.getTime());
  });
});

describe("normalizeSchedule", () => {
  const DAILY = { kind: "daily" };

  it("keeps a valid per_week count", () => {
    expect(normalizeSchedule({ type: "per_week", count: 3 }))
      .toEqual({ kind: "perWeek", count: 3 });
  });

  it("keeps and sorts valid days", () => {
    expect(normalizeSchedule({ type: "daily", days: [5, 1, 3] }))
      .toEqual({ kind: "days", days: [1, 3, 5] });
  });

  it("dedupes days", () => {
    expect(normalizeSchedule({ type: "daily", days: [1, 1, 3] }))
      .toEqual({ kind: "days", days: [1, 3] });
  });

  // Each of these would poison periodScore / rate30d / strength if it survived.
  it.each([
    ["count 9 (unreachable in a 7-day week)", { type: "per_week", count: 9 }],
    ["count 0 (division by zero)", { type: "per_week", count: 0 }],
    ["count 1 (identical to a one-day schedule)", { type: "per_week", count: 1 }],
    ["count 7 (daily by definition)", { type: "per_week", count: 7 }],
    ["count 3.5 (non-integer)", { type: "per_week", count: 3.5 }],
    ["count NaN", { type: "per_week", count: NaN }],
    ["count Infinity", { type: "per_week", count: Infinity }],
    ["count as a string", { type: "per_week", count: "3" }],
    ["empty days", { type: "daily", days: [] }],
    ["all seven days", { type: "daily", days: [1, 2, 3, 4, 5, 6, 7] }],
    ["JS getDay() convention (0 = Sunday)", { type: "daily", days: [0] }],
    ["out-of-range days", { type: "daily", days: [8, 9] }],
    ["unrecognised type", { type: "monthly" }],
    ["empty object", {}],
    ["null", null],
    ["a string", "daily"],
  ])("falls back to daily: %s", (_label, input) => {
    expect(normalizeSchedule(input)).toEqual(DAILY);
  });

  it("keeps valid days when mixed with invalid ones", () => {
    expect(normalizeSchedule({ type: "daily", days: [1, 0, 3, 99] }))
      .toEqual({ kind: "days", days: [1, 3] });
  });
});

describe("periods — daily, build", () => {
  const daily = { kind: "daily" as const };

  it("emits one period per day from creation to today inclusive", () => {
    const p = periods(daily, "build", MON17, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(4); // 17, 18, 19, 20
    expect(p[0].target).toBe(1);
  });

  it("marks today's period open and earlier ones closed", () => {
    const p = periods(daily, "build", MON17, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p.slice(0, 3).every((x) => x.closed)).toBe(true);
    expect(p[3].closed).toBe(false);
  });

  it("counts a logged day as actual 1", () => {
    const p = periods(daily, "build", MON17, logsOn(new Date(2026, 7, 18, 12)),
                      EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[1].actual).toBe(1);
    expect(p[0].actual).toBe(0);
  });

  it("counts two logs on one day only once", () => {
    const p = periods(daily, "build", MON17,
      logsOn(new Date(2026, 7, 18, 9), new Date(2026, 7, 18, 21)),
      EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[1].actual).toBe(1);
  });

  it("emits nothing before the habit existed", () => {
    const p = periods(daily, "build", WED19, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(2); // 19, 20
  });

  it("clamps a future createdAt to now", () => {
    const p = periods(daily, "build", new Date(2027, 0, 1), [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(1);
  });

  it("does not emit a phantom creation period far outside the window", () => {
    // An unbounded creation clause emitted a lone 2023 period followed by a
    // 2-year gap, and made the day loop run from createdAt every time.
    const old = new Date(2023, 0, 2);
    const from = addDays(startOfDay(THU20_NOON), -365);
    const p = periods(daily, "build", old, [], from, NEXT_MIDNIGHT, THU20_NOON);
    expect(p.length).toBeLessThanOrEqual(366);
    expect(p[0].start.getTime()).toBeGreaterThanOrEqual(from.getTime());
  });
});

describe("periods — daily, break", () => {
  const daily = { kind: "daily" as const };

  it("sets the target to 0 — a ceiling, not a goal", () => {
    // With target 1, `actual <= target` is always true and break polarity
    // becomes inert: a habit logged every day would report a full streak.
    const p = periods(daily, "break", MON17, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[0].target).toBe(0);
  });

  it("still counts logs into actual", () => {
    const p = periods(daily, "break", MON17, logsOn(new Date(2026, 7, 18, 12)),
                      EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[1].actual).toBe(1); // 1 > 0 ceiling, so a failure downstream
  });
});

describe("periods — specific days", () => {
  const MWF = { kind: "days" as const, days: [1, 3, 5] };

  it("emits only required days", () => {
    const p = periods(MWF, "build", MON17, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(2); // Mon 17, Wed 19
  });

  it("a habit created on a non-required day starts at its first required day", () => {
    const p = periods(MWF, "build", TUE18, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(1);
    expect(p[0].start.getDate()).toBe(19);
    expect(p[0].target).toBe(1); // full target, no pro-rating
  });

  it("uses a 0 ceiling for break polarity", () => {
    const p = periods(MWF, "break", MON17, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[0].target).toBe(0);
  });
});

describe("periods — per week", () => {
  const X3 = { kind: "perWeek" as const, count: 3 };

  it("emits the current week even though it ends in the future", () => {
    const p = periods(X3, "build", MON17, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(1);
    expect(p[0].closed).toBe(false);
    expect(p[0].end.getDate()).toBe(24); // next Monday, beyond `to`
  });

  it("counts distinct logged days across the week", () => {
    const p = periods(X3, "build", MON17,
      logsOn(new Date(2026, 7, 17, 12), new Date(2026, 7, 19, 12)),
      EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[0].actual).toBe(2);
  });

  it("keeps the full target when created early enough to reach it", () => {
    const p = periods(X3, "build", WED19, [], EPOCH, NEXT_MIDNIGHT, THU20_NOON);
    expect(p[0].target).toBe(3); // Wed..Sun = 5 days
  });

  it("pro-rates a build habit's creation week when the target is unreachable", () => {
    const SAT_NOW = new Date(2026, 7, 22, 12);
    const p = periods(X3, "build", SAT22, [], EPOCH, new Date(2026, 7, 23), SAT_NOW);
    expect(p[0].target).toBe(2); // Sat, Sun
  });

  it("pro-rates a Sunday creation to 1", () => {
    const SUN_NOW = new Date(2026, 7, 23, 12);
    const p = periods(X3, "build", SUN23, [], EPOCH, new Date(2026, 7, 24), SUN_NOW);
    expect(p[0].target).toBe(1);
  });

  it("does NOT pro-rate a break habit's creation week", () => {
    // For break polarity `count` is an ALLOWANCE. Shrinking it would make the
    // creation week stricter than the ongoing rule — the opposite of the
    // "don't judge time it did not exist" rationale.
    const SAT_NOW = new Date(2026, 7, 22, 12);
    const p = periods(X3, "break", SAT22, [], EPOCH, new Date(2026, 7, 23), SAT_NOW);
    expect(p[0].target).toBe(3);
  });

  it("does not pro-rate weeks after the creation week", () => {
    const NEXT_THU = new Date(2026, 7, 27, 12);
    const p = periods(X3, "build", SAT22, [], EPOCH, new Date(2026, 7, 28), NEXT_THU);
    expect(p).toHaveLength(2);
    expect(p[0].target).toBe(2); // creation week, pro-rated
    expect(p[1].target).toBe(3); // full week
  });

  it("never drops the creation period when `from` is mid-week", () => {
    // The flyout passes from = createdAt; startOfWeek(createdAt) < createdAt,
    // so a naive `start >= from` trim would delete the week being pro-rated.
    const p = periods(X3, "build", WED19, [], WED19, NEXT_MIDNIGHT, THU20_NOON);
    expect(p).toHaveLength(1);
  });

  it("trims a window-straddling week that is not the creation week", () => {
    // createdAt is WELL before `from`, so the creation clause does not apply
    // and the Aug 17 week is trimmed for starting before `from`.
    const created = new Date(2026, 6, 1);
    const NEXT_THU = new Date(2026, 7, 27, 12);
    const p = periods(X3, "build", created, [], new Date(2026, 7, 19),
                      new Date(2026, 7, 28), NEXT_THU);
    expect(p).toHaveLength(1);
    expect(p[0].start.getDate()).toBe(24);
  });

  it("treats a week spanning the new year as one period", () => {
    const DEC28 = new Date(2026, 11, 28);
    const JAN1_NOW = new Date(2027, 0, 1, 12);
    const p = periods(X3, "build", DEC28, [], EPOCH, new Date(2027, 0, 2), JAN1_NOW);
    expect(p).toHaveLength(1);
  });
});

describe("overlapsWindow — the window trim predicate", () => {
  const JUL1 = new Date(2026, 6, 1);

  it("admits a period starting inside the window", () => {
    expect(overlapsWindow(WED19, THU20, MON17, JUL1)).toBe(true);
  });

  it("rejects a period entirely before the window", () => {
    expect(overlapsWindow(JUL1, new Date(2026, 6, 2), MON17, JUL1)).toBe(false);
  });

  it("admits the creation period even when it starts before `from`", () => {
    // startOfWeek(createdAt) < createdAt, so the flyout's from = createdAt
    // would otherwise delete the week being pro-rated.
    expect(overlapsWindow(MON17, new Date(2026, 7, 24), WED19, WED19)).toBe(true);
  });

  it("does NOT admit a creation period that ended before the window", () => {
    // The phantom-period bug: without `end > from`, a habit created in 2023
    // emits a lone period two years adrift from the rest of the list.
    const created2023 = new Date(2023, 0, 2);
    expect(
      overlapsWindow(created2023, new Date(2023, 0, 3), MON17, created2023),
    ).toBe(false);
  });

  it("rejects a non-creation period straddling the window start", () => {
    expect(overlapsWindow(MON17, THU20, WED19, JUL1)).toBe(false);
  });
});
