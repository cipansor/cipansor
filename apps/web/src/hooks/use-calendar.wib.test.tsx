import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

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

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => {
  const api = { get };
  return { api, default: api };
});

import { useMonthEvents } from "./use-calendar";

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
