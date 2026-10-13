import { Prisma, NotificationStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { Errors } from '../../middleware/error';
import {
  notificationService as channelService,
  type NotificationChannel,
} from './email-sms.service';
import crypto from 'node:crypto';
import type {
  CreateNotificationInput,
  CreateBulkNotificationInput,
  QueryNotificationInput,
} from './notifications.schema';

// Helper to map shared types to Prisma Enum
export const mapTypeToPrisma = (type: string): { dbType: string; originalType: string | null } => {
  const validTypes = ['INFO', 'ANNOUNCEMENT', 'REMINDER', 'ALERT', 'PAYMENT', 'ACADEMIC'];

  if (validTypes.includes(type)) {
    return { dbType: type, originalType: null };
  }

  const mapping: Record<string, string> = {
    ATTENDANCE: 'ACADEMIC',
    FINANCE: 'PAYMENT',
    PERMIT: 'ACADEMIC',
    HEALTH: 'INFO',
    VIOLATION: 'ALERT',
    REWARD: 'INFO',
    SYSTEM: 'INFO',
  };

  return { dbType: mapping[type] || 'INFO', originalType: type };
};

/** Prisma's error code for a unique-constraint violation (P2002). */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  );
}

/**
 * The durable delivery marker for a recurring notification slot (#802).
 *
 * Deliberately NOT the notification row: the marker is created before both the
 * in-app row and the external dispatch, so it survives a bell-row deletion and
 * a transport failure — the two ways the row-as-marker approach lost state
 * (review findings on #804). Each external channel records its own outcome, so
 * a failed EMAIL is retried while a channel that already went out is not.
 */
export interface NotificationDeliveryMarker {
  id: string;
  channels: Record<string, string>;
}

/** External channels a keyed notification may fan out to. */
type ExternalChannel = Exclude<NotificationChannel, 'IN_APP' | 'PUSH'>;

/**
 * Claim the delivery slot for `(userId, dedupeKey)`, or return the existing
 * marker if the slot was already claimed.
 *
 * A freshly-created marker is returned with `channels: {}`; the caller runs the
 * dispatches and then marks what succeeded. A pre-existing marker means the
 * in-app row is already there, but any channel still `FAILED` is retried —
 * which is what makes a transient mail outage recoverable.
 */
export async function claimNotificationDelivery(
  userId: string,
  dedupeKey: string
): Promise<{ marker: NotificationDeliveryMarker; created: boolean }> {
  try {
    const created = await prisma.notificationDelivery.create({
      data: { userId, dedupeKey, channels: {} },
    });
    return { marker: { id: created.id, channels: {} }, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await prisma.notificationDelivery.findUnique({
      where: { userId_dedupeKey: { userId, dedupeKey } },
      select: { id: true, channels: true },
    });
    // A lost race between two ticks can delete the row between the failed
    // create and this read; treat it as claimable again rather than crashing.
    if (!existing) return claimNotificationDelivery(userId, dedupeKey);
    return {
      marker: { id: existing.id, channels: (existing.channels ?? {}) as Record<string, string> },
      created: false,
    };
  }
}

/**
 * Remove delivery markers for a subject so a recovery can alert again.
 * `budget-overrun:<planId>:` matches every admin's marker for that plan; a new
 * overrun episode then claims fresh slots (review finding: repeat overruns went
 * unreported because the marker never cleared).
 */
export async function clearNotificationDeliveries(dedupeKeyPrefix: string, userId?: string) {
  return prisma.notificationDelivery.deleteMany({
    where: {
      dedupeKey: { startsWith: dedupeKeyPrefix },
      ...(userId ? { userId } : {}),
    },
  });
}

/** Record a channel's outcome on its marker (idempotent upsert of the map). */
async function markDeliveryChannel(id: string, channels: Record<string, string>) {
  const marker = await prisma.notificationDelivery.findUnique({
    where: { id },
    select: { channels: true },
  });
  const merged = { ...((marker?.channels ?? {}) as Record<string, string>), ...channels };
  await prisma.notificationDelivery.update({ where: { id }, data: { channels: merged } });
}

// ==================== NOTIFICATION ====================

export async function getUserNotifications(userId: string, query: QueryNotificationInput) {
  const { page, limit, type, isRead } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.NotificationWhereInput = {
    userId,
    ...(isRead !== undefined && {
      status: isRead ? NotificationStatus.READ : NotificationStatus.UNREAD,
    }),
    OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
  };

  if (type) {
    const { dbType, originalType } = mapTypeToPrisma(type);
    where.type = dbType as any;

    if (originalType) {
      // Prisma JSON filter workaround
      // Cast to any because Prisma strict typing for JSON filters can be finicky
      (where as any).data = {
        path: ['originalType'],
        equals: originalType,
      };
    }
  }

  const [data, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, status: NotificationStatus.UNREAD } }),
  ]);

  const transformedData = data.map((n) => {
    const originalType = (n.data as any)?.originalType;
    if (originalType) {
      return { ...n, type: originalType };
    }
    return n;
  });

  return {
    data: transformedData,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      unreadCount,
    },
  };
}

