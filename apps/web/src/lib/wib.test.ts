import { describe, it, expect } from "vitest";
import { todayWib, wibWeekday, wibWeekdayOf } from "./wib";

describe("the WIB calendar the schedule asks for", () => {
  it("reads a moment on the WIB clock, not the device clock", () => {
    // 2026-10-29T22:30Z is Friday 30 October 05:30 WIB. A device west of WIB
    // (or one set to UTC) that read `new Date().getDay()` would ask for Thursday
    // and show the previous day's lessons for the whole morning.
    const fridayMorning = new Date("2026-10-29T22:30:00.000Z");
    expect(todayWib(fridayMorning)).toBe("2026-10-30");
    expect(wibWeekdayOf(fridayMorning)).toBe(5); // FRIDAY, not THURSDAY (4)
  });

  it("keeps the day west of WIB when WIB has not crossed midnight", () => {
    // 2026-10-29T17:00Z is the 30th 00:00 WIB; a minute earlier WIB is still the
    // 29th (Thursday), which is what a WIB user sees at 23:59.
    expect(todayWib(new Date("2026-10-29T16:59:00.000Z"))).toBe("2026-10-29");
    expect(wibWeekdayOf(new Date("2026-10-29T16:59:00.000Z"))).toBe(4); // THURSDAY
  });

  it("maps a WIB calendar day to its weekday", () => {
    expect(wibWeekday("2026-10-30")).toBe(5); // FRIDAY
    expect(wibWeekday("2026-11-01")).toBe(0); // SUNDAY
  });
});
