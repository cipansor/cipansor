import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Pagination } from "./pagination";

describe("Pagination labels", () => {
  it("speaks Indonesian, as every portal label must", () => {
    render(
      <Pagination
        page={2}
        totalPages={3}
        pageSize={50}
        total={120}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    );

    expect(screen.getByText(/Menampilkan 51–100 dari 120 hasil/)).toBeVisible();
    expect(screen.getByText("Baris per halaman:")).toBeVisible();
    expect(screen.getByText(/Halaman/)).toHaveTextContent("Halaman 2 dari 3");
    expect(screen.queryByText(/Showing|Page 2 of/)).toBeNull();
  });
});
