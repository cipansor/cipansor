import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// jsdom lacks the pointer-capture and scroll APIs Radix Select calls on open.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

/**
 * The account picker used to list every EXPENSE account, so a unit admin could
 * choose one pinned to another unit and the save came back 400
 * (`createBudget` refuses a foreign-unit account). The shared `useAccountCodes`
 * hook now carries the `unitId` filter to the API, which scopes the list to the
 * chosen unit plus the shared (`unitId` null) accounts — filtering client-side
 * over the first page hid a unit's own accounts that fell past it.
 */
const { apiGet, useBudgets } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  useBudgets: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: { get: apiGet, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));
vi.mock("@/components/layout", () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
// Keep the real `useAccountCodes` — the point is that the picker goes through
// it and the hook serializes `unitId`.
vi.mock("@/hooks/use-finance-enhancement", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-finance-enhancement")>()),
  useBudgets,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import BudgetingPage from "./page";

const ACCOUNTS = [
  {
    id: "a1",
    code: "5101",
    name: "Beban unit satu",
    unitId: "unit-1",
    isActive: true,
  },
  {
    id: "a2",
    code: "5102",
    name: "Beban unit dua",
    unitId: "unit-2",
    isActive: true,
  },
  {
    id: "a3",
    code: "5103",
    name: "Beban bersama",
    unitId: null,
    isActive: true,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  apiGet.mockImplementation(async (url: string) => {
    const [path, search = ""] = url.split("?");
    if (path === "/units")
      return { data: { data: [{ id: "unit-1", name: "SD IT" }] } };
    if (path === "/academic-years")
      return { data: { data: [{ id: "ay-1", name: "2026/2027" }] } };
    if (path === "/finance-enhancement/account-codes") {
      // Mirror the API: the chosen unit's own accounts plus the shared ones.
      const unitId = new URLSearchParams(search).get("unitId");
      return {
        data: {
          data: ACCOUNTS.filter((a) => !a.unitId || a.unitId === unitId),
          meta: {
            pagination: { page: 1, limit: 100, total: 0, totalPages: 1 },
          },
        },
      };
    }
    return { data: { data: [] } };
  });
  useBudgets.mockReturnValue({
    data: { data: [], meta: { pagination: { totalPages: 1 } } },
    isLoading: false,
  });
});

async function openBudgetDialog() {
  const user = userEvent.setup();
  await user.click(screen.getAllByRole("combobox")[0]);
  await user.click(await screen.findByRole("option", { name: "SD IT" }));
  await user.click(screen.getAllByRole("combobox")[1]);
  await user.click(await screen.findByRole("option", { name: "2026/2027" }));
  await user.click(screen.getByRole("button", { name: /Tambah Anggaran/ }));
  return user;
}

const renderPage = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <BudgetingPage />
    </QueryClientProvider>,
  );
};

describe("Anggaran — the account picker respects the chosen unit", () => {
  it("asks the API for the unit's own accounts plus the shared ones, never another unit's", async () => {
    renderPage();
    const user = await openBudgetDialog();

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("combobox"));

    expect(
      await screen.findByRole("option", { name: "5101 - Beban unit satu" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("option", { name: "5103 - Beban bersama" }),
    ).toBeTruthy();
    expect(screen.queryByRole("option", { name: /unit dua/ })).toBeNull();

    // The scoping is the API's, keyed by the chosen unit — the shared hook puts
    // `unitId` in the query string, not a client-side filter.
    const call = apiGet.mock.calls.find(([url]) =>
      url.startsWith("/finance-enhancement/account-codes?"),
    );
    expect(call?.[0]).toContain("unitId=unit-1");
  });
});
