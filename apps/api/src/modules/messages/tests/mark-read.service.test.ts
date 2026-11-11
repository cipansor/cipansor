import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A wali who writes first (Buku Penghubung) is the sender of the thread's
 * first message, so the old "mark read if recipient" only ever looked at that
 * message: the wali kelas's replies to them stayed unread for good, and the
 * unread count kept growing. Opening a thread now reads every reply in it that
 * was sent to the caller, and nothing addressed to anyone else.
 */
const prismaMock = vi.hoisted(() => ({
  message: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/event-bus', () => ({ eventBus: { emit: vi.fn() } }));

import { MessagesService } from '../messages.service';

/** A thread the wali started; the guru answered twice, one of them unread. */
function waliThread() {
  return {
    id: 'm-1',
    senderId: 'u-wali',
    recipientId: 'u-guru',
    isRead: true,
    replies: [
      { id: 'r-1', senderId: 'u-guru', recipientId: 'u-wali', isRead: true },
      { id: 'r-2', senderId: 'u-guru', recipientId: 'u-wali', isRead: false },
    ],
  };
}

const THREAD_WRITE = {
  where: { recipientId: 'u-wali', isRead: false, OR: [{ id: 'm-1' }, { parentId: 'm-1' }] },
  data: { isRead: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.message.updateMany.mockResolvedValue({ count: 1 });
});

describe('opening a thread', () => {
  it('reads the replies sent to the wali in a thread the wali started', async () => {
    prismaMock.message.findUnique.mockResolvedValue(waliThread());
    const thread = await new MessagesService().getMessageById('u-wali', 'm-1');
    expect(prismaMock.message.updateMany).toHaveBeenCalledWith(THREAD_WRITE);
    expect(thread.replies.map((r) => r.isRead)).toEqual([true, true]);
  });

  it('writes nothing when everything sent to the caller is already read', async () => {
    const read = waliThread();
    read.replies[1].isRead = true;
    prismaMock.message.findUnique.mockResolvedValue(read);
    await new MessagesService().getMessageById('u-wali', 'm-1');
    expect(prismaMock.message.updateMany).not.toHaveBeenCalled();
  });

  it('leaves the other person\u2019s unread rows alone', async () => {
    const thread = waliThread();
    thread.isRead = false; // the guru has not opened the wali's first message
    prismaMock.message.findUnique.mockResolvedValue(thread);
    const seen = await new MessagesService().getMessageById('u-wali', 'm-1');
    expect(seen.isRead).toBe(false);
    expect(prismaMock.message.updateMany.mock.calls[0][0].where.recipientId).toBe('u-wali');
  });
});

describe('PATCH /messages/:id/read', () => {
  it('lets the sender of the first message read the replies sent to them', async () => {
    prismaMock.message.findFirst.mockResolvedValue({
      id: 'm-1',
      senderId: 'u-wali',
      recipientId: 'u-guru',
      isRead: false,
    });
    const result = await new MessagesService().markAsRead('u-wali', 'm-1');
    expect(prismaMock.message.findFirst).toHaveBeenCalledWith({
      where: { id: 'm-1', OR: [{ recipientId: 'u-wali' }, { senderId: 'u-wali' }] },
    });
    expect(prismaMock.message.updateMany).toHaveBeenCalledWith(THREAD_WRITE);
    // The first message was the guru's to read; it stays as it was.
    expect(result).toMatchObject({ id: 'm-1', isRead: false });
  });

  it('marks the recipient\u2019s own message read', async () => {
    prismaMock.message.findFirst.mockResolvedValue({
      id: 'm-1',
      senderId: 'u-guru',
      recipientId: 'u-wali',
      isRead: false,
    });
    await expect(new MessagesService().markAsRead('u-wali', 'm-1')).resolves.toMatchObject({
      isRead: true,
    });
  });

  it('changes nothing for someone outside the conversation', async () => {
    prismaMock.message.findFirst.mockResolvedValue(null);
    await expect(new MessagesService().markAsRead('u-lain', 'm-1')).resolves.toBeNull();
    expect(prismaMock.message.updateMany).not.toHaveBeenCalled();
  });
});
