import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { useFoundation } = vi.hoisted(() => ({ useFoundation: vi.fn() }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/layout", () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/stores/auth", () => ({
  useAuthStore: (selector: (s: { user: unknown }) => unknown) =>
    selector({
      user: { userRoles: [{ isPrimary: true, role: { code: "SUPER_ADMIN" } }] },
    }),
}));
vi.mock("@/hooks", () => ({
  useFoundation,
  useUpdateFoundation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useFoundationDocuments: () => ({ data: [] }),
  useDeleteFoundationDocument: () => ({ mutateAsync: vi.fn() }),
  useFoundationBoardMembers: () => ({ data: [] }),
  useDeleteFoundationBoardMember: () => ({ mutateAsync: vi.fn() }),
  useFoundationFinancialOverview: () => ({ data: undefined }),
  DOCUMENT_TYPE_LABELS: {},
  foundationProfilePayload: (v: unknown) => v,
}));

import FoundationPage from "./page";

const record = {
  id: "f1",
  name: "Yayasan Pesantren Cipansor",
  legalName: "Yayasan Pesantren Cipansor",
  taxId: "",
  address: "",
  phone: "",
  email: "",
  website: "",
  vision: "",
  mission: "",
  foundingDate: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("foundation page — the yayasan record it edits", () => {
  it("hides Edit and says the record is missing when there is none", () => {
    useFoundation.mockReturnValue({ data: null, isLoading: false });
    render(<FoundationPage />);

    expect(screen.getByText("Data yayasan belum ada")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
  });

  it("offers Edit once the record is there", () => {
    useFoundation.mockReturnValue({ data: record, isLoading: false });
    render(<FoundationPage />);

    expect(screen.getByRole("button", { name: /Edit/ })).toBeDefined();
    expect(screen.queryByText("Data yayasan belum ada")).toBeNull();
  });
});
