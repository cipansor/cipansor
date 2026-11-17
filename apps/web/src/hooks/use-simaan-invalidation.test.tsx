import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ api }));

import {
  useCreateSimaan,
  useDeleteSimaan,
  useSubmitSimaanScores,
  useUpdateSimaan,
} from "./use-simaan";

function setup() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { invalidate, wrapper };
}

const keys = (invalidate: ReturnType<typeof vi.fn>) =>
  invalidate.mock.calls.map((c) => (c[0] as { queryKey: unknown }).queryKey);

/**
 * The Takhosus enrollment page mounts the simaan dialog and reads its status and
 * progress through the Takhosus keys. A simaan pass moves that progress on the
 * server (completes the enrollment, writes the hafidz record), so a write that
 * invalidated only `["simaan"]` left the page showing "Aktif" after the server
 * had saved "COMPLETED" (#1125).
 */
describe("simaan writes refresh the Takhosus progress they move", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.post.mockResolvedValue({ data: { data: { id: "e-1" } } });
    api.patch.mockResolvedValue({ data: { data: { id: "e-1" } } });
    api.delete.mockResolvedValue({ data: { data: { id: "e-1" } } });
  });

  it("creating", async () => {
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useCreateSimaan(), { wrapper });
    await result.current.mutateAsync({} as never);
    await waitFor(() =>
      expect(keys(invalidate)).toEqual(
        expect.arrayContaining([["simaan"], ["takhosus", "enrollment"]]),
      ),
    );
  });

  it("updating (the dialog's own path)", async () => {
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useUpdateSimaan(), { wrapper });
    await result.current.mutateAsync({ id: "e-1", data: {} as never });
    await waitFor(() =>
      expect(keys(invalidate)).toEqual(
        expect.arrayContaining([
          ["simaan", "detail", "e-1"],
          ["takhosus", "enrollment"],
          ["takhosus", "progress"],
          ["takhosus", "dashboard"],
        ]),
      ),
    );
  });

  it("grading through submitScores", async () => {
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useSubmitSimaanScores(), { wrapper });
    await result.current.mutateAsync({ id: "e-1", data: {} as never });
    await waitFor(() =>
      expect(keys(invalidate)).toEqual(
        expect.arrayContaining([
          ["simaan", "detail", "e-1"],
          ["takhosus", "enrollment"],
        ]),
      ),
    );
  });

  it("deleting", async () => {
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useDeleteSimaan(), { wrapper });
    await result.current.mutateAsync("e-1");
    await waitFor(() =>
      expect(keys(invalidate)).toEqual(
        expect.arrayContaining([["simaan"], ["takhosus", "enrollment"]]),
      ),
    );
  });
});
