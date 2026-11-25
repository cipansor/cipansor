import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { EventType } from "@cipansor/shared";

/**
 * The academic calendar asks the API for one month's window. `useMonthEvents`
 * built it from `new Date(year, month, 1)` (local midnight) and read it back
 * with `toISOString()` (always UTC), so in a WIB browser (UTC+7) — every user of
 * the pesantren portal — the window slid one day at both ends: the month lost
 * its last day and pulled in the last day of the previous one (ticket #911).
 *
 * The window must name the month exactly, whatever the browser's zone. The test
 * pins `TZ=Asia/Jakarta` so the defect is reproduced on a UTC CI machine too —
 * under UTC the old code happened to be right, which is why it went unnoticed.
 */

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("@/lib/api", () => {
  const api = { get, post };
  return { api, default: api };
});

import {
  agendaUnitIdFor,
  useCreateCalendarEvent,
  useMonthEvents,
  useTodayEvents,
} from "./use-calendar";

const ORIGINAL_TZ = process.env.TZ;

/** The `params` the month window was asked for. */
const monthParams = () => {
  const call = get.mock.calls.find(
    (args: unknown[]) => args[0] === "/calendar",
  );
  return (call?.[1] as { params: { startDate: string; endDate: string } })
    ?.params;
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TZ = "Asia/Jakarta";
  get.mockResolvedValue({ data: { data: [] } });
  post.mockResolvedValue({ data: { data: { id: "event-1" } } });
});

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ;
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useMonthEvents", () => {
  it("asks for the exact month in WIB, not a day-shifted window", async () => {
    const { result } = renderHook(() => useMonthEvents(2026, 0), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(monthParams()).toMatchObject({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
  });

  it("closes a year-boundary month correctly", async () => {
    const { result } = renderHook(() => useMonthEvents(2025, 11), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(monthParams()).toMatchObject({
      startDate: "2025-12-01",
      endDate: "2025-12-31",
    });
  });

  it("asks for the same window on a UTC machine (no regression)", async () => {
    process.env.TZ = "UTC";
    const { result } = renderHook(() => useMonthEvents(2026, 0), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(monthParams()).toMatchObject({
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });
  });
});

describe("useTodayEvents", () => {
  it("asks the API for the unit's WIB agenda today", async () => {
    const { result } = renderHook(() => useTodayEvents("unit-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(get).toHaveBeenCalledWith("/calendar/today/unit-1");
  });

  it("does not ask when no unit is known", () => {
    const { result } = renderHook(() => useTodayEvents(undefined), {
      wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(get).not.toHaveBeenCalled();
  });
});

describe("agendaUnitIdFor", () => {
  it("uses the active-role unit even when the profile names another unit", () => {
    expect(
      agendaUnitIdFor("", { unitId: "unit-sdit", unit: { id: "unit-smp" } }),
    ).toBe("unit-sdit");
  });

  it("lets an explicit unit filter win", () => {
    expect(agendaUnitIdFor("unit-sma", { unitId: "unit-sdit" })).toBe(
      "unit-sma",
    );
  });

  it("returns empty when the session has no unit", () => {
    expect(agendaUnitIdFor("", null)).toBe("");
  });
});

describe("useCreateCalendarEvent", () => {
  it("sends eventType, scope and an iCal rule instead of the form fields", async () => {
    const { result } = renderHook(() => useCreateCalendarEvent(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        title: "Rapat Wali Kelas",
        category: EventType.MEETING,
        startDate: "2026-11-25",
        endDate: "2026-11-25",
        isAllDay: true,
        unitId: "unit-sdit",
        recurrence: "WEEKLY",
        recurrenceEnd: "2026-12-31",
        isPublic: true,
      });
    });

    const payload = post.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      eventType: "MEETING",
      scope: "SPECIFIC_UNIT",
      isRecurring: true,
      recurrenceRule: "FREQ=WEEKLY;UNTIL=20261231T235959Z",
    });
    expect(payload).not.toHaveProperty("category");
    expect(payload).not.toHaveProperty("recurrence");
  });
});