/** One of the owner's notifications; null for anyone else's. */
export async function getNotificationById(id: string, userId: string) {
  const notification = await prisma.notification.findFirst({ where: { id, userId } });

  if (notification) {
    const originalType = (notification.data as any)?.originalType;
    if (originalType) {
      return { ...notification, type: originalType };
    }
  }

  return notification;
}

// ---------------------------------------------------------------------------
// Channel policy — which EXTERNAL channels the system may use (IN_APP is
// always on). Stored as a Setting row (key NOTIFICATION_CHANNELS); managed
// by SUPER_ADMIN via /notifications/settings/channels.
// ---------------------------------------------------------------------------

export interface ChannelPolicy {
  EMAIL: boolean;
  SMS: boolean;
  WHATSAPP: boolean;
}

const DEFAULT_CHANNEL_POLICY: ChannelPolicy = { EMAIL: true, SMS: true, WHATSAPP: true };

export async function getChannelPolicy(): Promise<ChannelPolicy> {
  const setting = await prisma.setting.findFirst({
    where: { key: 'NOTIFICATION_CHANNELS' },
  });
  if (!setting) {
    return DEFAULT_CHANNEL_POLICY;
  }
  const value = setting.value as Partial<ChannelPolicy> | null;
  return { ...DEFAULT_CHANNEL_POLICY, ...(value ?? {}) };
}

export async function updateChannelPolicy(policy: ChannelPolicy) {
  const existing = await prisma.setting.findFirst({
    where: { key: 'NOTIFICATION_CHANNELS' },
  });
  if (existing) {
    return prisma.setting.update({
      where: { id: existing.id },
      data: { value: policy as unknown as Prisma.InputJsonValue },
    });
  }
  const unit = await prisma.unit.findFirst({ select: { id: true } });
  if (!unit) throw new Error('No unit exists to attach the setting to');
  return prisma.setting.create({
    data: {
      unitId: unit.id,
      key: 'NOTIFICATION_CHANNELS',
      value: policy as unknown as Prisma.InputJsonValue,
    },
  });
}

export async function createNotification(data: CreateNotificationInput) {
  const { dbType, originalType } = mapTypeToPrisma(data.type ?? 'INFO');
  const { channels, dedupeKey } = data;

  const externalChannels = (channels ?? []).filter(
    (c): c is ExternalChannel => c === 'EMAIL' || c === 'SMS' || c === 'WHATSAPP'
  );

  // A recurring slot (#802). The durable marker owns delivery state; the in-app
  // row is just the record, so a deleted row never revives the reminder and a
  // failed channel stays retryable.
  if (dedupeKey && data.userId) {
    const { marker, created } = await claimNotificationDelivery(data.userId, dedupeKey);

    if (!created) {
      // The in-app row is already there. Retry only the channels that never
      // confirmed (a transient mail outage, a provider 5xx).
      const channelsToRetry = externalChannels.filter((c) => marker.channels[c] === 'FAILED');
      if (channelsToRetry.length === 0) return null;
      await dispatchExternalChannels({ ...data, userId: data.userId }, channelsToRetry, marker.id);
      return null;
    }

    // First delivery of this slot: insert the in-app row, then fan out.
    let notification;
    try {
      notification = await prisma.notification.create({
        data: buildCreateData(data, dbType, originalType, dedupeKey),
      });
    } catch (error) {
      // The row never landed, so nothing was delivered: release the slot and
      // rethrow, or the marker would leave this reminder permanently silent.
      await prisma.notificationDelivery.delete({ where: { id: marker.id } }).catch(() => undefined);
      throw error;
    }

    if (externalChannels.length > 0) {
      await dispatchExternalChannels({ ...data, userId: data.userId }, externalChannels, marker.id);
    }
    return originalType ? { ...notification, type: originalType } : notification;
  }

  // One-shot notification: no marker, no dedupe.
  const notification = await prisma.notification.create({
    data: buildCreateData(data, dbType, originalType, undefined),
  });

  if (externalChannels.length > 0 && data.userId) {
    await dispatchExternalChannels({ ...data, userId: data.userId }, externalChannels, null);
  }

  return originalType ? { ...notification, type: originalType } : notification;
}

