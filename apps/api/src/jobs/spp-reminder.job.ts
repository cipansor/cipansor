/**
 * Monthly SPP reminder job.
 *
 * Runs on the 1st of each month (after auto-billing has generated the
 * month's invoices): every parent linked to a student with an unpaid
 * invoice due this month gets an in-app notification plus a WhatsApp
 * message. WhatsApp goes through the multi-provider whatsapp.service
 * (Meta WhatsApp Cloud API by default; log-only in SIMULATOR mode when
 * no provider credentials are configured).
 */

import { PaymentStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import * as notificationService from '@/modules/notifications/notifications.service';
import { buildSppReminderContent } from '@/modules/notifications/reminder-content';
import { wibMonthYear, utcMonthRange } from '@/utils/wib';

/**
 * Send SPP reminders for every unpaid invoice due in the given month to all
 * linked parents. Returns a summary for logging and tests.
 */
export async function sendMonthlySppReminders(now: Date = new Date()) {
  // Match the WIB month the auto-billing job labelled its invoices with, so the
  // reminder window does not drift a month away from them.
  const { year, month } = wibMonthYear(now);
  // `dueDate` holds a date-only value at midnight UTC, so the window bounds it
  // the same way: [1st 00:00Z, next 1st 00:00Z). A WIB-midnight range would
  // start the month at 17:00Z the day before and pull the next month's first
  // day (00:00Z) into this one.
  const { start: monthStart, end: monthEnd } = utcMonthRange(year, month);

  const invoices = await prisma.invoice.findMany({
    where: {
      status: { in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL, PaymentStatus.OVERDUE] },
      dueDate: { gte: monthStart, lt: monthEnd },
    },
    include: {
      paymentType: { select: { name: true } },
      student: {
        select: {
          id: true,
          user: { select: { name: true } },
          parents: {
            select: {
              parent: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  let notified = 0;
  for (const invoice of invoices) {
    for (const link of invoice.student.parents) {
      const parent = link.parent;
      try {
        // One delivery marker per (parent, invoice): the WhatsApp channel now
        // goes through `createNotification`, so a failed send is recorded
        // `FAILED`/`PENDING` and retried by the daily sweep instead of being
        // silently dropped (#1074), and a task triggered twice does not send
        // twice. `spp-reminder:<invoice.id>` is unique per parent because the
        // marker's unique key is `(userId, dedupeKey)` and the user is the parent.
        //
        // `retryExisting: false`: this job only *creates*. A second trigger in
        // the same day leaves the retry to the sweep, so it does not spend the
        // day's attempt quota (#1074).
        await notificationService.createNotification(
          {
            userId: parent.id,
            ...buildSppReminderContent(invoice),
            dedupeKey: `spp-reminder:${invoice.id}`,
          },
          { retryExisting: false }
        );
        notified++;
      } catch (error) {
        logger.error(`[SppReminder] Failed to notify parent ${parent.id}:`, error);
      }
    }
  }

  logger.info(
    `[SppReminder] ${invoices.length} unpaid invoices this month, ${notified} parent notifications sent`
  );
  return { invoices: invoices.length, notified };
}
