import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterEach,
} from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "fs";
import { join } from "path";
import { LAUNDRY_STATUS_FLOW, LAUNDRY_STATUS_LABELS } from "@cipansor/shared";
import { toast } from "sonner";

// jsdom lacks the pointer-capture and scroll APIs Radix Select calls on open.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  vi.unstubAllGlobals();
});

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
  useProcessLaundryPayment,
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
  useProcessLaundryPayment: vi.fn(),
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
    useProcessLaundryPayment,
  };
});

vi.mock("@/hooks/use-students", () => ({ useStudents }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import LaundryPage from "./page";
import { useAuthStore } from "@/stores/auth";

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
  paidAt: "2026-11-20T02:00:00.000Z",
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
  useAuthStore.setState({
    user: {
      id: "u-admin",
      role: "STAFF",
      userRoles: [
        {
          isPrimary: true,
          role: { code: "SMPIT_ADMIN" },
          unit: { id: "unit-smp" },
        },
      ],
      unitId: "unit-smp",
    } as never,
  });
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
  useProcessLaundryPayment.mockReturnValue({
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
    // The officer is told why the move was refused, not just left staring at
    // an unchanged badge.
    expect(toast.error).toHaveBeenCalledWith(
      "Status tidak dapat diubah dari RECEIVED ke READY",
    );
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
          description: "Cuci dan setrika",
          pricePerKg: "6000",
          minWeight: "1",
          processDays: 2,
          isExpress: true,
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
    expect(screen.getByText("Cuci dan setrika")).toBeInTheDocument();
    expect(screen.getByText("1 kg")).toBeInTheDocument();
    expect(screen.getByText("2 hari")).toBeInTheDocument();
    expect(screen.getByText(/6\.000/)).toBeInTheDocument();
    expect(screen.getByText("Express")).toBeInTheDocument();
    expect(screen.getByText("Aktif")).toBeInTheDocument();
  });
});

const tier = {
  id: "p1",
  unitId: "unit-smp",
  businessUnitId: null,
  name: "Cuci Setrika Reguler",
  description: "Cuci dan setrika",
  pricePerKg: "6000",
  minWeight: "1",
  processDays: 2,
  isExpress: true,
  isActive: true,
  createdAt: "2026-11-20T00:00:00.000Z",
  updatedAt: "2026-11-20T00:00:00.000Z",
};

describe("Laundry — a cancellation is confirmed first", () => {
  it("does nothing when the officer declines the confirmation", async () => {
    const mutate = vi.fn();
    useUpdateLaundryStatus.mockReturnValue({ mutate, isPending: false });
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);

    render(<LaundryPage />);
    await userEvent.click(screen.getByLabelText("Lihat detail"));
    await userEvent.click(
      screen.getByRole("button", { name: LAUNDRY_STATUS_LABELS.CANCELLED }),
    );

    expect(confirm).toHaveBeenCalledWith("Batalkan transaksi ini?");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("sends the cancellation once the officer confirms", async () => {
    const mutate = vi.fn();
    useUpdateLaundryStatus.mockReturnValue({ mutate, isPending: false });
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );

    render(<LaundryPage />);
    await userEvent.click(screen.getByLabelText("Lihat detail"));
    await userEvent.click(
      screen.getByRole("button", { name: LAUNDRY_STATUS_LABELS.CANCELLED }),
    );

    expect(mutate).toHaveBeenCalledWith(
      { id: "tx-1", status: "CANCELLED" },
      expect.anything(),
    );
  });
});

