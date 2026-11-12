import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
const hookCalls = vi.hoisted(() => ({ children: 0, dashboard: 0 }));

vi.mock("@/lib/api", () => {
  const api = { get };
  return { api, default: api };
});

// The page must read through these hooks (#869 review); a bare `api.get` in a
// `useEffect` leaves both counters at 0 and the test below fails.
vi.mock("@/hooks/use-parent-portal", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/hooks/use-parent-portal")>();
  return {
    ...actual,
    useParentChildren: (
      ...args: Parameters<typeof actual.useParentChildren>
    ) => {
      hookCalls.children += 1;
      return actual.useParentChildren(...args);
    },
    useParentDashboard: (
      ...args: Parameters<typeof actual.useParentDashboard>
    ) => {
      hookCalls.dashboard += 1;
      return actual.useParentDashboard(...args);
    },
  };
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

/**
 * The page reads its data through `useParentChildren` / `useParentDashboard`
 * (the React Query hooks), not a bare `api.get` in a `useEffect` (#869 review):
 * the render below mounts a real `QueryClient` so the hooks run for real.
 */
function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(<ParentDashboardPage />, { wrapper });
}

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
          lastTahfidz: { id: "t1", studentId: "s1", juz: 30 },
          memorizedJuz: 5,
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
  hookCalls.children = 0;
  hookCalls.dashboard = 0;
});

describe("beranda wali menampilkan angka yang benar-benar dikirim API (#869)", () => {
  it("mengambil data lewat hook React Query, bukan `api.get` langsung (#869 review)", async () => {
    mockApi(dashboard());
    renderPage();
    await waitFor(() => expect(screen.getByText("Ahmad")).toBeDefined());

    expect(hookCalls.children).toBeGreaterThan(0);
    expect(hookCalls.dashboard).toBeGreaterThan(0);
  });

  it("membaca ringkasan per anak dari `child.id`, bukan `studentId`", async () => {
    mockApi(dashboard());
    renderPage();
    await waitFor(() => expect(screen.getByText("Ahmad")).toBeDefined());

    // A wrong key (`c.studentId`) leaves every figure at its fallback.
    expect(screen.getByText(/Tahfidz:/).textContent).toContain("5");
  });

  it("menampilkan juz tahfidz, skor holistik, kerukunan asrama, dan tagihan", async () => {
    mockApi(dashboard());
    renderPage();
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

  it("menampilkan hafalan (memorizedJuz), bukan nomor juz setoran terakhir (#869 review)", async () => {
    // The last setoran sits in juz 30 but the santri has memorized 5 juz; the
    // card must read the aggregate, never the setoran's juz number.
    mockApi(
      dashboard({
        lastTahfidz: { id: "t1", studentId: "s1", juz: 30 },
        memorizedJuz: 5,
      }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByText("Ahmad")).toBeDefined());

    const line = screen.getByText(/Tahfidz:/).textContent ?? "";
    expect(line).toContain("5 Juz");
    expect(line).not.toContain("30");
  });

  it("menampilkan '–' pada Tahfidz bila belum ada catatan ziyadah (#869 review)", async () => {
    mockApi(dashboard({ memorizedJuz: null }));
    renderPage();
    await waitFor(() => expect(screen.getByText("Ahmad")).toBeDefined());

    const line = screen.getByText(/Tahfidz:/).textContent ?? "";
    expect(line).toContain("—");
    expect(line).not.toContain("0 Juz");
  });

  it("menghitung kehadiran dari baris absensi (PRESENT / total)", async () => {
    mockApi(dashboard());
    renderPage();
    await waitFor(() => expect(screen.getByText("Ahmad")).toBeDefined());

    // 2 of 3 rows PRESENT → 67%.
    expect(screen.getByText(/Kehadiran:/).textContent).toContain("67%");
  });

  it("tidak menampilkan tile Kerukunan Asrama untuk anak tanpa asrama", async () => {
    mockApi(dashboard({ boardingHarmonyScore: null }));
    renderPage();
    await waitFor(() => expect(screen.getByText("Ahmad")).toBeDefined());

    expect(screen.queryByText(/Kerukunan Asrama/)).toBeNull();
  });

  it("menampilkan '–' pada Skor Holistik bila API tidak menghasilkannya", async () => {
    mockApi(dashboard({ holisticScore: null }));
    renderPage();
    await waitFor(() => expect(screen.getByText("Ahmad")).toBeDefined());

    expect(
      screen.getByText(/Skor Holistik/).parentElement?.textContent,
    ).toContain("—");
  });

  it("menampilkan '–' pada Kehadiran bila belum ada catatan absensi", async () => {
    mockApi(dashboard({ recentAttendance: [] }));
    renderPage();
    await waitFor(() => expect(screen.getByText("Ahmad")).toBeDefined());

    // "no records" must not read as "never came" (0%).
    const line = screen.getByText(/Kehadiran:/).textContent ?? "";
    expect(line).toContain("—");
    expect(line).not.toContain("0%");
  });
});
