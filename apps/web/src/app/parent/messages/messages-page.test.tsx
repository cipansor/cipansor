import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  mutate: vi.fn(),
  isPending: { current: false },
  rows: { current: [] as unknown[] },
}));

vi.mock("@/hooks/use-messages", () => ({
  useMessages: () => ({
    data: { data: h.rows.current },
    isLoading: false,
    markAsRead: { mutate: h.mutate, isPending: h.isPending.current },
    replyMessage: { mutateAsync: vi.fn(), isPending: false },
  }),
  useMessageThread: () => ({ data: undefined }),
}));
vi.mock("@/stores/auth", () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) =>
    selector({ user: { id: "me" } }),
}));

import ParentMessagesPage from "./page";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

/** A `GET /messages` row, from the teacher to the wali. */
function row(over: Record<string, unknown>) {
  return {
    id: "t1",
    senderId: "teacher-1",
    recipientId: "me",
    subject: "Izin",
    content: "Assalamu'alaikum",
    category: "GENERAL",
    isRead: false,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    sender: { id: "teacher-1", name: "Ustadz Ahmad" },
    recipient: { id: "me", name: "Wali" },
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.isPending.current = false;
});

describe("Pesan wali — marking the open thread read", () => {
  it("marks it read again when a reply lands while it is open", () => {
    h.rows.current = [row({})];
    const { rerender } = render(<ParentMessagesPage />);

    fireEvent.click(screen.getByText("Izin"));
    expect(h.mutate).toHaveBeenCalledTimes(1);
    expect(h.mutate).toHaveBeenCalledWith("t1");

    // The API read it; the live list now shows the thread read.
    h.rows.current = [row({ isRead: true })];
    rerender(<ParentMessagesPage />);
    expect(h.mutate).toHaveBeenCalledTimes(1);

    // A reply arrives while the thread is still open: same thread id, unread
    // again. Keyed only on the id this would never fire.
    h.rows.current = [
      row({ isRead: true }),
      row({
        id: "t1-reply",
        parentId: "t1",
        content: "Baik, silakan.",
        createdAt: "2025-01-02T00:00:00.000Z",
      }),
    ];
    rerender(<ParentMessagesPage />);
    expect(h.mutate).toHaveBeenCalledTimes(2);
    expect(h.mutate).toHaveBeenLastCalledWith("t1");
  });

  it("does not re-mark while the request is in flight", () => {
    h.rows.current = [row({})];
    const { rerender } = render(<ParentMessagesPage />);

    fireEvent.click(screen.getByText("Izin"));
    expect(h.mutate).toHaveBeenCalledTimes(1);

    // The thread is still unread in the cache while the PATCH is pending; the
    // guard keeps that from looping.
    h.isPending.current = true;
    rerender(<ParentMessagesPage />);
    expect(h.mutate).toHaveBeenCalledTimes(1);
  });
});