/** The Prisma create payload shared by keyed and one-shot notifications. */
function buildCreateData(
  data: CreateNotificationInput,
  dbType: string,
  originalType: string | null,
  dedupeKey: string | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const { priority, channels, recipientType, recipientIds, ...rest } = data;
  return {
    ...rest,
    type: dbType,
    data: {
      ...(data.data || {}),
      ...(originalType ? { originalType } : {}),
      priority,
      channels,
      recipientType,
      ...(recipientIds ? { recipientIds } : {}),
      ...(dedupeKey ? { dedupeKey } : {}),
    },
    scheduledAt: data.scheduledAt || null,
    ...(dedupeKey ? { dedupeKey } : {}),
  };
}

/**
 * Fan out to the external channels listed, recording each one's outcome on the
 * delivery marker. Best-effort: a dispatch failure is recorded as `FAILED`
 * (so the next run retries it) and never thrown to the caller. `markerId` is
 * null for one-shot notifications, which have no delivery state to keep.
 */
async function dispatchExternalChannels(
  data: CreateNotificationInput & { userId: string },
  externalChannels: ExternalChannel[],
  markerId: string | null
): Promise<void> {
  if (externalChannels.length === 0) return;
  try {
    // Respect the system-wide channel policy (super-admin managed).
    const policy = await getChannelPolicy();
    const allowed = externalChannels.filter((c) => policy[c]);
    const user =
      allowed.length > 0
        ? await prisma.user.findUnique({
            where: { id: data.userId },
            select: { email: true, phone: true },
          })
        : null;
    if (!user) return;

    const results = await Promise.allSettled(
      allowed.map((channel) =>
        channelService.dispatchExternal({
          channel,
          userId: data.userId,
          recipientEmail: user.email ?? undefined,
          recipientPhone: user.phone ?? undefined,
          type: 'GENERAL',
          title: data.title,
          message: data.message,
        })
      )
    );

    if (markerId) {
      const outcomes: Record<string, string> = {};
      allowed.forEach((channel, i) => {
        const r = results[i];
        // A channel the policy blocks is not owed; a rejected or unsuccessful
        // dispatch stays FAILED for the next run to retry.
        outcomes[channel] =
          policy[channel] === false
            ? 'SKIPPED'
            : r.status === 'fulfilled' && r.value.success
              ? 'SENT'
              : 'FAILED';
      });
      await markDeliveryChannel(markerId, outcomes);
    }
  } catch (error) {
    console.error('External notification dispatch failed:', error);
  }
}

export async function createBulkNotifications(data: CreateBulkNotificationInput) {
  const { userIds, ...notificationData } = data;
  const { dbType, originalType } = mapTypeToPrisma(notificationData.type);
  const { priority, channels, ...rest } = notificationData;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notifications: any[] = userIds.map((userId) => ({
    ...rest,
    type: dbType,
    userId,
    data: {
      ...(originalType ? { originalType } : {}),
      priority,
      channels,
    },
  }));

  return prisma.notification.createMany({
    data: notifications,
  });
}

