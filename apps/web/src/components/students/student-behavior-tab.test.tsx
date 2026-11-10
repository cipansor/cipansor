import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const useStudentBehaviorStats = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-students", () => ({ useStudentBehaviorStats }));

import { StudentBehaviorTab } from "./student-behavior-tab";

describe("StudentBehaviorTab", () => {
  beforeEach(() => vi.clearAllMocks());

  it("says the record failed to load instead of showing a clean record", () => {
    useStudentBehaviorStats.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });
    render(<StudentBehaviorTab studentId="s-1" />);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(
      screen.queryByText("Belum ada pelanggaran tercatat."),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Poin pelanggaran")).not.toBeInTheDocument();
  });

  it("shows the figures the summaries returned", () => {
    useStudentBehaviorStats.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        violationPoints: 15,
        rewardPoints: 40,
        totalViolations: 2,
        totalRewards: 3,
        recentViolations: [
          {
            id: "v-1",
            type: "MODERATE",
            category: "ketertiban",
            description: "Terlambat",
            occurredAt: "2026-10-01T01:00:00Z",
            points: 10,
          },
        ],
        recentRewards: [],
      },
    });
    render(<StudentBehaviorTab studentId="s-1" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText("ketertiban")).toBeInTheDocument();
    expect(screen.getByText("Sedang")).toBeInTheDocument();
  });
});
