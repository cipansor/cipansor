import { describe, it, expect } from "vitest";
import { todayWibDay } from "./date";

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
