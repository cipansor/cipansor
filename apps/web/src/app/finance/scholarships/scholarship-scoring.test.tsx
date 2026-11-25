import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/**
 * Skor beasiswa on the recipient dialog (#1003).
 *
 * The three things the screen must not get wrong: the button exists only for a
 * finance-unit role of the program's own unit (R11.10, R11.11, R11.14); the
 * result it shows is the API's, with the excluded criteria named rather than
 * scored 0 (R11.5); and a failed call says the score was not computed instead of
 * leaving a stale one on screen (R11.9).
 */
const { mocks } = vi.hoisted(() => ({
  mocks: {
    user: null as unknown,
    recipients: { data: [] as unknown[], isLoading: false },
    criteria: [] as unknown[],
    criteriaFailed: false,
    createCriterion: vi.fn(async () => ({})),
    assess: vi.fn(async () => ({})),
    assessState: {
      isPending: false,
      variables: undefined as string | undefined,
    },
  },
}));

vi.mock("@/hooks/use-auth", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/use-units", () => ({ useUnits: () => ({ data: undefined }) }));
vi.mock("@/hooks/use-students", () => ({
  useStudents: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-academic-years", () => ({
  useAcademicYears: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-finance-enhancement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-finance-enhancement")>()),
  useScholarships: () => ({
    data: { data: [] },
    isLoading: false,
    refetch: vi.fn(),
  }),
  useCreateScholarship: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAssignScholarship: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useScholarshipRecipients: () => ({
    data: mocks.recipients,
    isLoading: mocks.recipients.isLoading,
  }),
  useScholarshipCriteria: () => ({
    data: mocks.criteria,
    isLoading: false,
    isError: mocks.criteriaFailed,
  }),
  useCreateScholarshipCriterion: () => ({
    mutateAsync: mocks.createCriterion,
    isPending: false,
  }),
  useAssessScholarshipRecipient: () => ({
    mutateAsync: mocks.assess,
    isPending: mocks.assessState.isPending,
    variables: mocks.assessState.variables,
  }),
}));

import { RecipientsDialog, canScoreProgram } from "./page";

const program = {
  id: "sch-1",
  name: "Beasiswa Santri Huffadz",
  unitId: "unit-sd",
  source: "YAYASAN",
  type: "FULL",
  startDate: "2026-07-01",
  isActive: true,
} as never;

const recipient = {
  id: "rec-1",
  scholarshipId: "sch-1",
  studentId: "stu-1",
  academicYearId: "ay-1",
  startDate: "2026-07-01",
  status: "ACTIVE",
  student: { name: "Muhammad Rizky", nis: "20240001", class: "VII A" },
  academicYear: { id: "ay-1", name: "2026/2027" },
} as never;

function asRole(
  roleCode: string,
  unitId: string | undefined = "unit-sd",
  assignmentUnitId?: string,
) {
  mocks.user = {
    id: "u-1",
    unitId,
    userRoles: [
      {
        isPrimary: true,
        role: { code: roleCode },
        unit: assignmentUnitId ? { id: assignmentUnitId } : undefined,
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recipients = { data: [recipient], isLoading: false };
  mocks.criteria = [];
  mocks.criteriaFailed = false;
  mocks.assessState = { isPending: false, variables: undefined };
  asRole("SDIT_BENDAHARA");
});

describe("canScoreProgram", () => {
  it("allows a finance-unit role of the program's own unit", () => {
    expect(canScoreProgram("SDIT_BENDAHARA", "unit-sd", "unit-sd")).toBe(true);
    expect(canScoreProgram("SDIT_ADMIN", "unit-sd", "unit-sd")).toBe(true);
  });

  it("refuses a finance role of another unit", () => {
    expect(canScoreProgram("SDIT_BENDAHARA", "unit-sd", "unit-smp")).toBe(
      false,
    );
  });

  it("refuses a non-finance role, even in its own unit", () => {
    expect(canScoreProgram("SDIT_TATA_USAHA", "unit-sd", "unit-sd")).toBe(
      false,
    );
    expect(canScoreProgram("SDIT_GURU", "unit-sd", "unit-sd")).toBe(false);
    expect(canScoreProgram("YAYASAN_KETUA", null, "unit-sd")).toBe(false);
  });

  it("lets a Super Admin score any unit", () => {
    expect(canScoreProgram("SUPER_ADMIN", null, "unit-smp")).toBe(true);
  });
});

describe("RecipientsDialog — scoring", () => {
  it("offers 'Hitung skor' to the unit's finance admin (R11.10, R11.11)", () => {
    render(<RecipientsDialog scholarship={program} onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: /hitung skor/i })).toBeDefined();
  });

  it("hides the action from a role that may not score (R11.11, R11.14)", () => {
    asRole("SDIT_GURU");
    render(<RecipientsDialog scholarship={program} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /hitung skor/i })).toBeNull();
  });

  it("hides the action from a finance role of a different unit", () => {
    asRole("SMPIT_BENDAHARA", "unit-smp");
    render(<RecipientsDialog scholarship={program} onClose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /hitung skor/i })).toBeNull();
  });

  it("reads the unit from the active assignment, not the profile's home unit", () => {
    // Home unit SD IT, switched to Bendahara of SMP IT: the API token carries
    // the assignment's unit, so the action must follow it.
    asRole("SMPIT_BENDAHARA", "unit-sd", "unit-smp");
    render(
      <RecipientsDialog
        scholarship={
          {
            ...(program as unknown as Record<string, unknown>),
            unitId: "unit-smp",
          } as never
        }
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /hitung skor/i })).toBeDefined();
  });

  it("shows the stored score to a reviewer who may not compute one", () => {
    asRole("YAYASAN_KETUA", undefined);
    mocks.recipients = {
      data: [
        {
          ...(recipient as unknown as Record<string, unknown>),
          totalScore: 95,
          assessments: [
            {
              criterionId: "c1",
              name: "Hafalan Al-Quran",
              weight: 3,
              value: "10",
              score: 100,
              excluded: false,
            },
            {
              criterionId: "c2",
              name: "Wawancara",
              weight: 1,
              value: "MANUAL_REQUIRED",
              score: null,
              excluded: true,
            },
          ],
        },
      ],
      isLoading: false,
    };

    render(<RecipientsDialog scholarship={program} onClose={vi.fn()} />);

    expect(screen.getByText(/Skor total: 95\.0/)).toBeDefined();
    expect(screen.getByText(/Perlu dinilai manual — -/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /hitung skor/i })).toBeNull();
  });

  it("says a program has no criteria rather than offering a meaningless score (R11.13)", () => {
    render(<RecipientsDialog scholarship={program} onClose={vi.fn()} />);
    expect(
      screen.getAllByText(/belum memiliki kriteria penilaian/i).length,
    ).toBeGreaterThan(0);
  });

  it("says the criteria could not be read, not that the program has none", () => {
    asRole("SMPIT_TATA_USAHA", "unit-smp");
    mocks.criteriaFailed = true;
    render(<RecipientsDialog scholarship={program} onClose={vi.fn()} />);
    expect(
      screen.getByText(/kriteria tidak dapat ditampilkan untuk akun ini/i),
    ).toBeDefined();
    expect(screen.queryByText(/belum memiliki kriteria penilaian/i)).toBeNull();
  });

  it("shows each criterion's score and the total the API answered (R11.4, R11.5)", async () => {
    mocks.assess.mockResolvedValue({
      criteria: [
        {
          criterionId: "c1",
          name: "Hafalan Al-Quran",
          weight: 3,
          value: "10",
          score: 100,
          excluded: false,
        },
        {
          criterionId: "c2",
          name: "Penghasilan Orang Tua",
          weight: 1,
          value: "RANGE_1JT_2JT",
          score: 80,
          excluded: false,
        },
        {
          criterionId: "c3",
          name: "Wawancara",
          weight: 2,
          value: "MANUAL_REQUIRED",
          score: null,
          excluded: true,
        },
      ],
      totalScore: 95,
      complete: false,
    });

    render(<RecipientsDialog scholarship={program} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /hitung skor/i }));

    expect(await screen.findByText(/Skor total: 95\.0/)).toBeDefined();
    expect(screen.getByText(/Rp1\.000\.000–Rp2\.000\.000/)).toBeDefined();
    // The excluded criterion is named, not shown as 0 (R11.5).
    expect(screen.getByText(/Perlu dinilai manual — -/)).toBeDefined();
    expect(screen.getByText("belum lengkap")).toBeDefined();
  });

  it("says the score was not computed when the call fails, keeping no stale result (R11.9)", async () => {
    mocks.assess.mockRejectedValue(new Error("boom"));

    render(<RecipientsDialog scholarship={program} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /hitung skor/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Skor tidak dihitung/,
    );
    expect(screen.queryByText(/Skor total:/)).toBeNull();
  });

  it("sends only the criterion's name, weight and target when adding one (R11.13)", async () => {
    mocks.criteria = [
      {
        id: "c1",
        scholarshipId: "sch-1",
        name: "Hafalan",
        weight: 3,
        type: "NUMERIC",
        targetValue: "30",
      },
    ];

    render(<RecipientsDialog scholarship={program} onClose={vi.fn()} />);

    fireEvent.change(screen.getByLabelText(/nama kriteria/i), {
      target: { value: "Nilai Akademik" },
    });
    fireEvent.change(screen.getByLabelText(/bobot/i), {
      target: { value: "2" },
    });
    fireEvent.change(screen.getByLabelText(/target/i), {
      target: { value: "100" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: /tambah kriteria/i }).closest("form")!,
    );

    await waitFor(() =>
      expect(mocks.createCriterion).toHaveBeenCalledWith({
        name: "Nilai Akademik",
        weight: 2,
        type: "NUMERIC",
        targetValue: "100",
      }),
    );
  });

  it("disables only the recipient being scored", () => {
    mocks.assessState = { isPending: true, variables: "rec-1" };
    render(<RecipientsDialog scholarship={program} onClose={vi.fn()} />);
    expect(
      screen
        .getByRole("button", { name: /hitung skor/i })
        .hasAttribute("disabled"),
    ).toBe(true);
  });
});
