import { describe, it, expect } from "vitest";
import { wibDayOf } from "./date";
import { wibDay } from "./admission-intake";

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
