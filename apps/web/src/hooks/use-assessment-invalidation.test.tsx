import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const patch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({
  default: { patch },
  api: { patch },
}));

import {
  usePublishExam,
  useUpdateExam,
  useUpdateExamStatus,
} from "./use-assessment";

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
 * The exam's detail page reads `["exam", id]`. Refreshing only `["exams"]`
 * left it showing "Draft" and the Publish button after a successful publish.
 */
describe("exam mutations refresh the exam's own page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patch.mockResolvedValue({ data: { data: { id: "e-1" } } });
  });

  it("publishing", async () => {
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => usePublishExam(), { wrapper });
    await result.current.mutateAsync("e-1");
    expect(patch).toHaveBeenCalledWith("/assessment/exams/e-1/status", {
      status: "SCHEDULED",
    });
    await waitFor(() =>
      expect(keys(invalidate)).toEqual(
        expect.arrayContaining([["exams"], ["exam", "e-1"]]),
      ),
    );
  });

  it("changing the status", async () => {
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useUpdateExamStatus(), { wrapper });
    await result.current.mutateAsync({
      id: "e-1",
      status: "COMPLETED" as never,
    });
    await waitFor(() =>
      expect(keys(invalidate)).toEqual(
        expect.arrayContaining([
          ["exam", "e-1"],
          ["exam-analytics", "e-1"],
        ]),
      ),
    );
  });

  it("editing", async () => {
    const { invalidate, wrapper } = setup();
    const { result } = renderHook(() => useUpdateExam(), { wrapper });
    await result.current.mutateAsync({ id: "e-1", data: {} as never });
    await waitFor(() =>
      expect(keys(invalidate)).toEqual(
        expect.arrayContaining([["exam", "e-1"]]),
      ),
    );
  });
});
