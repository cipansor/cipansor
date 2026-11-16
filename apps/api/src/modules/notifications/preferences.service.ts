/**
 * Notification preferences — what a person wants to hear about, and how.
 *
 * Until 2026-10-03 this file only returned defaults: `updatePreferences` merged
 * the change and threw it away ("In production, this would save…"), there was
 * no route for the settings page to call, and the page faked its own save with
 * a 500 ms timer. Every toggle a wali switched off came back on. The row now
 * lives in `notification_preferences`; a user with no row gets
 * `DEFAULT_NOTIFICATION_PREFERENCES`.
 */

import { prisma } from '@/lib/prisma';
import { wibMinutesOfDay } from '@/utils/wib';
import { Errors } from '@/middleware/error';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  notificationPreferencesSchema,
  type NotificationKindKey,
  type NotificationPreferencesDTO,
  type NotificationPreferencesInput,
  type UpdateNotificationPreferencesInput,
} from '@cipansor/shared';

export type NotificationPreferences = NotificationPreferencesDTO;

const SELECT = {
  emailEnabled: true,
  smsEnabled: true,
  whatsappEnabled: true,
  pushEnabled: true,
  paymentReminders: true,
  attendanceAlerts: true,
  academicUpdates: true,
  tahfidzProgress: true,
  announcements: true,
  eventReminders: true,
  monthlyReports: true,
  quietHoursStart: true,
  quietHoursEnd: true,
  reminderFrequency: true,
} as const;

/** The user's preferences, or the defaults when they never saved any. */
export async function getPreferences(userId: string): Promise<NotificationPreferences> {
  const row = await prisma.notificationPreference.findUnique({
    where: { userId },
    select: SELECT,
  });
  return { userId, ...(row ?? DEFAULT_NOTIFICATION_PREFERENCES) };
}

/**
 * Preferences for many users at once (the push dispatcher's batch), keyed by
 * user id. Users with no row get the defaults.
 */
export async function getPreferencesFor(
  userIds: string[]
): Promise<Map<string, NotificationPreferences>> {
  const rows = await prisma.notificationPreference.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, ...SELECT },
  });
  const byUser = new Map(rows.map((row) => [row.userId, row]));
  return new Map(
    userIds.map((userId) => [
      userId,
      { ...DEFAULT_NOTIFICATION_PREFERENCES, ...byUser.get(userId), userId },
    ])
  );
}

/**
 * Apply a partial change and store the result.
 *
 * The change is checked again once merged with what is stored: quiet hours set
 * in one request and cleared in half in the next must not leave a start with no
 * end. The table holds the same rule as a CHECK constraint.
 */
export async function updatePreferences(
  userId: string,
  updates: UpdateNotificationPreferencesInput
): Promise<NotificationPreferences> {
  const { userId: _ignored, ...current } = await getPreferences(userId);
  const merged = notificationPreferencesSchema.safeParse({ ...current, ...updates });
  if (!merged.success) {
    throw Errors.badRequest(merged.error.issues[0]?.message ?? 'Preferensi tidak valid');
  }
  const data: NotificationPreferencesInput = merged.data;
  const row = await prisma.notificationPreference.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
    select: SELECT,
  });
  return { userId, ...row };
}

/** Back to the defaults (the settings page's "Reset" followed by save). */
export async function resetPreferences(userId: string): Promise<NotificationPreferences> {
  return updatePreferences(userId, DEFAULT_NOTIFICATION_PREFERENCES);
}

/**
 * Whether a notification of this kind may go out on this channel.
 *
 * `kind` null is a notification that belongs to no switchable kind (a permit
 * decision, an approval waiting for the reader) — only the channel decides.
 */
export function allowsKind(
  prefs: NotificationPreferencesInput,
  kind: NotificationKindKey | null,
  channel: 'email' | 'sms' | 'whatsapp' | 'push'
): boolean {
  if (kind && !prefs[kind]) return false;
  switch (channel) {
    case 'email':
      return prefs.emailEnabled;
    case 'sms':
      return prefs.smsEnabled;
    case 'whatsapp':
      return prefs.whatsappEnabled;
    case 'push':
      return prefs.pushEnabled;
  }
}

/** Check if a notification should be sent, reading the stored preferences. */
export async function shouldSendNotification(
  userId: string,
  type: NotificationKindKey,
  channel: 'email' | 'sms' | 'whatsapp' | 'push'
): Promise<boolean> {
  return allowsKind(await getPreferences(userId), type, channel);
}

/** Minutes past midnight, Western Indonesian Time. */
const wibMinutes = (now: Date): number => wibMinutesOfDay(now);

function clockMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Whether `now` falls inside the person's quiet hours.
 *
 * The hours are wall-clock WIB, as typed on the settings page. This used to
 * read `now.getHours()`, the *server's* clock — UTC on App Service — so quiet
 * hours of 21:00–05:00 were in force from 04:00 to 12:00 WIB.
 */
export function isInQuietHours(
  prefs: Pick<NotificationPreferencesInput, 'quietHoursStart' | 'quietHoursEnd'>,
  now: Date = new Date()
): boolean {
  if (!prefs.quietHoursStart || !prefs.quietHoursEnd) return false;
  const current = wibMinutes(now);
  const start = clockMinutes(prefs.quietHoursStart);
  const end = clockMinutes(prefs.quietHoursEnd);
  // Overnight (e.g. 21:00 – 05:00) wraps past midnight.
  if (start > end) return current >= start || current < end;
  return current >= start && current < end;
}
