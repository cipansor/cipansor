import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { useDataSubjectRequest, mutateAsync } = vi.hoisted(() => ({
  useDataSubjectRequest: vi.fn(),
  mutateAsync: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "dsr-1" }),
}));
vi.mock("@/components/layout/main-layout", () => ({
  MainLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("@/hooks/use-data-subject-requests", () => ({
  useDataSubjectRequest,
  useUpdateDataSubjectRequestStatus: () => ({ mutateAsync, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import DataSubjectRequestDetailPage from "./page";

// Radix Select needs these in jsdom to open and read its options.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

const base = {
  id: "dsr-1",
  requestNo: "DSR-2026-0001",
  type: "RECTIFICATION",
  status: "RECEIVED",
  subjectCategory: "REGISTRANT",
  subjectLabel: "Ahmad (No. SPMB-2026-0001)",
  requesterName: "Siti Aminah",
  requesterContact: "081200000002",
  requesterRelation: null,
  detail: "Mohon perbaikan ejaan nama.",
  rejectionReason: null,
  dueAt: "2026-11-20T00:00:00.000Z",
  completedAt: null,
  verifiedAt: null,
  isPublic: true,
  overdue: false,
  handledBy: null,
  actions: [],
  createdAt: "2026-11-17T00:00:00.000Z",
  updatedAt: "2026-11-17T00:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

async function openStatusPicker() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: "Status berikutnya" }));
  return screen.findAllByRole("option");
}

describe("halaman rincian permintaan data — pilihan status", () => {
  it("membatasi permintaan publik yang belum terverifikasi pada verifikasi luring atau penolakan", async () => {
    // Memindahkannya ke Diproses memutus langkah verifikasi kode, sehingga
    // permintaan publik yang belum terbukti tidak dapat diverifikasi maupun
    // diselesaikan — peladen menolaknya (409). Layar tidak menawarkan langkah
    // yang pasti ditolak.
    useDataSubjectRequest.mockReturnValue({
      data: { ...base },
      isLoading: false,
    });
    render(<DataSubjectRequestDetailPage />);

    const names = (await openStatusPicker()).map((o) => o.textContent);

    expect(names).toContain("Terverifikasi");
    expect(names).toContain("Ditolak");
    expect(names).not.toContain("Diproses");
    expect(names).not.toContain("Selesai");
  });

  it("menawarkan seluruh status untuk permintaan publik yang sudah terverifikasi", async () => {
    useDataSubjectRequest.mockReturnValue({
      data: { ...base, verifiedAt: "2026-11-18T00:00:00.000Z" },
      isLoading: false,
    });
    render(<DataSubjectRequestDetailPage />);

    const names = (await openStatusPicker()).map((o) => o.textContent);

    expect(names).toContain("Diproses");
    expect(names).toContain("Selesai");
  });
});
