import { describe, it, expect } from "vitest";
import type { Message } from "@cipansor/shared";
import { buildConversations } from "./message-threads";

const WALI = "u-wali";
const GURU = "u-guru";
const person = (id: string, name: string) =>
  ({ id, name }) as unknown as Message["sender"];

function msg(
  over: Partial<Message> & { id: string; createdAt: string },
): Message {
  return {
    senderId: GURU,
    recipientId: WALI,
    subject: "Perizinan",
    content: "…",
    category: "GENERAL",
    isRead: true,
    parentId: null,
    updatedAt: over.createdAt,
    sender: person(GURU, "Ustadzah Fatimah"),
    recipient: person(WALI, "Bapak Ahmad"),
    ...over,
  } as Message;
}

describe("buildConversations — the wali's message list", () => {
  it("shows a guru's unread reply in a thread the wali started as new", () => {
    const rows = [
      msg({
        id: "r-1",
        parentId: "m-1",
        content: "Izin diterima",
        createdAt: "2026-11-02T08:00:00Z",
        isRead: false,
      }),
      msg({
        id: "m-1",
        senderId: WALI,
        recipientId: GURU,
        sender: person(WALI, "Bapak Ahmad"),
        recipient: person(GURU, "Ustadzah Fatimah"),
        content: "Mohon izin",
        createdAt: "2026-11-01T08:00:00Z",
      }),
    ];
    expect(buildConversations(rows, WALI)).toEqual([
      {
        id: "m-1",
        otherName: "Ustadzah Fatimah",
        subject: "Perizinan",
        lastMessage: "Izin diterima",
        lastMessageAt: "2026-11-02T08:00:00Z",
        unread: true,
      },
    ]);
  });

  it("orders threads by their newest message, not their first", () => {
    const rows = [
      msg({ id: "m-old", createdAt: "2026-10-01T08:00:00Z", subject: "Lama" }),
      msg({ id: "m-new", createdAt: "2026-10-20T08:00:00Z", subject: "Baru" }),
      msg({
        id: "r-old",
        parentId: "m-old",
        createdAt: "2026-10-25T08:00:00Z",
      }),
    ];
    expect(buildConversations(rows, WALI).map((c) => c.id)).toEqual([
      "m-old",
      "m-new",
    ]);
  });

  it("keeps a thread whose first message fell off the page", () => {
    const rows = [
      msg({
        id: "r-9",
        parentId: "m-9",
        subject: "Re: Kegiatan kemah",
        createdAt: "2026-11-03T08:00:00Z",
      }),
    ];
    const [conversation] = buildConversations(rows, WALI);
    expect(conversation).toMatchObject({
      id: "m-9",
      subject: "Kegiatan kemah",
    });
  });

  it("does not count the other person's unread messages", () => {
    const rows = [
      msg({
        id: "m-1",
        senderId: WALI,
        recipientId: GURU,
        isRead: false,
        createdAt: "2026-11-01T08:00:00Z",
      }),
    ];
    expect(buildConversations(rows, WALI)[0].unread).toBe(false);
  });
});
