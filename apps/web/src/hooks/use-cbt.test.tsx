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
  it("treats the controller's 404 as an empty analysis", async () => {
    // The controller answers 404 when the exam has no question bank or no
    // analysis yet; that is the response the portal actually receives.
    get.mockRejectedValue({ response: { status: 404 } });
    const client = makeClient();
    const { result } = renderHook(() => useExamDifficultyInsights("exam-1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(get).toHaveBeenCalledWith("/cbt/exams/exam-1/difficulty-insights", {
      skipErrorToastForStatus: [404],
    });
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

  it("accepts an option whose id is null but optionId is present", async () => {
    const option = { id: null, optionId: "A", text: "Jakarta" };
    get.mockResolvedValue({
      data: {
        data: {
          examId: "exam-1",
          title: "Ulangan",
          questionInsights: [
            {
              questionId: "question-1",
              content: "Ibu kota Indonesia?",
              successRate: 50,
              difficultyIndex: 0.5,
              discriminationIndex: null,
              totalGraded: 2,
              isKiller: false,
              needsReview: false,
              distractorAnalysis: [
                {
                  optionId: "A",
                  option,
                  options: [option],
                  ambiguous: false,
                  count: 1,
                  percentage: 100,
                },
              ],
            },
          ],
          averageSuccessRate: 50,
          totalParticipants: 2,
          discriminationGroupSize: null,
        },
      },
    });
    const client = makeClient();
    const { result } = renderHook(() => useExamDifficultyInsights("exam-1"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const row =
      result.current.data?.questionInsights[0].distractorAnalysis?.[0];
    expect(row?.option).toMatchObject({ optionId: "A", text: "Jakarta" });
  });
});
