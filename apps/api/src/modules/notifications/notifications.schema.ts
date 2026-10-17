import { z } from 'zod';
import {
  pushEndpointSchema,
  updateNotificationPreferencesSchema,
  webPushSubscriptionSchema,
} from '@cipansor/shared';

// We define the enum manually to match @cipansor/shared and include Prisma's types for compatibility
// Shared: ANNOUNCEMENT, ATTENDANCE, FINANCE, ACADEMIC, PERMIT, HEALTH, VIOLATION, REWARD, SYSTEM
// Prisma: INFO, ANNOUNCEMENT, REMINDER, ALERT, PAYMENT, ACADEMIC
export const NotificationTypeEnum = z.enum([
  'ANNOUNCEMENT',
  'ATTENDANCE',
  'FINANCE',
  'ACADEMIC',
  'PERMIT',
  'HEALTH',
  'VIOLATION',
  'REWARD',
  'SYSTEM',
  'INFO',
  'REMINDER',
  'ALERT',
  'PAYMENT',
]);

export const NotificationPriorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
export const NotificationChannelEnum = z.enum(['IN_APP', 'EMAIL', 'SMS', 'PUSH', 'WHATSAPP']);
export const RecipientTypeEnum = z.enum(['ALL', 'UNIT', 'CLASS', 'ROLE', 'INDIVIDUAL']);

/**
 * Largest raw notification body a request may carry, in characters.
 *
 * The email channel escapes this text into HTML before sending, and escaping
 * turns one character into as many as six (`"` → `&quot;`, `'` → `&#039;`).
 * With the template shell (~4 KB) that worst case has to stay under the
 * transport's `MAX_EMAIL_BODY_LENGTH` (10 MiB), or the API would accept a body
 * the email channel then refuses and the recipient never gets it. 1 MiB raw ×
 * 6 + 4 KB ≈ 6 MiB, comfortably inside 10 MiB, and far above any real
 * pengumuman or notification message.
 *
 * The 10 MiB `express.json` limit is a separate, coarser backstop on the whole
 * request; this one is the semantic cap that keeps an accepted message
 * deliverable on every channel.
 */
export const MAX_NOTIFICATION_CONTENT_LENGTH = 1_048_576;

// ==================== NOTIFICATION ====================

export const createNotificationSchema = z.object({
  userId: z.string().uuid().optional(), // Optional for bulk/system
  title: z.string().min(1).max(255),
  message: z.string().min(1).max(MAX_NOTIFICATION_CONTENT_LENGTH),
  type: NotificationTypeEnum.default('INFO'),
  priority: NotificationPriorityEnum.default('NORMAL'),
  channels: z.array(NotificationChannelEnum).default(['IN_APP']),

  // Recipient info
  recipientType: RecipientTypeEnum.default('INDIVIDUAL'),
  recipientIds: z.array(z.string()).optional(),
  unitId: z.string().optional(),
  classId: z.string().optional(),
  role: z.string().optional(),

  link: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  scheduledAt: z.coerce.date().optional(),
  /**
   * Durable delivery key for recurring, idempotent notifications (#802).
   *
   * A scheduled task that reruns (a due invoice reminded daily, an over-budget
   * plan alerted every Monday) must send each recipient/subject once per slot.
   * When set, the row is skipped if a previous notification with the same
   * `userId` + `dedupeKey` exists. Omit it for one-shot notifications so
   * genuinely repeatable messages are never suppressed. Persisted in the
   * `Notification.dedupe_key` column, whose unique index is the real backstop.
   */
  dedupeKey: z.string().min(1).max(255).optional(),
});

export const createBulkNotificationSchema = createNotificationSchema
  .extend({
    userIds: z.array(z.string().uuid()).min(1),
  })
  .omit({ userId: true, recipientType: true, recipientIds: true });

export const queryNotificationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: NotificationTypeEnum.optional(),
  isRead: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
  priority: NotificationPriorityEnum.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
});

// Use the INPUT type so fields with schema defaults (priority, channels,
// recipientType, type) are optional for internal callers that build a
// notification directly without re-parsing (e.g. permits, scheduler).
export type CreateNotificationInput = z.input<typeof createNotificationSchema>;
export type CreateBulkNotificationInput = z.infer<typeof createBulkNotificationSchema>;
export type QueryNotificationInput = z.infer<typeof queryNotificationSchema>;

// ==================== WEB PUSH ====================

/**
 * The push contract lives once, in `@cipansor/shared`
 * (`webPushSubscriptionSchema`) — the API validates with it at the edge and the
 * web builds its payload from the same type, so the two cannot drift. The
 * endpoint refinement (HTTPS on a known browser push service only) that keeps
 * the sender from becoming an SSRF primitive is part of that shared schema.
 */
export const pushSubscribeSchema = z.object({
  subscription: webPushSubscriptionSchema,
});

export const pushUnsubscribeSchema = z.object({
  endpoint: pushEndpointSchema,
});

/** Query for the ownership check (GET /notifications/push/status). */
export const pushStatusQuerySchema = z.object({
  endpoint: pushEndpointSchema,
});

export type PushSubscribeInput = z.infer<typeof pushSubscribeSchema>;
export type PushUnsubscribeInput = z.infer<typeof pushUnsubscribeSchema>;

/** PATCH /notifications/preferences — the shared contract, any subset. */
export const updatePreferencesSchema = updateNotificationPreferencesSchema;
