import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const {
  useClasses,
  useClassEnrollments,
  useGrowthRecords,
  createMutate,
  deleteMutate,
  granted,
  toastError,
} = vi.hoisted(() => ({
  useClasses: vi.fn(),
  useClassEnrollments: vi.fn(),
  useGrowthRecords: vi.fn(),
  createMutate: vi.fn(),
  deleteMutate: vi.fn(),
  granted: { current: new Set<string>() },
  toastError: vi.fn(),
}));

vi.mock("@/components/layout", () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
// A native `disabled` button swallows jsdom clicks, so the handler's own guard
// could never be reached. Render the disabled state as `aria-disabled`, which
// jest-dom still reads as disabled but which lets a click through.
vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    disabled,
    ...props
  }: { children: React.ReactNode; disabled?: boolean } & Record<
    string,
    unknown
  >) => (
    <button aria-disabled={disabled || undefined} {...props}>
      {children}
    </button>
  ),
}));
vi.mock("@/hooks/use-permission", () => ({
  usePermission: (p: string) => granted.current.has(p),
}));
vi.mock("@/stores/auth", () => ({
  useAuthStore: () => ({ user: { unitId: "unit-1" } }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: toastError },
}));
vi.mock("@/hooks/use-classes", () => ({ useClasses }));
vi.mock("@/hooks/use-class-enrollments", () => ({ useClassEnrollments }));
vi.mock("@/hooks/use-health", () => ({
  useGrowthRecords,
  useCreateGrowthRecord: () => ({
    mutate: createMutate,
    isPending: false,
  }),
  useDeleteGrowthRecord: () => ({ mutate: deleteMutate, isPending: false }),
}));

import GrowthTrackingPage from "./page";

// Radix Select needs these in jsdom to open and pick an option.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const student = {
  student: { id: "s1", user: { name: "Ahmad" } },
};

beforeEach(() => {
  vi.clearAllMocks();
  granted.current = new Set(["HEALTH_MANAGE"]);
  useClassEnrollments.mockReturnValue({ data: [student] });
  useGrowthRecords.mockReturnValue({ data: [], isLoading: false });
});

// Choose the class and the student, then open the "Catat Data" dialog, so the
// Simpan button is in the DOM.
async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getAllByRole("combobox")[0]);
  await user.click(await screen.findByRole("option", { name: "7A" }));
  await user.click(screen.getAllByRole("combobox")[1]);
  await user.click(await screen.findByRole("option", { name: "Ahmad" }));
  await user.click(screen.getByRole("button", { name: /Catat Data/ }));
  return user;
}

describe("growth page — the unit of the chosen class", () => {
  it("disables Simpan while the class unit has not loaded", async () => {
    // A cross-unit account: the class list carries no unit for the choice yet.
    useClasses.mockReturnValue({ data: { data: [{ id: "c1", name: "7A" }] } });
    render(<GrowthTrackingPage />);
    await openDialog();

    expect(screen.getByRole("button", { name: /Simpan/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("enables Simpan once the class unit is known", async () => {
    useClasses.mockReturnValue({
      data: { data: [{ id: "c1", name: "7A", unitId: "unit-1" }] },
    });
    render(<GrowthTrackingPage />);
    await openDialog();

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Simpan/ }),
      ).not.toHaveAttribute("aria-disabled"),
    );
  });

  it("says why when submit runs without a unit, and does not mutate", async () => {
    useClasses.mockReturnValue({ data: { data: [{ id: "c1", name: "7A" }] } });
    render(<GrowthTrackingPage />);
    const user = await openDialog();

    // The button is disabled, but a stray Enter or an odd browser still reaches
    // the handler; it must explain itself rather than return in silence.
    await user.click(screen.getByRole("button", { name: /Simpan/ }));

    expect(toastError).toHaveBeenCalledWith(
      "Unit kelas belum termuat, coba lagi",
    );
    expect(createMutate).not.toHaveBeenCalled();
  });
});