export async function createManyNotifications(data: CreateNotificationInput[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const notifications: any[] = data.map((item) => {
    const { dbType, originalType } = mapTypeToPrisma(item.type ?? 'INFO');
    const { priority, channels, recipientType, recipientIds, ...rest } = item;

    return {
      userId: item.userId,
      title: item.title,
      message: item.message,

      type: dbType,
      link: item.link,
      data: {
        ...(item.data || {}),
        ...(originalType ? { originalType } : {}),
        ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
        priority,
        channels,
        recipientType,
        ...(recipientIds ? { recipientIds } : {}),
        ...(item.unitId ? { unitId: item.unitId } : {}),
        ...(item.classId ? { classId: item.classId } : {}),
        ...(item.role ? { role: item.role } : {}),
      },
      scheduledAt: item.scheduledAt || null,
    };
  });

  return prisma.notification.createMany({
    data: notifications,
  });
}

export async function markAsRead(id: string, userId: string) {
  return prisma.notification.updateMany({
    where: { id, userId },
    data: { status: NotificationStatus.READ, readAt: new Date() },
  });
}

export async function markAllAsRead(userId: string) {
  return prisma.notification.updateMany({
    where: { userId, status: NotificationStatus.UNREAD },
    data: { status: NotificationStatus.READ, readAt: new Date() },
  });
}

export async function deleteNotification(id: string, userId: string) {
  return prisma.notification.deleteMany({ where: { id, userId } });
}

// ==================== WEB PUSH (browser) ====================

/**
 * How many devices one account may register a push endpoint from.
 *
 * A person plausibly uses a few (phone, tablet, laptop); an unbounded table lets
 * one authenticated client create unlimited rows with distinct endpoints
 * (CWE-770). Generous enough that a real user never hits it, small enough to
 * bound the table.
 */
export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;

/**
 * Store the caller's browser push subscription.
 *
 * A browser endpoint identifies a *device*, not a person, and it is stable
 * across sign-ins: the same endpoint returns on every re-subscribe. Reassigning
 * it to whoever last registered would let anyone who learns the endpoint
 * silently hijack a device's notification routing (CWE-639), so an endpoint
 * already owned by another user is refused rather than moved.
 *
 * Re-subscribing with the *same* user is the normal case (keys rotate, the
 * device changes UA) and refreshes the row in place — so an existing endpoint is
 * never counted against the per-user cap.
 */
export async function subscribePush(
  userId: string,
  subscription: {
    endpoint: string;
    keys: { p256dh: string; auth: string };
  },
  userAgent: string | null
): Promise<'created' | 'updated'> {
  const existing = await prisma.pushSubscription.findUnique({
    where: { endpoint: subscription.endpoint },
    select: { id: true, userId: true },
  });

  if (existing && existing.userId !== userId) {
    // Do not name the device or the current owner; the caller must not be able
    // to probe whose endpoint it is.
    throw Errors.conflict('This push endpoint is already registered to another account');
  }

  if (existing) {
    await prisma.pushSubscription.update({
      where: { id: existing.id },
      data: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent,
      },
    });
    return 'updated';
  }

  // A brand-new endpoint: refuse once the account already holds the maximum, so
  // one client cannot grow the table without bound (CWE-770).
  const current = await prisma.pushSubscription.count({ where: { userId } });
  if (current >= MAX_PUSH_SUBSCRIPTIONS_PER_USER) {
    throw Errors.badRequest(
      `Batas ${MAX_PUSH_SUBSCRIPTIONS_PER_USER} perangkat untuk notifikasi push tercapai. ` +
        'Matikan push di salah satu perangkat lalu coba lagi.'
    );
  }

  await prisma.pushSubscription.create({
    data: {
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      userAgent,
    },
  });
  return 'created';
}

/** Remove the caller's subscription for one endpoint (on unsubscribe/logout). */
export async function unsubscribePush(userId: string, endpoint: string): Promise<number> {
  // Scoped to the caller: another user's endpoint is not theirs to delete, and
  // matching on userId makes a stale/foreign endpoint a no-op.
  const { count } = await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId },
  });
  return count;
}

/** Whether this user has a stored row for the given endpoint. */
export async function hasPushSubscription(userId: string, endpoint: string): Promise<boolean> {
  const row = await prisma.pushSubscription.findFirst({
    where: { userId, endpoint },
    select: { id: true },
  });
  return row !== null;
}

/**
 * Drop every push subscription a user has.
 *
 * Called on logout and on password reset: an endpoint left behind would keep
 * delivering that person's private notifications to a device they no longer
 * control (CWE-200). A device re-subscribes on its next login, so clearing is
 * safe.
 */
export async function deleteAllPushSubscriptions(userId: string): Promise<number> {
  const { count } = await prisma.pushSubscription.deleteMany({ where: { userId } });
  return count;
}

/**
 * Drop every push subscription for a user *except* one endpoint.
 *
 * The logout path uses this when the client named an endpoint it no longer
 * trusts (a stale or foreign value): the account is no longer signed in
 * anywhere, so every device must be cleared, but the named endpoint was already
 * removed by `unsubscribePush` and deleting it twice would double-count.
 */
export async function deleteAllPushSubscriptionsExcept(
  userId: string,
  endpoint: string
): Promise<number> {
  const { count } = await prisma.pushSubscription.deleteMany({
    where: { userId, endpoint: { not: endpoint } },
  });
  return count;
}
