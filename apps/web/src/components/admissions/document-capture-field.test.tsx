import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { DocumentCaptureField } from "./document-capture-field";
import { spmbFormContentFor } from "@/config/spmb-form.i18n";

const post = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api: { post } }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

const imageFile = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "ktp.png", {
    type: "image/png",
  });

function renderWithQuery(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

/**
 * The API's `validation.notes` are Indonesian prose. The public form speaks
 * three languages, so the component must render the structured verdict in the
 * reader's language instead — this pins that, and that the Indonesian note
 * does not leak through.
 */
describe("DocumentCaptureField", () => {
  beforeEach(() => post.mockReset());

  it("renders a mismatch in English, not the API's Indonesian note", async () => {
    post.mockResolvedValue({
      data: {
        data: {
          extractedData: { nationalId: "3201230110230001" },
          validation: {
            status: "MISMATCH",
            nationalIdMatch: false,
            notes: ["NIK pada dokumen tidak sama dengan isian."],
          },
        },
      },
    });

    renderWithQuery(
      <DocumentCaptureField
        label="KTP"
        content={spmbFormContentFor("en").documents}
        documentType="ktp"
        file={null}
        onFileSelect={() => {}}
        userInputData={{ nationalId: "3201230110239999" }}
      />,
    );

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [imageFile()] } });

    expect(
      await screen.findByText(/Does not match the form: NIK/),
    ).toBeTruthy();
    expect(screen.queryByText(/NIK pada dokumen/)).toBeNull();
  });

  it("drops the previous verdict when the file becomes a PDF", async () => {
    post.mockResolvedValue({
      data: {
        data: {
          extractedData: { nationalId: "3201230110230001" },
          validation: { status: "MISMATCH", nationalIdMatch: false, notes: [] },
        },
      },
    });
    const onOcrResult = vi.fn();
    renderWithQuery(
      <DocumentCaptureField
        label="KTP"
        content={spmbFormContentFor("en").documents}
        documentType="ktp"
        file={null}
        onFileSelect={() => {}}
        onOcrResult={onOcrResult}
      />,
    );

    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [imageFile()] } });
    await waitFor(() =>
      expect(onOcrResult).toHaveBeenCalledWith(
        expect.objectContaining({ status: "MISMATCH" }),
      ),
    );

    onOcrResult.mockClear();
    fireEvent.change(input, {
      target: {
        files: [new File(["%PDF-1.4"], "ktp.pdf", { type: "application/pdf" })],
      },
    });
    expect(onOcrResult).toHaveBeenCalledWith(null);
  });
});
