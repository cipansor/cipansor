import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ default: api }));

import {
  useLaundryStats,
  useLaundryTransactions,
  useProcessLaundryPayment,
  useUpdateLaundryStatus,
} from "./use-laundry";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("laundry mutations own their error toast", () => {
  it("does not let the Axios interceptor toast a status refusal twice", async () => {
    api.patch.mockResolvedValue({
      data: { data: { id: "tx-1", status: "READY" } },
    });

    const { result } = renderHook(() => useUpdateLaundryStatus(), { wrapper });
    await act(async () => {
      result.current.mutate({ id: "tx-1", status: "READY" });
    });

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        "/laundry/transactions/tx-1/status",
        { status: "READY", notes: undefined },
        { skipErrorToast: true },
      ),
    );
  });

  it("settles a Bayar Nanti order through the pay route", async () => {
    api.post.mockResolvedValue({
      data: { data: { id: "tx-1", paymentStatus: "PAID" } },
    });

    const { result } = renderHook(() => useProcessLaundryPayment(), {
      wrapper,
    });
    await act(async () => {
      result.current.mutate({ id: "tx-1", paymentMethod: "CASH" });
    });

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        "/laundry/transactions/tx-1/pay",
        { paymentMethod: "CASH" },
        { skipErrorToast: true },
      ),
    );
  });
});

describe("laundry reads leave the error toast to the page", () => {
  it("does not let the Axios interceptor toast a failed list request", async () => {
    api.get.mockResolvedValue({
      data: {
        data: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 1 },
      },
    });

    const { result } = renderHook(() => useLaundryTransactions(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.get).toHaveBeenCalledWith("/laundry/transactions", {
      params: {},
      skipErrorToast: true,
    });
  });

  it("does not let the Axios interceptor toast a failed stats request", async () => {
    api.get.mockResolvedValue({ data: { data: { summary: {} } } });

    const { result } = renderHook(() => useLaundryStats(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.get).toHaveBeenCalledWith("/laundry/transactions/stats", {
      params: {},
      skipErrorToast: true,
    });
  });
});
