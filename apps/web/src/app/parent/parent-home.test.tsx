import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock("@/lib/api", () => {
  const api = { get };
  return { api, default: api };
});

vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({
    user: { id: "p1", name: "Bapak Wali", role: "PARENT" },
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

import ParentDashboardPage from "./page";

/** `GET /parent/children` — one child, the student id on `id` (K13). */
const childrenRes = {
  success: true,
  data: [
    {
      id: "s1",
      name: "Ahmad",
      nis: "20240001",
      currentClass: { id: "c1", name: "6A", level: "6" },
    },
  ],
};

/** `GET /parent/dashboard` — the canonical shape from `parent.service.ts`. */
function dashboard(over: Record<string, unknown> = {}) {
  return {
    success: true,
    data: {
      children: [
        {
          child: { id: "s1", name: "Ahmad", nis: "20240001" },
          recentAttendance: [
            { id: "a1", studentId: "s1", status: "PRESENT" },
            { id: "a2", studentId: "s1", status: "PRESENT" },
            { id: "a3", studentId: "s1", status: "SICK" },
          ],
          pendingInvoices: 2,
          activePermits: 0,
          lastTahfidz: { id: "t1", studentId: "s1", juz: 5 },
          holisticScore: 88.5,
          holisticInterpretation: null,
          boardingHarmonyScore: 91,
          ...over,
        },
      ],
      unreadNotifications: 0,
      recentAnnouncements: [],
    },
  };
}

function mockApi(payload: unknown) {
  get.mockImplementation((url: string) =>
    Promise.resolve({
      data: url === "/parent/children" ? childrenRes : payload,
    }),
  );
}

beforeEach(() => {
  get.mockReset();
});

describe("beranda wali menampilkan angka yang benar-benar dikirim API (#869)", () => {
  it("membaca ringkasan per anak dari `child.id`, bukan `studentId`", async () => {
    mockApi(dashboard());
    render(<ParentDashboardPage />);
    await waitFor(() => expect(screen.getByText("Ahmad")).toBeDefined());

    // A wrong key (`c.studentId`) leaves every figure at its fallback.
    expect(screen.getByText(/Tahfidz:/).textContent).toContain("5");
  });

  it("menampilkan juz tahfidz, skor holistik, kerukunan asrama, dan tagihan", async () => {
    mockApi(dashboard());
    render(<ParentDashboardPage />);
    await waitFor(() => expect(screen.getByText("Ahmad")).toBeDefined());

    expect(screen.getByText(/Tahfidz:/).textContent).toContain("5");
    expect(
      screen.getByText(/Skor Holistik/).parentElement?.textContent,
    ).toContain("88.5");
    expect(
      screen.getByText(/Kerukunan Asrama/).parentElement?.textContent,
    ).toContain("91");
    expect(screen.getByText(/tagihan belum lunas/)).toBeDefined();
  });

  it("menghitung kehadiran dari baris absensi (PRESENT / total)", async () => {
    mockApi(dashboard());
    render(<ParentDashboardPage />);
    await waitFor(() => expect(screen.getByText("Ahmad")).toBeDefined());

    // 2 of 3 rows PRESENT → 67%.
    expect(screen.getByText(/Kehadiran:/).textContent).toContain("67%");
  });

  it("tidak menampilkan tile Kerukunan Asrama untuk anak tanpa asrama", async () => {
    mockApi(dashboard({ boardingHarmonyScore: null }));
    render(<ParentDashboardPage />);
    await waitFor(() => expect(screen.getByText("Ahmad")).toBeDefined());

    expect(screen.queryByText(/Kerukunan Asrama/)).toBeNull();
  });

  it("menampilkan '–' pada Skor Holistik bila API tidak menghasilkannya", async () => {
    mockApi(dashboard({ holisticScore: null }));
    render(<ParentDashboardPage />);
    await waitFor(() => expect(screen.getByText("Ahmad")).toBeDefined());

    expect(
      screen.getByText(/Skor Holistik/).parentElement?.textContent,
    ).toContain("—");
  });

  it("menampilkan '–' pada Kehadiran bila belum ada catatan absensi", async () => {
    mockApi(dashboard({ recentAttendance: [] }));
    render(<ParentDashboardPage />);
    await waitFor(() => expect(screen.getByText("Ahmad")).toBeDefined());

    // "no records" must not read as "never came" (0%).
    const line = screen.getByText(/Kehadiran:/).textContent ?? "";
    expect(line).toContain("—");
    expect(line).not.toContain("0%");
  });
});
