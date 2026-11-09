import { describe, it, expect } from "vitest";
import { todayWibDay, wibDayOf } from "./date";
import { wibDay } from "./admission-intake";

/**
 * The API and the web must agree on which calendar day "today" is. The web
 * runs on a UTC server, so `toISOString()` gives the UTC day and asks the API
 * for yesterday's attendance until 07:00 WIB (ticket #857).
 */
describe("todayWibDay", () => {
  it("is the WIB day, not the UTC day, between 00:00 and 06:59 WIB", () => {
    // 1 Nov 2026 00:30 WIB = 31 Oct 2026 17:30 UTC
    expect(todayWibDay(new Date("2026-10-31T17:30:00.000Z"))).toBe(
      "2026-11-01",
    );
  });

  it("matches the UTC day once WIB has caught up", () => {
    // 1 Nov 2026 12:00 WIB = 1 Nov 2026 05:00 UTC
    expect(todayWibDay(new Date("2026-11-01T05:00:00.000Z"))).toBe(
      "2026-11-01",
    );
  });

  it("rolls the WIB day at 17:00Z, not at midnight UTC", () => {
    expect(todayWibDay(new Date("2026-10-31T16:59:59.000Z"))).toBe(
      "2026-10-31",
    );
    expect(todayWibDay(new Date("2026-10-31T17:00:00.000Z"))).toBe(
      "2026-11-01",
    );
  });
});

describe("wibDayOf", () => {
  it("reads the pesantren's day, not the UTC one", () => {
    // 06:30 in Tasikmalaya is 23:30 UTC the day before; a staff dashboard card
    // asking for "today" must not ask for yesterday.
    expect(wibDayOf("2026-11-01T23:30:00.000Z")).toBe("2026-11-02");
    // The last instant of the WIB day is still that day.
    expect(wibDayOf("2026-11-01T16:59:59.999Z")).toBe("2026-11-01");
    // And the first instant is the same day, not the previous UTC one.
    expect(wibDayOf("2026-10-31T17:00:00.000Z")).toBe("2026-11-01");
  });

  it("accepts a Date as well as an ISO string", () => {
    expect(wibDayOf(new Date("2026-11-01T23:30:00.000Z"))).toBe("2026-11-02");
  });

  it("answers empty for an unparseable instant", () => {
    expect(wibDayOf("not a date")).toBe("");
  });
});

describe("wibDay", () => {
  it("delegates to wibDayOf but keeps the form field's blank state", () => {
    expect(wibDay("2026-11-01T23:30:00.000Z")).toBe("2026-11-02");
    expect(wibDay(null)).toBe("");
    expect(wibDay(undefined)).toBe("");
  });
});
