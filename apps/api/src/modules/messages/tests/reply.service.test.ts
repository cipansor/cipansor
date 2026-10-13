import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Only the two people in a conversation reply to it, as only they may read it
 * (`getMessageById`). Before, the reply path loaded the parent by id and wrote
 * the reply without asking who the caller was, so any signed-in account could
 * post into anyone's private thread. Anyone else is now told the message does
 * not exist, so the answer does not confirm the id.
 */

const prismaMock = vi.hoisted(() => ({
  message: { findUnique: vi.fn(), create: vi.fn() },
  user: { findUnique: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/event-bus', () => ({ eventBus: { emit: vi.fn() } }));

import { MessagesService } from '../messages.service';

const THREAD = {
  id: 'm-1',
  senderId: 'u-guru',
  recipientId: 'u-wali',
  subject: 'Perizinan',
  category: 'GENERAL',
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.message.findUnique.mockResolvedValue(THREAD);
  prismaMock.message.create.mockImplementation(async ({ data }: { data: object }) => data);
  prismaMock.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => ({
    id: where.id,
  }));
});

describe('replying to a message', () => {
  it('either participant replies, and the reply goes to the other one', async () => {
    const service = new MessagesService();
    await expect(service.replyToMessage('u-wali', 'm-1', 'Baik')).resolves.toMatchObject({
      senderId: 'u-wali',
      recipientId: 'u-guru',
      parentId: 'm-1',
    });
    await expect(service.replyToMessage('u-guru', 'm-1', 'Terima kasih')).resolves.toMatchObject({
      recipientId: 'u-wali',
    });
  });

  it('anyone else is told it does not exist, and nothing is written', async () => {
    const service = new MessagesService();
    await expect(service.replyToMessage('u-lain', 'm-1', 'Halo')).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });
});

describe('sending a new message under a thread (POST /messages with parentId)', () => {
  const send = (senderId: string, recipientId: string) =>
    new MessagesService().createMessage(senderId, {
      recipientId,
      subject: 'x',
      content: 'y',
      parentId: 'm-1',
    } as any);

  it('stays between the thread’s two people', async () => {
    await expect(send('u-wali', 'u-guru')).resolves.toMatchObject({ parentId: 'm-1' });
  });

  it('an outsider cannot hang a message on someone else’s thread', async () => {
    await expect(send('u-lain', 'u-wali')).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });

  it('a participant cannot pull a third person into the thread', async () => {
    await expect(send('u-wali', 'u-lain')).rejects.toMatchObject({ statusCode: 404 });
    expect(prismaMock.message.create).not.toHaveBeenCalled();
  });
});
