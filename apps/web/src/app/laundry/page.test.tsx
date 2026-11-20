import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "fs";
import { join } from "path";
import { LAUNDRY_STATUS_FLOW, LAUNDRY_STATUS_LABELS } from "@cipansor/shared";

/**
 * `/laundry` (#1010, R22.1–R22.12). The page used to call `fetch` directly — no
 * CSRF header, so every write was refused — and read columns the API never
 * sends. These tests pin the page to the hooks and to the columns the API
 * really returns, and pin the status menu to `LAUNDRY_STATUS_FLOW`, the table
 * the API validates against.
 */

const {
  useLaundryTransactions,
  useLaundryTransaction,
  useLaundryStats,
  useLaundryPricing,
  useUpdateLaundryStatus,
  useCreateLaundryTransaction,
  useCreateLaundryPricing,
  useUpdateLaundryPricing,
  useDeleteLaundryPricing,
  useStudents,
} = vi.hoisted(() => ({
  useLaundryTransactions: vi.fn(),
  useLaundryTransaction: vi.fn(),
  useLaundryStats: vi.fn(),
  useLaundryPricing: vi.fn(),
  useUpdateLaundryStatus: vi.fn(),
  useCreateLaundryTransaction: vi.fn(),
  useCreateLaundryPricing: vi.fn(),
  useUpdateLaundryPricing: vi.fn(),
  useDeleteLaundryPricing: vi.fn(),
  useStudents: vi.fn(),
}));

vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/hooks/use-laundry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/use-laundry")>();
  return {
    ...actual,
    useLaundryTransactions,
    useLaundryTransaction,
    useLaundryStats,
    useLaundryPricing,
    useUpdateLaundryStatus,
    useCreateLaundryTransaction,
    useCreateLaundryPricing,
    useUpdateLaundryPricing,
    useDeleteLaundryPricing,
  };
});

vi.mock("@/hooks/use-students", () => ({ useStudents }));

import LaundryPage from "./page";

/** One transaction as `GET /laundry/transactions` sends it. */
const transaction = (over: Record<string, unknown> = {}) => ({
  id: "tx-1",
  transactionNo: "LDR-20261120-0001",
  unitId: "unit-smp",
  businessUnitId: null,
  studentId: "std-1",
  weight: "3.5",
  pricePerKg: "6000",
  subtotal: "21000",
  discount: "0",
  total: "21000",
  paymentMethod: "CASH",
  paymentStatus: "PAID",
  status: "RECEIVED",
  receivedAt: "2026-11-20T02:00:00.000Z",
  estimatedAt: "2026-11-22T02:00:00.000Z",
  readyAt: null,
  deliveredAt: null,
  notes: null,
  createdAt: "2026-11-20T02:00:00.000Z",
  updatedAt: "2026-11-20T02:00:00.000Z",
  student: { id: "std-1", nis: "2024001", user: { name: "Ahmad Fauzi" } },
  items: [
    { id: "i1", itemType: "Seragam", quantity: 3, notes: null },
    { id: "i2", itemType: "Kaos", quantity: 2, notes: null },
  ],
  ...over,
});

const listResult = (rows: unknown[]) => ({
  data: {
    data: rows,
    pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 },
  },
  isLoading: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  useLaundryTransactions.mockReturnValue(listResult([transaction()]));
  useLaundryTransaction.mockReturnValue({
    data: transaction(),
    isLoading: false,
  });
  useLaundryStats.mockReturnValue({
    data: {
      period: { startDate: "2026-11-20", endDate: "2026-11-20" },
      summary: {
        totalRevenue: 21000,
        totalWeight: 3.5,
        totalTransactions: 1,
        pendingPayments: 0,
        pendingPickup: 2,
      },
      statusBreakdown: [
        { status: "WASHING", count: 2 },
        { status: "DRYING", count: 1 },
      ],
    },
  });
  useLaundryPricing.mockReturnValue({ data: [], isLoading: false });
  useStudents.mockReturnValue({ data: { data: [] } });
  useUpdateLaundryStatus.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  useCreateLaundryTransaction.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  useCreateLaundryPricing.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  useUpdateLaundryPricing.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  useDeleteLaundryPricing.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
});

describe("Laundry — the page calls the API only through hooks (R22.1)", () => {
  it("has no fetch call of its own", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/NEXT_PUBLIC_API_URL/);
  });
});

describe("Laundry — the columns the API sends (R22.2, R22.5)", () => {
  it("shows transactionNo, the santri name from student.user.name, and the total", () => {
    render(<LaundryPage />);

    expect(screen.getByText("LDR-20261120-0001")).toBeInTheDocument();
    expect(screen.getByText("Ahmad Fauzi")).toBeInTheDocument();
    expect(screen.getByText("2024001")).toBeInTheDocument();
    expect(screen.getAllByText(/21\.000/).length).toBeGreaterThan(0);
  });

  it("counts the pieces from items[].quantity — 5 here, not a `totalItems` field", () => {
    render(<LaundryPage />);
    expect(screen.getByText("5 item")).toBeInTheDocument();
  });

  it("shows 0 item when the API sends no items", () => {
    useLaundryTransactions.mockReturnValue(
      listResult([transaction({ items: [] })]),
    );
    render(<LaundryPage />);
    expect(screen.getByText("0 item")).toBeInTheDocument();
  });

  it("labels the status and the payment in Indonesian, never the raw code", () => {
    useLaundryTransactions.mockReturnValue(
      listResult([transaction({ status: "DRYING", paymentStatus: "UNPAID" })]),
    );
    render(<LaundryPage />);

    expect(screen.getByText(LAUNDRY_STATUS_LABELS.DRYING)).toBeInTheDocument();
    expect(screen.getByText("Belum Dibayar")).toBeInTheDocument();
    expect(screen.queryByText("DRYING")).not.toBeInTheDocument();
    expect(screen.queryByText("PENDING")).not.toBeInTheDocument();
  });

  it("asks the API for the search text and the status filter", async () => {
    render(<LaundryPage />);

    await userEvent.type(screen.getByLabelText("Cari transaksi"), "Fauzi");
    const lastCall = useLaundryTransactions.mock.calls.at(-1)![0];
    expect(lastCall.search).toBe("Fauzi");
  });
});

