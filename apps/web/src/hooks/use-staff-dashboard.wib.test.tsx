import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * The staff dashboard asks the API for "today". It runs on a UTC server, so
 * `new Date().toISOString().split("T")[0]` is the UTC day: between 00:00 and
 * 06:59 WIB the cards asked for yesterday's attendance (ticket #857). The day
 * it sends must be the WIB one.
 */
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => {
  const api = { get };
  return { api, default: api };
});

import { useStaffDashboardStats } from "./use-staff-dashboard";
import { useAuthStore } from "@/stores/auth";

/** 1 Nov 2026 00:30 WIB, where the UTC and WIB days disagree. */
const NOW = new Date("2026-10-31T17:30:00.000Z");

/** The `params.date` the attendance summary was asked for. */
const attendanceDayArg = () => {
  const call = get.mock.calls.find(
    (args: unknown[]) => args[0] === "/attendance/summary",
  );
  return (call?.[1] as { params: { date: string } } | undefined)?.params.date;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);

  get.mockResolvedValue({ data: { data: {}, meta: { total: 0 } } });
  useAuthStore.setState({
    user: {
      id: "user-1",
      unitId: "unit-smp",
      userRoles: [{ isPrimary: true, role: { code: "SMPIT_TATA_USAHA" } }],
    } as never,
  });
});

afterEach(() => {
  vi.useRealTimers();
  useAuthStore.setState({ user: null });
});

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useStaffDashboardStats", () => {
  it("asks for the WIB day, not the UTC day", async () => {
    const { result } = renderHook(() => useStaffDashboardStats(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(attendanceDayArg()).toBe("2026-11-01");
  });
});
