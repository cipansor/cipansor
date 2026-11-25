import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/api", () => {
  const api = { get };
  return { api, default: api };
});

import { useExamDifficultyInsights } from "./use-cbt";

function wrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useExamDifficultyInsights", () => {
  it("returns null when the exam has no question bank", async () => {
    // The service returns null for an exam without a question bank; parsing
    // null would throw a ZodError and hide the deliberate empty state.
    get.mockResolvedValue({ data: { data: null } });
    const client = makeClient();
    const { result } = renderHook(() => useExamDifficultyInsights("exam-1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it("parses a valid insights response with the shared schema", async () => {
    get.mockResolvedValue({
      data: {
        data: {
          examId: "exam-1",
          title: "Ulangan",
          questionInsights: [],
          averageSuccessRate: 75,
          totalParticipants: 12,
          discriminationGroupSize: 10,
        },
      },
    });
    const client = makeClient();
    const { result } = renderHook(() => useExamDifficultyInsights("exam-1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.examId).toBe("exam-1");
    expect(result.current.data?.averageSuccessRate).toBe(75);
  });
});