describe("Laundry — a Bayar Nanti order can be settled", () => {
  it("offers settlement only while the order is unpaid", async () => {
    const mutate = vi.fn();
    useProcessLaundryPayment.mockReturnValue({ mutate, isPending: false });
    useLaundryTransaction.mockReturnValue({
      data: transaction({ paymentStatus: "UNPAID", paymentMethod: "PENDING" }),
      isLoading: false,
    });

    render(<LaundryPage />);
    await userEvent.click(screen.getByLabelText("Lihat detail"));
    await userEvent.click(screen.getByRole("button", { name: /Lunasi Tunai/ }));

    expect(mutate).toHaveBeenCalledWith(
      { id: "tx-1", paymentMethod: "CASH" },
      expect.anything(),
    );
  });

  it("shows no settlement action on a paid order", async () => {
    render(<LaundryPage />);
    await userEvent.click(screen.getByLabelText("Lihat detail"));

    expect(screen.queryByRole("button", { name: /Lunasi/ })).toBeNull();
  });

  it("shows no payment or status action to a read-only musyrif", async () => {
    useAuthStore.setState({
      user: {
        id: "u-musyrif",
        role: "STAFF",
        userRoles: [
          {
            isPrimary: true,
            role: { code: "MUSYRIF" },
            unit: { id: "unit-pesantren" },
          },
        ],
        unitId: "unit-pesantren",
      } as never,
    });
    useLaundryTransaction.mockReturnValue({
      data: transaction({ paymentStatus: "UNPAID", paymentMethod: "PENDING" }),
      isLoading: false,
    });

    render(<LaundryPage />);
    await userEvent.click(screen.getByLabelText("Lihat detail"));

    expect(screen.queryByRole("button", { name: /Lunasi/ })).toBeNull();
    expect(screen.queryByText("Ubah Status")).toBeNull();
  });

  it("uses the active role's unit when the profile has none", async () => {
    useAuthStore.setState({
      user: {
        id: "u-operator",
        role: "UNIT_ADMIN",
        userRoles: [
          {
            role: { code: "YAYASAN_KETUA" },
            unit: null,
          },
          {
            isPrimary: true,
            role: { code: "SMPIT_ADMIN" },
            unit: { id: "unit-smp" },
          },
        ],
      } as never,
    });
    useLaundryTransaction.mockReturnValue({
      data: transaction({ paymentStatus: "UNPAID", paymentMethod: "PENDING" }),
      isLoading: false,
    });

    render(<LaundryPage />);
    await userEvent.click(screen.getByLabelText("Lihat detail"));

    expect(screen.getByRole("button", { name: "Lunasi Tunai" })).toBeVisible();
    expect(screen.getByText("Ubah Status")).toBeVisible();
  });

  it("falls back to the first role assignment when none is primary", async () => {
    useAuthStore.setState({
      user: {
        id: "u-operator",
        role: "STAFF",
        userRoles: [
          {
            role: { code: "SMPIT_ADMIN" },
            unit: { id: "unit-smp" },
          },
        ],
      } as never,
    });
    useLaundryTransaction.mockReturnValue({
      data: transaction({ paymentStatus: "UNPAID", paymentMethod: "PENDING" }),
      isLoading: false,
    });

    render(<LaundryPage />);
    await userEvent.click(screen.getByLabelText("Lihat detail"));

    expect(screen.getByRole("button", { name: "Lunasi Tunai" })).toBeVisible();
    expect(screen.getByText("Ubah Status")).toBeVisible();
  });

  it("disables both action groups while one mutation is in flight", async () => {
    useLaundryTransaction.mockReturnValue({
      data: transaction({ paymentStatus: "UNPAID", paymentMethod: "PENDING" }),
      isLoading: false,
    });
    useProcessLaundryPayment.mockReturnValue({
      mutate: vi.fn(),
      isPending: true,
    });

    render(<LaundryPage />);
    await userEvent.click(screen.getByLabelText("Lihat detail"));

    expect(screen.getByRole("button", { name: /Lunasi Tunai/ })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: LAUNDRY_STATUS_LABELS.WASHING }),
    ).toBeDisabled();
  });
});

describe("Laundry — the new-transaction form keeps two decimals", () => {
  it("submits 1.25 kg without rounding it to a step of 0.1", async () => {
    const mutate = vi.fn();
    useCreateLaundryTransaction.mockReturnValue({ mutate, isPending: false });
    useStudents.mockReturnValue({
      data: {
        data: [{ id: "std-1", name: "Ahmad Fauzi", nis: "2024001" }],
      },
    });
    useLaundryPricing.mockReturnValue({ data: [tier], isLoading: false });

    render(<LaundryPage />);
    await userEvent.click(
      screen.getByRole("button", { name: /Transaksi Baru/ }),
    );
    const dialog = screen.getByRole("dialog");

    await userEvent.type(within(dialog).getByLabelText("Cari Santri"), "Ahmad");
    await userEvent.click(
      within(dialog).getByRole("button", { name: /Ahmad Fauzi/ }),
    );
    await userEvent.click(
      within(dialog).getByRole("combobox", { name: "Pilih tarif" }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: /Cuci Setrika Reguler/ }),
    );

    const weight = within(dialog).getByLabelText("Berat (kg)");
    expect(weight).toHaveAttribute("step", "0.01");
    await userEvent.clear(weight);
    await userEvent.type(weight, "1.25");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Buat Transaksi" }),
    );

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        studentId: "std-1",
        pricingId: "p1",
        weight: 1.25,
      }),
      expect.anything(),
    );
    // The API derives the business unit from the tier; the form must not
    // guess one from a separately loaded list.
    expect(mutate.mock.calls[0][0]).not.toHaveProperty("businessUnitId");
  });
});

describe("Laundry — search and empty states", () => {
  it("never sends a whitespace-only search", async () => {
    render(<LaundryPage />);
    const input = screen.getByLabelText("Cari transaksi");
    expect(input).toHaveAttribute("maxLength", "100");

    await userEvent.type(input, "   ");

    expect(useLaundryTransactions.mock.calls.at(-1)![0]).not.toHaveProperty(
      "search",
    );
  });

  it("says the list failed to load instead of calling it empty", () => {
    useLaundryTransactions.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<LaundryPage />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /Gagal memuat transaksi laundry/,
    );
    expect(
      screen.queryByText("Belum ada transaksi laundry"),
    ).not.toBeInTheDocument();
  });
});

describe("Laundry — the cards do not turn a failure into zero", () => {
  it("marks every figure unavailable when the stats request fails", () => {
    useLaundryStats.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    render(<LaundryPage />);

    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(screen.getByText("gagal memuat statistik")).toBeInTheDocument();
  });
});

describe("Laundry — the pager speaks Indonesian", () => {
  it("prints the range and the page in Indonesian", () => {
    render(<LaundryPage />);

    expect(document.body).toHaveTextContent("Menampilkan 1–1 dari 1 hasil");
    expect(document.body).toHaveTextContent("Halaman 1 dari 1");
    expect(document.body).not.toHaveTextContent(
      /Showing|Rows per page|Page 1 of/,
    );
  });
});
