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
 * Per-channel delivery states on a marker.
 *
 * `RETRYING` is a *claim*: written before a dispatch so a second run sees the
 * channel is taken and stays silent. `PENDING` is a log-only outcome (print,
 * not sent — transport unconfigured, simulator, outbound disabled): retryable,
 * kept distinct from `FAILED` so a real outage and a not-yet-configured
 * transport are told apart.
 *
 * A channel the channel policy blocks is recorded under `channels.skip`
 * instead of a state, so a temporary disablement never overwrites a retryable
 * `FAILED`/`PENDING` (review finding on #804) — re-enabling lets the next run
 * claim it.
 */
export const DELIVERY_IN_FLIGHT = 'RETRYING';
export const DELIVERY_SENT = 'SENT';
export const DELIVERY_FAILED = 'FAILED';
export const DELIVERY_PENDING = 'PENDING';

/**
 * How long a `RETRYING` claim stays valid before another run may take it over.
 * Longer than every scheduler period (hourly at most), so a live run's late
 * outcome can never overwrite a newer one: by the time a claim can be stolen,
 * the next scheduled tick has already passed and handles the recovery cleanly
 * (review finding on #804, where a 15-minute lease let a stalled send's late
 * failure replace a newer SENT).
 */
const CHANNEL_CLAIM_LEASE_MS = 60 * 60 * 1000;

/**
 * Claim the delivery slot for `(userId, dedupeKey)` and, for a fresh slot,
 * insert the in-app row in the same transaction.
 *
 * The marker and the row must land together: if the marker were committed
 * first, a concurrent run could observe it, claim an external channel and send
 * — and then this run's failed insert would delete the marker, leaving no
 * durable `SENT` to suppress the next run (review finding on #804). In one
 * transaction the marker is invisible until the row exists, so a lost race
 * rolls both back and a later run claims the slot afresh.
 *
 * A pre-existing marker (the unique key is taken) means the slot was already
 * claimed; `created` is false and no row is inserted.
 */
async function claimNotificationDeliveryWithRow(
  userId: string,
  dedupeKey: string,
  createRow: (tx: Prisma.TransactionClient) => Promise<{ id: string }>
): Promise<{ marker: NotificationDeliveryMarker; created: boolean }> {
  try {
    return await prisma.$transaction(async (tx) => {
      const created = await tx.notificationDelivery.create({
        data: { userId, dedupeKey, channels: {} },
      });
      await createRow(tx);
      return { marker: { id: created.id, channels: {} }, created: true };
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await prisma.notificationDelivery.findUnique({
      where: { userId_dedupeKey: { userId, dedupeKey } },
      select: { id: true, channels: true },
    });
    // A lost race between two ticks can delete the row between the failed
    // create and this read; treat it as claimable again rather than crashing.
    if (!existing) return claimNotificationDeliveryWithRow(userId, dedupeKey, createRow);
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

/**
 * Atomically claim one channel for a dispatch, so two runs — separate API
 * instances, or a manual trigger overlapping a scheduled tick — never send the
 * same message twice.
 *
 * The claim is a compare-and-swap on the marker's `channels` map, done by the
 * database (`UPDATE ... WHERE`, row-locked), not in memory: a channel is
 * claimable when it is unset or left by a previous failed attempt, and the
 * winner flips it to `RETRYING` in the same statement. A second run's `WHERE`
 * no longer matches, so it learns it lost the race and stays silent.
 *
 * The claim is a lease, its claim time kept under `channels._claims[channel]`
 * (epoch ms): a `RETRYING` older than `staleBefore` is claimable again, so a
 * run killed mid-send (deploy, crash) does not wedge the channel forever.
 * `markDeliveryOutcome` clears the lease on completion, but only if this claim
 * is still the current one — a late result from an expired claim cannot
 * overwrite a newer outcome (review finding on #804). The claim time is the
 * caller's clock (`claimedAt`) so it can be matched back exactly; both clocks
 * only have to be consistent with each other, and they are the same process.
 * Returns whether the claim succeeded.
 */
async function claimChannelForRetry(
  markerId: string,
  channel: string,
  claimedAt: number,
  staleBefore: Date
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "notification_deliveries"
    SET "channels" =
          COALESCE("channels", '{}'::jsonb) ||
          jsonb_build_object(${channel}::text, ${DELIVERY_IN_FLIGHT}::text) ||
          jsonb_build_object(
            '_claims'::text,
            COALESCE("channels" -> '_claims', '{}'::jsonb) ||
              jsonb_build_object(
                ${channel}::text,
                ${claimedAt}::bigint
              )
          ),
        "updated_at" = now()
    WHERE "id" = ${markerId}
      AND (
        jsonb_extract_path_text("channels", ${channel}::text) IS NULL
        OR jsonb_extract_path_text("channels", ${channel}::text) IN (${DELIVERY_FAILED}, ${DELIVERY_PENDING})
        OR (
          jsonb_extract_path_text("channels", ${channel}::text) = ${DELIVERY_IN_FLIGHT}
          AND COALESCE(
            (jsonb_extract_path_text("channels", '_claims', ${channel}::text))::bigint,
            0
          ) < ${staleBefore.getTime()}
        )
      )
    RETURNING "id"
  `;
  return rows.length > 0;
}

/**
 * Record a channel's outcome and clear its lease (idempotent upsert), but only
 * while the channel still belongs to this attempt.
 *
 * The `WHERE` compares the recorded claim time against `claimedAt` (the value
 * written by this attempt's `claimChannelForRetry`): if the lease expired and
 * another run reclaimed and finished the channel, this late result matches no
 * row and is dropped. `jsonb_extract_path_text` yields a string, so the claim
 * is compared as text — JSON serialises an integer number without an exponent,
 * exactly like the `String(epochMs)` this attempt passes.
 */
async function markDeliveryOutcome(
  markerId: string,
  channel: string,
  state: string,
  claimedAt: number
) {
  await prisma.$executeRaw`
    UPDATE "notification_deliveries"
    SET "channels" = (
          COALESCE("channels", '{}'::jsonb) ||
            jsonb_build_object(${channel}::text, ${state}::text)
        ) #- ARRAY['_claims'::text, ${channel}::text],
        "updated_at" = now()
    WHERE "id" = ${markerId}
      AND jsonb_extract_path_text("channels", '_claims', ${channel}::text) = ${String(claimedAt)}
  `;
}

/**
 * Record a policy decision (a blocked channel) without touching the channel's
 * outstanding delivery state, under `channels.skip[channel]`. A temporary
 * disablement must not overwrite a retryable `FAILED`/`PENDING`, or the
 * reminder is lost when the channel is re-enabled (review finding on #804).
 */
async function markChannelPolicySkipped(markerId: string, channel: string) {
  await prisma.$executeRaw`
    UPDATE "notification_deliveries"
    SET "channels" =
          COALESCE("channels", '{}'::jsonb) ||
          jsonb_build_object(
            'skip'::text,
            COALESCE("channels" -> 'skip', '{}'::jsonb) ||
              jsonb_build_object(
                ${channel}::text,
                (extract(epoch from now()) * 1000)::bigint
              )
          ),
        "updated_at" = now()
    WHERE "id" = ${markerId}
  `;
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
    const rowData = buildCreateData(data, dbType, originalType, dedupeKey);
    // Marker + in-app row land in one transaction (see
    // claimNotificationDeliveryWithRow): a concurrent run can only observe the
    // marker once the row is durable, so a failed insert can no longer race a
    // channel send.
    const { marker, created } = await claimNotificationDeliveryWithRow(
      data.userId,
      dedupeKey,
      (tx) => tx.notification.create({ data: rowData })
    );

    if (!created) {
      // The in-app row is already there. Retry the channels that never
      // confirmed (a transient outage, a not-yet-configured transport) — or
      // whose earlier attempt was abandoned mid-send. Channels already SENT (or
      // blocked by policy) are left alone. The per-channel claim inside
      // dispatchExternalChannels is what makes two concurrent retries send only
      // one message.
      await dispatchExternalChannels({ ...data, userId: data.userId }, externalChannels, marker.id);
      return null;
    }

    // The row is durable; fan out outside the transaction so a slow transport
    // never holds a database lock.
    if (externalChannels.length > 0) {
      await dispatchExternalChannels({ ...data, userId: data.userId }, externalChannels, marker.id);
    }
    return originalType ? { ...(rowData as object), type: originalType } : rowData;
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
 *
 * For a keyed notification each channel is first *claimed* atomically
 * (`claimChannelForRetry`), so two concurrent runs send at most one message per
 * channel. A channel already `SENT`, blocked by policy, or held by another run
 * is skipped. A log-only outcome (nothing left the building) is recorded
 * `PENDING`, not `SENT`: a transport configured later still delivers.
 *
 * The claim time returned by `claimChannelForRetry` is carried through to
 * `markDeliveryOutcome`, which only writes while that claim is still current —
 * so a late result from an expired claim cannot clobber a newer one.
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
    const policyAllowed = externalChannels.filter((c) => policy[c]);

    if (markerId) {
      // A blocked channel is not owed; record the decision under `channels.skip`
      // without touching its delivery state, so a temporary disablement does not
      // lose a retryable FAILED/PENDING (review finding on #804).
      for (const channel of externalChannels.filter((c) => !policy[c])) {
        await markChannelPolicySkipped(markerId, channel);
      }
    }
    if (policyAllowed.length === 0) return;

    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { email: true, phone: true },
    });
    if (!user) return;

    // Claim each channel up front, then dispatch only the ones we won. The
    // claim is a lease: a stale `RETRYING` (a run killed mid-send) is
    // re-claimable after the window below.
    let toDispatch = policyAllowed;
    const claimTimes: Record<string, number> = {};
    if (markerId) {
      const staleBefore = new Date(Date.now() - CHANNEL_CLAIM_LEASE_MS);
      const claimed = await Promise.all(
        policyAllowed.map(async (channel) => {
          // The claim's own timestamp is written to the marker so the outcome
          // can be tied to this exact attempt.
          const claimedAt = Date.now();
          const won = await claimChannelForRetry(markerId, channel, claimedAt, staleBefore);
          return { channel, won, claimedAt };
        })
      );
      toDispatch = claimed.filter((c) => c.won).map((c) => c.channel);
      for (const c of claimed) if (c.won) claimTimes[c.channel] = c.claimedAt;
    }
    if (toDispatch.length === 0) return;

    const results = await Promise.allSettled(
      toDispatch.map((channel) =>
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

    if (!markerId) return;
    // Each outcome is written by a deterministic statement (`Promise.all` over
    // known channels), never a read-modify-write of the map, so two runs can
    // never clobber each other's states.
    await Promise.all(
      toDispatch.map(async (channel, i) => {
        const r = results[i];
        // `success` says the call worked; `delivered` says the message left.
        // A log-only transport reports success without delivering, so it must
        // not be recorded SENT or the reminder is lost once a real transport is
        // configured. Non-EMAIL channels leave `delivered` undefined (a sent
        // SMS/WhatsApp carries no such flag), so they key on `success`.
        const state =
          r.status === 'fulfilled' && r.value.success && r.value.delivered !== false
            ? DELIVERY_SENT
            : r.status === 'fulfilled' && r.value.success
              ? DELIVERY_PENDING
              : DELIVERY_FAILED;
        await markDeliveryOutcome(markerId, channel, state, claimTimes[channel]);
      })
    );
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
