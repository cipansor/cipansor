import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

/**
 * A shared device (a family tablet, the office PC) is signed out by one wali and
 * signed in by another. Logout drops the push-status queries but not the parent
 * ones, so `useParentChildren` / `useParentDashboard` must key by the wali's id:
 * with a key that carries no identity, the second wali reads the first's cached
 * children and dashboard (CWE-524, #869 review).
 */
const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => {
  const api = { get };
  return { api, default: api };
});

import { useParentChildren, useParentDashboard } from "./use-parent-portal";
import { useAuthStore } from "@/stores/auth";

/** One QueryClient for the whole test, as the app has one per page. */
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

const signInAs = (id: string) =>
  useAuthStore.setState({ user: { id } as never });

beforeEach(() => {
  client.clear();
  vi.clearAllMocks();
  useAuthStore.setState({ user: null });
});

afterEach(() => {
  useAuthStore.setState({ user: null });
});

describe("parent portal query keys (#869 review)", () => {
  it("does not serve one wali the previous wali's children from cache", async () => {
    get.mockResolvedValue({ data: { data: [{ id: "s-a", name: "Anak A" }] } });
    signInAs("wali-a");

    const { result, rerender } = renderHook(() => useParentChildren(), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.data).toEqual([{ id: "s-a", name: "Anak A" }]),
    );

    // Wali A signs out, wali B signs in on the same device and QueryClient.
    get.mockResolvedValue({ data: { data: [{ id: "s-b", name: "Anak B" }] } });
    signInAs("wali-b");
    rerender();

    await waitFor(() =>
      expect(result.current.data).toEqual([{ id: "s-b", name: "Anak B" }]),
    );
    // Two calls: wali B's list came from the API, not wali A's cache.
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("does not serve one wali the previous wali's dashboard from cache", async () => {
    get.mockResolvedValue({
      data: { data: { children: [], unreadNotifications: 1 } },
    });
    signInAs("wali-a");

    const { result, rerender } = renderHook(() => useParentDashboard(), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.data).toEqual({
        children: [],
        unreadNotifications: 1,
      }),
    );

    get.mockResolvedValue({
      data: { data: { children: [], unreadNotifications: 9 } },
    });
    signInAs("wali-b");
    rerender();

    await waitFor(() =>
      expect(result.current.data).toEqual({
        children: [],
        unreadNotifications: 9,
      }),
    );
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("does not fetch before a wali is signed in", async () => {
    get.mockResolvedValue({ data: { data: [] } });

    const { result } = renderHook(() => useParentChildren(), { wrapper });

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(get).not.toHaveBeenCalled();
  });
});
