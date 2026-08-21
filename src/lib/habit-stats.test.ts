import { describe, it, expect } from "vitest";
import {
  startOfDay, addDays, isoWeekday, startOfWeek,
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
