import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { Errors } from '@/middleware/error';
import { CreateMessageInput, MessageCategory } from '@cipansor/shared';
import { logger } from '@/lib/logger';
import { eventBus } from '@/lib/event-bus';

/**
 * The message a new one hangs under, if `userId` is one of its two people —
 * only they may read it (getMessageById), so only they may add to it. Anyone
 * else is told it does not exist, so the answer does not confirm the id.
 */
async function threadParentFor(parentId: string, userId: string) {
  const parent = await prisma.message.findUnique({ where: { id: parentId } });
  if (!parent || (parent.senderId !== userId && parent.recipientId !== userId)) {
    throw Errors.notFound('Parent message');
  }
  return parent;
}

export class MessagesService {
  /**
   * Send a new message
   */
  async createMessage(senderId: string, input: CreateMessageInput) {
    // A message under a thread stays between that thread's two people: the
    // sender must be one of them, and so must the recipient.
    if (input.parentId) {
      const parent = await threadParentFor(input.parentId, senderId);
      if (input.recipientId !== parent.senderId && input.recipientId !== parent.recipientId) {
        throw Errors.notFound('Parent message');
      }
    }

    // Validate recipient exists
    const recipient = await prisma.user.findUnique({
      where: { id: input.recipientId },
    });

    if (!recipient) {
      throw Errors.notFound('Recipient');
    }

    const message = await prisma.message.create({
      data: {
        senderId,
        recipientId: input.recipientId,
        subject: input.subject,
        content: input.content,
        category: input.category || 'GENERAL',
        parentId: input.parentId || null,
        isRead: false,
      },
      include: {
        sender: {
          select: { id: true, name: true, role: true },
        },
        recipient: {
          select: { id: true, name: true, role: true },
        },
      },
    });

    // Real-time notification
    eventBus.emit('message:sent', message);

    return message;
  }

  /**
   * Get messages for a user (Inbox/Sent)
   */
  async getUserMessages(
    userId: string,
    params: {
      page: number;
      limit: number;
      type: 'inbox' | 'sent' | 'all';
      category?: MessageCategory;
    }
  ) {
    const { page, limit, type, category } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.MessageWhereInput = {};

    if (type === 'inbox') {
      where.recipientId = userId;
    } else if (type === 'sent') {
      where.senderId = userId;
    } else {
      where.OR = [{ recipientId: userId }, { senderId: userId }];
    }

    if (category) {
      where.category = category;
    }

    // Don't fetch replies as top-level messages in inbox usually
    // where.parentId = null;

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          sender: {
            select: { id: true, name: true, role: true },
          },
          recipient: {
            select: { id: true, name: true, role: true },
          },
          _count: {
            select: { replies: true },
          },
        },
      }),
      prisma.message.count({ where }),
    ]);

    return {
      data: messages,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get single message details including replies
   */
  async getMessageById(userId: string, messageId: string) {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        sender: { select: { id: true, name: true, role: true } },
        recipient: { select: { id: true, name: true, role: true } },
        replies: {
          include: {
            sender: { select: { id: true, name: true, role: true } },
            recipient: { select: { id: true, name: true, role: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!message) {
      throw Errors.notFound('Message');
    }

    // Check permission
    if (message.senderId !== userId && message.recipientId !== userId) {
      throw Errors.forbidden('You do not have permission to view this message');
    }

    // Opening a thread reads it: the message and every reply in it sent to
    // this user. A reply in a thread the user started (the wali writing first
    // from Buku Penghubung) used to stay unread for good.
    const unread =
      (message.recipientId === userId && !message.isRead) ||
      message.replies.some((r) => r.recipientId === userId && !r.isRead);
    if (unread) {
      await this.markThreadRead(userId, messageId);
      if (message.recipientId === userId) message.isRead = true;
      for (const reply of message.replies) {
        if (reply.recipientId === userId) reply.isRead = true;
      }
    }

    return message;
  }

  /**
   * Reply to a message
   */
  async replyToMessage(senderId: string, parentId: string, content: string) {
    const parentMessage = await threadParentFor(parentId, senderId);

    // Determine recipient (the other party)
    const recipientId =
      parentMessage.senderId === senderId ? parentMessage.recipientId : parentMessage.senderId;

    const reply = await prisma.message.create({
      data: {
        senderId,
        recipientId,
        parentId,
        subject: `Re: ${parentMessage.subject}`,
        content,
        category: parentMessage.category,
        isRead: false,
      },
      include: {
        sender: { select: { id: true, name: true, role: true } },
        recipient: { select: { id: true, name: true, role: true } },
      },
    });

    return reply;
  }

  /**
   * Mark a message read, with the replies under it that were sent to this
   * user. Either person in the conversation may ask; only what was addressed
   * to the caller changes. Anyone else gets `null`, as before.
   */
  async markAsRead(userId: string, messageId: string) {
    const message = await prisma.message.findFirst({
      where: { id: messageId, OR: [{ recipientId: userId }, { senderId: userId }] },
    });
    if (!message) return null;
    await this.markThreadRead(userId, messageId);
    return message.recipientId === userId ? { ...message, isRead: true } : message;
  }

  /** The unread rows of one thread addressed to `userId`, marked read in one write. */
  private async markThreadRead(userId: string, messageId: string) {
    await prisma.message.updateMany({
      where: {
        recipientId: userId,
        isRead: false,
        OR: [{ id: messageId }, { parentId: messageId }],
      },
      data: { isRead: true },
    });
  }

  /**
   * Get unread count
   */
  async getUnreadCount(userId: string) {
    return prisma.message.count({
      where: {
        recipientId: userId,
        isRead: false,
      },
    });
  }
}
