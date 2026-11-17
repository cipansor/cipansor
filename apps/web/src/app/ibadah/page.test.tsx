import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * The Jurnal Ibadah (`/ibadah`) table reads a row's santri from what the API
 * actually sends (`ibadah.service.ts` selects `id`, `nis` and `user.name` only)
 * and "Total Catatan" from `meta.pagination.total` (#732, #974, #989). The name
 * used to be read from `student.name` — a field the API never sends — so every
 * row printed "-", and the total was read from a flat `meta.total`, which is
 * undefined. These tests pin both, plus the rule that NIS and class show only
 * when the API sends them.
 */
const {
  useIbadahRecords,
  useIbadahTargets,
  useIbadahLeaderboard,
  useDeleteIbadahRecord,
  useDeleteIbadahTarget,
  useUnits,
} = vi.hoisted(() => ({
  useIbadahRecords: vi.fn(),
  useIbadahTargets: vi.fn(),
  useIbadahLeaderboard: vi.fn(),
  useDeleteIbadahRecord: vi.fn(),
  useDeleteIbadahTarget: vi.fn(),
  useUnits: vi.fn(),
}));

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/hooks/use-ibadah", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-ibadah")>();
  return {
    ...actual,
    useIbadahRecords,
    useIbadahTargets,
    useIbadahLeaderboard,
    useDeleteIbadahRecord,
    useDeleteIbadahTarget,
  };
});

vi.mock("@/hooks/use-units", () => ({ useUnits }));

import IbadahPage from "./page";

/** One record as the API sends it: name under `user.name`, NIS, class name. */
const record = (over: Record<string, unknown> = {}) => ({
  id: "rec-1",
  date: "2026-11-16T00:00:00.000Z",
  isCompleted: true,
  pointsEarned: 10,
  verificationStatus: "VERIFIED",
  target: { name: "Sholat Subuh", category: "SHOLAT", points: 10 },
  student: {
    id: "std-1",
    nis: "2024001",
    user: { name: "Ahmad Fauzi" },
    class: { name: "7A" },
  },
  ...over,
});

const recordsResult = (data: unknown[], total: number) => ({
  data: {
    data,
    meta: { pagination: { page: 1, limit: 20, total, totalPages: 1 } },
  },
  isLoading: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  useUnits.mockReturnValue({ data: [{ id: "u1", name: "SMP IT" }] });
  useIbadahTargets.mockReturnValue({ data: { data: [] }, isLoading: false });
  useIbadahLeaderboard.mockReturnValue({ data: [], isLoading: false });
  useDeleteIbadahRecord.mockReturnValue({ mutateAsync: vi.fn() });
  useDeleteIbadahTarget.mockReturnValue({ mutateAsync: vi.fn() });
});

describe("Jurnal Ibadah — the santri column", () => {
  it("shows the santri name from student.user.name", () => {
    useIbadahRecords.mockReturnValue(recordsResult([record()], 1));
    render(<IbadahPage />);

    expect(screen.getByText("Ahmad Fauzi")).toBeInTheDocument();
  });

  it("shows NIS and class when the API sends them", () => {
    useIbadahRecords.mockReturnValue(recordsResult([record()], 1));
    render(<IbadahPage />);

    expect(screen.getByText("2024001 • 7A")).toBeInTheDocument();
  });

  it("shows only what the API sent — no stray separator when class is absent", () => {
    useIbadahRecords.mockReturnValue(
      recordsResult(
        [
          record({
            student: { id: "std-2", nis: "2024002", user: { name: "Bilal" } },
          }),
        ],
        1,
      ),
    );
    render(<IbadahPage />);

    expect(screen.getByText("2024002")).toBeInTheDocument();
    expect(screen.queryByText(/2024002 •/)).not.toBeInTheDocument();
  });
});

describe("Jurnal Ibadah — Total Catatan", () => {
  it("reads the total from meta.pagination.total", () => {
    useIbadahRecords.mockReturnValue(recordsResult([record()], 42));
    render(<IbadahPage />);

    const totalCard = screen
      .getByText("Total Catatan")
      .closest('[data-slot="card-content"]') as HTMLElement;
    expect(within(totalCard).getByText("42")).toBeInTheDocument();
  });

  it("shows 0, not NaN, when the list is empty", () => {
    useIbadahRecords.mockReturnValue(recordsResult([], 0));
    render(<IbadahPage />);

    const totalCard = screen
      .getByText("Total Catatan")
      .closest('[data-slot="card-content"]') as HTMLElement;
    expect(within(totalCard).getByText("0")).toBeInTheDocument();
    expect(screen.queryByText("NaN")).not.toBeInTheDocument();
  });
});
