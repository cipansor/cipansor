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

    // Mark as read if recipient
    if (message.recipientId === userId && !message.isRead) {
      await this.markAsRead(userId, messageId);
      message.isRead = true;
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
   * Mark message as read
   */
  async markAsRead(userId: string, messageId: string) {
    // Only recipient can mark as read
    const message = await prisma.message.findFirst({
      where: {
        id: messageId,
        recipientId: userId,
      },
    });

    if (!message) {
      // Either not found or not recipient, return silently or throw
      // For idempotency, we can just return if already read or not found
      return null;
    }

    return prisma.message.update({
      where: { id: messageId },
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
