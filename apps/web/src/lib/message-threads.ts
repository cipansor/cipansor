import type { Message } from "@cipansor/shared";

/** A conversation in the wali's list, seen from the signed-in account. */
export interface Conversation {
  /** The thread's first message: what `GET /messages/:id` opens. */
  id: string;
  otherName: string;
  subject: string;
  /** The newest message in the thread, from either side. */
  lastMessage: string;
  lastMessageAt: string;
  /** Something in the thread was sent to me and I have not read it. */
  unread: boolean;
}

const time = (iso: string) => new Date(iso).getTime();

/**
 * Group `GET /messages` rows into conversations. A row belongs to the thread
 * of `parentId ?? id`, so a reply counts toward its thread even when the
 * first message has dropped out of the page: the list shows when a thread
 * last moved, not when it began, and a reply sent to me that I have not read
 * marks the whole thread as new.
 */
export function buildConversations(
  rows: Message[],
  me: string | undefined,
): Conversation[] {
  const threads = new Map<string, Message[]>();
  for (const row of rows) {
    const key = row.parentId ?? row.id;
    threads.set(key, [...(threads.get(key) ?? []), row]);
  }
  return [...threads.entries()]
    .map(([id, messages]) => {
      const newest = messages.reduce((a, b) =>
        time(b.createdAt) > time(a.createdAt) ? b : a,
      );
      const first = messages.find((m) => m.id === id);
      const other = newest.senderId === me ? newest.recipient : newest.sender;
      return {
        id,
        otherName: other?.name || "—",
        subject: first?.subject ?? newest.subject.replace(/^Re:\s*/, ""),
        lastMessage: newest.content,
        lastMessageAt: newest.createdAt,
        unread: messages.some((m) => m.recipientId === me && !m.isRead),
      };
    })
    .sort((a, b) => time(b.lastMessageAt) - time(a.lastMessageAt));
}