describe("Laundry — the summary cards read /transactions/stats (R22.10)", () => {
  it("shows the API's figures, not a count over one page", () => {
    render(<LaundryPage />);

    const card = (title: string) =>
      Array.from(document.querySelectorAll('[data-slot="card"]')).find(
        (node) =>
          node.querySelector('[data-slot="card-title"]')?.textContent === title,
      ) as HTMLElement;

    // totalTransactions = 1
    expect(within(card("Transaksi")).getByText("1")).toBeInTheDocument();
    // WASHING 2 + DRYING 1 = 3 in progress.
    expect(within(card("Diproses")).getByText("3")).toBeInTheDocument();
    // pendingPickup = 2
    expect(within(card("Siap Ambil")).getByText("2")).toBeInTheDocument();
    expect(within(card("Pendapatan")).getByText(/21\.000/)).toBeInTheDocument();
  });
});

describe("Laundry — the status menu comes from LAUNDRY_STATUS_FLOW (R22.3, R22.6)", () => {
  it("offers exactly the flow's targets for RECEIVED", async () => {
    render(<LaundryPage />);
    await userEvent.click(screen.getByLabelText("Lihat detail"));

    for (const target of LAUNDRY_STATUS_FLOW.RECEIVED) {
      expect(
        screen.getByRole("button", { name: LAUNDRY_STATUS_LABELS[target] }),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByRole("button", { name: LAUNDRY_STATUS_LABELS.DELIVERED }),
    ).not.toBeInTheDocument();
  });

  it("offers nothing for a DELIVERED transaction", async () => {
    useLaundryTransaction.mockReturnValue({
      data: transaction({ status: "DELIVERED" }),
      isLoading: false,
    });
    render(<LaundryPage />);
    await userEvent.click(screen.getByLabelText("Lihat detail"));

    expect(screen.getByText(/tidak ada status lanjutan/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: LAUNDRY_STATUS_LABELS.CANCELLED }),
    ).not.toBeInTheDocument();
  });

  it("sends the chosen target through the hook", async () => {
    const mutate = vi.fn();
    useUpdateLaundryStatus.mockReturnValue({ mutate, isPending: false });
    render(<LaundryPage />);
    await userEvent.click(screen.getByLabelText("Lihat detail"));
    await userEvent.click(
      screen.getByRole("button", { name: LAUNDRY_STATUS_LABELS.WASHING }),
    );

    expect(mutate).toHaveBeenCalledWith(
      { id: "tx-1", status: "WASHING" },
      expect.anything(),
    );
  });

  it("shows an Indonesian error and keeps the old status when the API refuses (R22.7)", async () => {
    const mutate = vi.fn((_vars, options) => {
      options?.onError?.({
        isAxiosError: true,
        response: {
          status: 409,
          data: { message: "Status tidak dapat diubah dari RECEIVED ke READY" },
        },
      });
    });
    useUpdateLaundryStatus.mockReturnValue({ mutate, isPending: false });
    render(<LaundryPage />);
    await userEvent.click(screen.getByLabelText("Lihat detail"));

    /** The status badge of the detail dialog — not a button of the menu. */
    const statusBadge = () =>
      document.querySelector('[data-slot="badge"].bg-yellow-100');
    expect(statusBadge()?.textContent).toBe(LAUNDRY_STATUS_LABELS.RECEIVED);

    await userEvent.click(
      screen.getByRole("button", { name: LAUNDRY_STATUS_LABELS.WASHING }),
    );

    // The dialog still shows the status it had — nothing was written to the
    // cache before the API answered.
    expect(statusBadge()?.textContent).toBe(LAUNDRY_STATUS_LABELS.RECEIVED);
    expect(
      document.querySelector('[data-slot="badge"].bg-blue-100'),
    ).toBeNull();
  });
});

describe("Laundry — the tarif tab uses the per-kilogram contract (R22.8)", () => {
  it("shows name, pricePerKg, minWeight and processDays", async () => {
    useLaundryPricing.mockReturnValue({
      data: [
        {
          id: "p1",
          unitId: "unit-smp",
          businessUnitId: null,
          name: "Cuci Setrika Reguler",
          description: null,
          pricePerKg: "6000",
          minWeight: "1",
          processDays: 2,
          isExpress: false,
          isActive: true,
          createdAt: "2026-11-20T00:00:00.000Z",
          updatedAt: "2026-11-20T00:00:00.000Z",
        },
      ],
      isLoading: false,
    });
    render(<LaundryPage />);
    await userEvent.click(screen.getByRole("tab", { name: /Tarif/ }));

    expect(await screen.findByText("Cuci Setrika Reguler")).toBeInTheDocument();
    expect(screen.getByText("1 kg")).toBeInTheDocument();
    expect(screen.getByText("2 hari")).toBeInTheDocument();
    expect(screen.getByText(/6\.000/)).toBeInTheDocument();
  });
});
