import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

/**
 * The "Jadwal Hari Ini" tab asks the API for a day. It runs on a UTC server, so
 * `new Date().toISOString().split("T")[0]` is the UTC day: between 00:00 and
 * 06:59 WIB it is still yesterday, and the page showed the previous day's duty
 * roster (ticket #1026). The day it sends must be the WIB one.
 */
const { useDutyRosters, useDutyStatistics } = vi.hoisted(() => ({
  useDutyRosters: vi.fn(),
  useDutyStatistics: vi.fn(),
}));

vi.mock("@/components/layout", () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/hooks/use-duty-roster", () => ({
  DUTY_TYPE_LABELS: {},
  useDutyRosters,
  useDutyStatistics,
}));

import DutyRosterPage from "./page";

/** 2 Nov 2026 05:00 WIB, where the UTC and WIB days disagree. */
const NOW = new Date("2026-11-01T22:00:00.000Z");

const rosterDateArg = () => useDutyRosters.mock.calls.at(-1)?.[0]?.date;
const statsArg = () => useDutyStatistics.mock.calls.at(-1)?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  useDutyRosters.mockReturnValue({
    data: { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } },
    isLoading: false,
  });
  useDutyStatistics.mockReturnValue({ data: undefined, isLoading: false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("duty-roster 'Jadwal Hari Ini'", () => {
  it("asks the API for the WIB day, not the UTC day, before 07:00 WIB", () => {
    render(<DutyRosterPage />);

    expect(rosterDateArg()).toBe("2026-11-02");
  });

  it("labels the day it asked for even on a device west of WIB", () => {
    // `new Date("2026-11-02")` is UTC midnight, so the device zone decides which
    // calendar day the label prints: a device west of UTC would render "1
    // November" for the day the page asked the API for. The label is pinned to
    // Asia/Jakarta, so it stays on the requested day on any device clock.
    //
    // `TZ` is usually unset here, so it is stubbed and restored by
    // `unstubAllEnvs` (below) — assigning `undefined` back would store the
    // string "undefined" and leave this worker on a bogus zone for later tests.
    vi.stubEnv("TZ", "America/New_York");

    render(<DutyRosterPage />);

    expect(rosterDateArg()).toBe("2026-11-02");
    expect(screen.getByText("Senin, 2 November 2026")).toBeInTheDocument();
  });

  it("reports the statistics window from WIB start of month to WIB today", () => {
    render(<DutyRosterPage />);

    expect(statsArg()).toEqual({
      startDate: "2026-11-01",
      endDate: "2026-11-02",
    });
  });

  it("moves the selected day by exactly one when navigating", () => {
    render(<DutyRosterPage />);

    fireEvent.click(screen.getByLabelText("Hari berikutnya"));
    expect(rosterDateArg()).toBe("2026-11-03");

    fireEvent.click(screen.getByLabelText("Hari sebelumnya"));
    expect(rosterDateArg()).toBe("2026-11-02");
  });
});
