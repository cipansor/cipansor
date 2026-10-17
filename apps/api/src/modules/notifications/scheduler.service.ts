/**
 * Notification Scheduler Service
 *
 * Automated notification scheduling for:
 * - Payment reminders (H-7, H-3, H-1)
 * - Attendance alerts
 * - Tahfidz progress reports
 * - Event reminders
 * - Monthly reports
 */

import { prisma } from '../../lib/prisma';
import {
  createNotification,
  createManyNotifications,
  clearNotificationDeliveries,
} from './notifications.service';
import { CreateNotificationInput } from './notifications.schema';
import { type ScheduledTaskId } from './scheduler.tasks';
import { NotificationType, AttendanceStatus, PaymentStatus, EventScope } from '@prisma/client';
import { logger } from '../../lib/logger';
import { STUDENT_STATUS } from '@cipansor/shared';
import { todayWib, dayOf, dayString } from '../../utils/wib';
import cron, { type ScheduledTask as CronTask } from 'node-cron';

interface ScheduledTask {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  cronTask: CronTask | null;
  running: boolean;
  lastRun?: Date;
}

export class SchedulerService {
  private static tasks: Map<string, ScheduledTask> = new Map();
  private static initialized = false;

  static initialize(): void {
    if (this.initialized) return;

    this.registerDefaultTasks();
    this.initialized = true;
    logger.info('Notification Scheduler initialized');
  }

  private static registerDefaultTasks(): void {
    // Schedules are WIB wall-clock (Asia/Jakarta), the same as `src/jobs/scheduler.ts`.
    // `node-cron` fires each at its own minute; the old `setInterval`-plus-
    // `shouldRunTask` pairing ticked every hour from the boot minute, so an API
    // started at 07:35 looked for minute 0 at 08:35, 09:35, … and — every
    // schedule being minute 0 — never ran a single job (#802).
    this.registerTask('payment-reminder', 'Payment Due Reminder', '0 8 * * *', () =>
      this.sendPaymentReminders()
    );

    this.registerTask('attendance-summary', 'Daily Attendance Summary', '0 18 * * *', () =>
      this.sendAttendanceSummary()
    );

    // Fridays at 4 PM.
    this.registerTask('tahfidz-progress', 'Weekly Tahfidz Progress', '0 16 * * 5', () =>
      this.sendTahfidzProgress()
    );

    this.registerTask('event-reminder', 'Upcoming Event Reminder', '0 7 * * *', () =>
      this.sendEventReminders()
    );

    // 1st of month at 9 AM.
    this.registerTask('monthly-report', 'Monthly Progress Report', '0 9 1 * *', () =>
      this.sendMonthlyReport()
    );

    // The monthly SPP reminder to parents lives in `src/jobs/scheduler.ts`
    // (`sendMonthlySppReminders` from `jobs/spp-reminder.job`) on the same
    // `0 6 1 * *` WIB slot. Registering it here too sent every parent the same
    // reminder twice on the 1st; the jobs/ job remains the one true sender.

    // Mondays at 7 AM.
    this.registerTask(
      'budget-overrun-alert',
      'Strategic Plan Budget Overrun Alert',
      '0 7 * * 1',
      () => this.sendBudgetOverrunAlerts()
    );
  }

  private static registerTask(
    id: ScheduledTaskId,
    name: string,
    schedule: string,
    handler: () => Promise<void>
  ): void {
    const cronTask = cron.schedule(
      schedule,
      async () => {
        const task = this.tasks.get(id);
        if (!task || !task.enabled) return;
        // node-cron will not re-enter a running task, but a manual trigger
        // through the API can overlap a scheduled tick; skip rather than send
        // twice.
        if (task.running) {
          logger.warn('Scheduled task still running, skipping tick: ' + name);
          return;
        }

        logger.info('Running scheduled task: ' + name);
        task.running = true;
        task.lastRun = new Date();

        try {
          await handler();
          logger.info('Task completed: ' + name);
        } catch (error) {
          logger.error('Task failed: ' + name, error);
        } finally {
          task.running = false;
        }
      },
      { timezone: 'Asia/Jakarta' }
    );

    this.tasks.set(id, {
      id,
      name,
      schedule,
      enabled: true,
      cronTask,
      running: false,
    });
  }

  static startAll(): void {
    this.tasks.forEach((task) => task.cronTask?.start());
    logger.info('Scheduler tasks started');
  }

  static stopAll(): void {
    this.tasks.forEach((task) => {
      task.cronTask?.stop();
    });
    logger.info('Scheduler tasks stopped');
  }

  static enableTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (task) {
      task.enabled = true;
      return true;
    }
    return false;
  }

  static disableTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (task) {
      task.enabled = false;
      return true;
    }
    return false;
  }

  static getTaskStatus(): Array<{
    id: string;
    name: string;
    schedule: string;
    enabled: boolean;
    lastRun?: Date;
  }> {
    const statuses: Array<{
      id: string;
      name: string;
      schedule: string;
      enabled: boolean;
      lastRun?: Date;
    }> = [];

    this.tasks.forEach((task) => {
      statuses.push({
        id: task.id,
        name: task.name,
        schedule: task.schedule,
        enabled: task.enabled,
        lastRun: task.lastRun,
      });
    });

    return statuses;
  }

  // Manual trigger for testing
  static async runTask(taskId: string): Promise<void> {
    switch (taskId) {
      case 'payment-reminder':
        await this.sendPaymentReminders();
        break;
      case 'attendance-summary':
        await this.sendAttendanceSummary();
        break;
      case 'tahfidz-progress':
        await this.sendTahfidzProgress();
        break;
      case 'event-reminder':
        await this.sendEventReminders();
        break;
      case 'monthly-report':
        await this.sendMonthlyReport();
        break;
      case 'budget-overrun-alert':
        await this.sendBudgetOverrunAlerts();
        break;
      default:
        throw new Error('Unknown task: ' + taskId);
    }
  }

  // ============== TASK HANDLERS ==============

  /**
   * Alert unit admins when an active strategic plan's account-level
   * realization exceeds 120% of its budget (planning discipline signal —
   * same attribution caveats as the plan detail's realization figure).
   */
  private static async sendBudgetOverrunAlerts(): Promise<void> {
    const plans = await prisma.strategicPlan.findMany({
      where: {
        status: { in: ['APPROVED', 'IN_PROGRESS'] },
        budget: { not: null },
      },
      include: {
        objectives: {
          include: {
            activities: {
              include: {
                budgetRel: { include: { account: { select: { normalBalance: true } } } },
              },
            },
          },
        },
      },
      take: 50,
    });

    let alerts = 0;
    for (const plan of plans) {
      const budget = Number(plan.budget ?? 0);
      if (budget <= 0) continue;

      const accountBalance = new Map<string, string>();
      for (const objective of plan.objectives) {
        for (const activity of objective.activities) {
          if (activity.budgetRel) {
            accountBalance.set(
              activity.budgetRel.accountId,
              activity.budgetRel.account.normalBalance
            );
          }
        }
      }
      if (accountBalance.size === 0) continue;

      const endOfDay = new Date(plan.endDate);
      endOfDay.setUTCHours(23, 59, 59, 999);

      let realization = 0;
      for (const [accountId, normalBalance] of accountBalance) {
        const sums = await prisma.journalEntry.aggregate({
          where: {
            accountId,
            // A foundation-wide plan has no unit. Passing `null` here would filter for
            // journal entries whose unitId IS NULL; `undefined` omits the filter so the
            // aggregate spans every unit, which is what a yayasan-level plan means.
            unitId: plan.unitId ?? undefined,
            date: { gte: plan.startDate, lte: endOfDay },
          },
          _sum: { debit: true, credit: true },
        });
        const movement =
          normalBalance === 'DEBIT'
            ? Number(sums._sum.debit ?? 0) - Number(sums._sum.credit ?? 0)
            : Number(sums._sum.credit ?? 0) - Number(sums._sum.debit ?? 0);
        realization += Math.max(0, movement);
      }

      if (realization <= budget * 1.2) {
        // The plan recovered. Clear its delivery markers so a later overrun is
        // a new episode that alerts again; a permanent marker left a second
        // overrun silent (review finding on #804).
        await clearNotificationDeliveries(`budget-overrun:${plan.id}:`);
        continue;
      }

      const admins = await prisma.user.findMany({
        // Foundation-wide plans have no unit admin; `undefined` would notify every
        // unit admin in the system, so those plans notify nobody here and are left to
        // SUPER_ADMIN oversight.
        where: { role: 'UNIT_ADMIN', unitId: plan.unitId ?? '', isActive: true, deletedAt: null },
        select: { id: true },
      });
      const pct = Math.round((realization / budget) * 100);

      // One alert per admin per over-budget plan. Without the delivery key this
      // reran every Monday and piled a fresh alert on the same unchanged plan
      // (#802); the key makes a rerun a no-op until the plan recovers.
      const delivered = await Promise.all(
        admins.map((admin) =>
          createNotification({
            userId: admin.id,
            title: 'Realisasi Anggaran Melampaui Batas',
            message:
              'Realisasi rencana "' +
              plan.title +
              '" mencapai ' +
              pct +
              '% dari anggaran (ambang 120%). Mohon tinjau di modul Perencanaan.',
            type: NotificationType.ALERT,
            priority: 'HIGH',
            channels: ['IN_APP', 'EMAIL'],
            recipientType: 'INDIVIDUAL',
            dedupeKey: `budget-overrun:${plan.id}:${admin.id}`,
          })
        )
      );
      alerts += delivered.filter(Boolean).length;
    }
    logger.info('Budget overrun alert: ' + alerts + ' notifications sent');
  }

  private static async sendPaymentReminders(): Promise<void> {
    const now = new Date();
    const sevenDaysLater = new Date(now);
    sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

    // Get invoices that are PENDING or PARTIAL and due within 7 days
    const unpaidInvoices = await prisma.invoice.findMany({
      where: {
        status: {
          in: [PaymentStatus.PENDING, PaymentStatus.PARTIAL],
        },
        dueDate: {
          lte: sevenDaysLater,
          gte: now,
        },
      },
      include: {
        student: {
          include: {
            user: {
              select: { id: true, name: true, email: true, phone: true },
            },
          },
        },
        paymentType: true,
      },
      take: 100,
    });

    let sentCount = 0;

    for (const invoice of unpaidInvoices) {
      const student = invoice.student;
      if (!student?.user) continue;

      const daysUntilDue = Math.ceil(
        (invoice.dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );

      const typeName = invoice.paymentType?.name || 'SPP';
      const amount = Number(invoice.amount).toLocaleString('id-ID');
      const message =
        'Tagihan ' +
        typeName +
        ' sebesar Rp ' +
        amount +
        ' akan jatuh tempo dalam ' +
        daysUntilDue +
        ' hari.';

      // One reminder per invoice, ever. The daily rerun used to remind the same
      // unpaid invoice again every day (#802); the delivery key holds it to the
      // first time. A genuine change (a new invoice) has a new id and notifies.
      const created = await createNotification({
        userId: student.user.id,
        title: 'Pengingat Pembayaran',
        message,
        type: NotificationType.PAYMENT,
        priority: 'HIGH',
        channels: ['IN_APP', 'EMAIL'],
        recipientType: 'INDIVIDUAL',
        dedupeKey: `payment-reminder:${invoice.id}`,
      });
      if (created) sentCount++;
    }

    logger.info('Sent ' + sentCount + ' payment reminders');
  }

  private static async sendAttendanceSummary(): Promise<void> {
    // "Today" is the WIB calendar day. `Attendance.date` is `@db.Date` (UTC
    // midnight); `setHours(0,0,0,0)` on the UTC host produced the UTC day, so a
    // run straddling the 07:00 WIB boundary read the wrong day's absences —
    // same defect the event reminder had (#802).
    const today = dayOf(todayWib());
    const tomorrow = dayOf(SchedulerService.addDays(todayWib(), 1));

    // Get today's absent records using correct model name "Attendance"
    const absentRecords = await prisma.attendance.findMany({
      where: {
        date: {
          gte: today,
          lt: tomorrow,
        },
        status: AttendanceStatus.ABSENT,
      },
      include: {
        student: {
          include: {
            user: {
              select: { id: true, name: true, email: true, phone: true },
            },
          },
        },
      },
    });

    // Group by student
    const studentAbsences = new Map<
      string,
      { studentName: string; userId: string; count: number }
    >();

    for (const record of absentRecords) {
      if (!record.student?.user) continue;

      const existing = studentAbsences.get(record.studentId);
      if (existing) {
        existing.count++;
      } else {
        studentAbsences.set(record.studentId, {
          studentName: record.student.user.name,
          userId: record.student.user.id,
          count: 1,
        });
      }
    }

    const notifications: CreateNotificationInput[] = [];

    for (const data of studentAbsences.values()) {
      const title = 'Laporan Kehadiran Hari Ini';
      const message = data.studentName + ' tidak hadir pada ' + data.count + ' sesi hari ini.';

      notifications.push({
        userId: data.userId,
        title,
        message,
        type: NotificationType.ALERT,
        priority: 'HIGH',
        channels: ['IN_APP'],
        recipientType: 'INDIVIDUAL',
      });
    }

    if (notifications.length > 0) {
      await createManyNotifications(notifications);
    }

    const sentCount = notifications.length;
    logger.info('Sent ' + sentCount + ' attendance summaries');
  }

  private static async sendTahfidzProgress(): Promise<void> {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const tahfidzRecords = await prisma.tahfidzRecord.findMany({
      where: {
        createdAt: {
          gte: oneWeekAgo,
        },
      },
      include: {
        student: {
          include: {
            user: {
              select: { id: true, name: true, email: true, phone: true },
            },
          },
        },
      },
    });

    // Group by student - using correct field names: ayahStart, ayahEnd, totalAyah
    const studentProgress = new Map<
      string,
      {
        studentName: string;
        userId: string;
        totalAyat: number;
        sessions: number;
      }
    >();

    for (const record of tahfidzRecords) {
      if (!record.student?.user) continue;

      // Use totalAyah field from schema
      const ayatCount = record.totalAyah;
      const existing = studentProgress.get(record.studentId);

      if (existing) {
        existing.totalAyat += ayatCount;
        existing.sessions++;
      } else {
        studentProgress.set(record.studentId, {
          studentName: record.student.user.name,
          userId: record.student.user.id,
          totalAyat: ayatCount,
          sessions: 1,
        });
      }
    }

    const notifications: CreateNotificationInput[] = [];

    for (const data of studentProgress.values()) {
      const title = 'Laporan Tahfidz Mingguan';
      const message =
        'Alhamdulillah, ' +
        data.studentName +
        ' telah menghafal ' +
        data.totalAyat +
        ' ayat minggu ini dalam ' +
        data.sessions +
        ' sesi.';

      notifications.push({
        userId: data.userId,
        title,
        message,
        type: NotificationType.ACADEMIC,
        priority: 'NORMAL',
        channels: ['IN_APP'],
        recipientType: 'INDIVIDUAL',
      });
    }

    if (notifications.length > 0) {
      await createManyNotifications(notifications);
    }

    logger.info('Sent ' + notifications.length + ' tahfidz progress reports');
  }

  private static async sendEventReminders(): Promise<void> {
    // "Tomorrow" is the next WIB calendar day, not the next UTC day. The API
    // runs in UTC; `setHours(0,0,0,0)` produced the UTC day, so at 07:00 WIB the
    // window was 07:00-tomorrow to 07:00-the-day-after WIB and an event at 06:00
    // WIB tomorrow fell outside it — reminded two days early, then never (#802).
    const nextDay = SchedulerService.addDays(todayWib(), 1);
    const dayAfter = SchedulerService.addDays(nextDay, 1);
    const from = dayOf(nextDay);
    const to = dayOf(dayAfter);

    const events = await prisma.calendarEvent.findMany({
      where: {
        startDate: { gte: from, lt: to },
        // A draft is not yet part of the live calendar (decisions/absensi-pegawai.md),
        // and neither is a deleted one.
        isDraft: false,
        deletedAt: null,
      },
    });

    if (events.length === 0) return;

    let sentCount = 0;

    for (const event of events) {
      // The audience is the event's, not "every active user". A private,
      // unit-specific or class-specific event used to be broadcast to everyone,
      // leaking its title and location to unrelated users (#802, CWE-200).
      const recipients = await SchedulerService.eventRecipients(event);
      if (recipients.length === 0) continue;

      // The reminder time is the event's own WIB wall-clock (`startTime`), which
      // is what a reader means by "besok pukul …"; `startDate` is midnight UTC
      // for an all-day event and would print 07:00.
      const timeStr = event.startTime ?? null;

      const title = 'Pengingat Acara Besok';
      const locationPart = event.location ? ' di ' + event.location : '';
      const whenPart = timeStr ? ' pukul ' + timeStr : '';
      const message = event.title + ' akan dilaksanakan besok' + whenPart + locationPart + '.';

      for (const user of recipients) {
        // One reminder per recipient per event, however many times the day
        // rolls around (#802).
        const created = await createNotification({
          userId: user.id,
          title,
          message,
          type: NotificationType.REMINDER,
          priority: 'NORMAL',
          channels: ['IN_APP'],
          recipientType: 'INDIVIDUAL',
          dedupeKey: `event-reminder:${event.id}`,
        });
        if (created) sentCount++;
      }
    }

    logger.info('Sent ' + sentCount + ' event reminders');
  }

  /** "yyyy-MM-dd" plus n days, in the UTC-midnight space `dayOf` works in. */
  private static addDays(day: string, n: number): string {
    const d = dayOf(day);
    d.setUTCDate(d.getUTCDate() + n);
    return dayString(d);
  }

  /**
   * Who should receive a reminder for this event.
   *
   * `scope` is the audience of record (`EventScope`), so it decides the
   * recipient set rather than being inferred from whichever of `classId`/
   * `unitId` happens to be set (review finding: scope had no dispatch effect):
   * - `SPECIFIC_CLASS` → that class's active students and its homeroom teacher;
   * - `SPECIFIC_UNIT` → every active user of that unit;
   * - `ALL_UNITS` → every active user, but only when the event is unit-less and
   *   public (a foundation-wide announcement). A unit-bound event is that
   *   unit's audience whether public or not: the calendar shows a unit user
   *   their own unit plus unit-less public events, so reminding the whole
   *   system of a unit's event leaked its title and location elsewhere
   *   (#804 review, CWE-200).
   * A scope whose required id is missing notifies nobody (a class event with no
   * class is not everyone's).
   */
  private static async eventRecipients(event: {
    scope: EventScope;
    unitId: string | null;
    classId: string | null;
    isPublic: boolean;
  }): Promise<Array<{ id: string; name: string }>> {
    const select = { id: true, name: true } as const;

    const classAudience = async (classId: string) => {
      const enrollments = await prisma.classEnrollment.findMany({
        where: { classId, status: 'active' },
        select: { student: { select: { userId: true } } },
      });
      const ids = enrollments.map((e) => e.student.userId);
      const klass = await prisma.class.findUnique({
        where: { id: classId },
        select: { homeroomTeacher: { select: { userId: true } } },
      });
      if (klass?.homeroomTeacher?.userId) ids.push(klass.homeroomTeacher.userId);
      if (ids.length === 0) return [];
      return prisma.user.findMany({
        where: { id: { in: ids }, isActive: true, deletedAt: null },
        select,
      });
    };

    const unitAudience = (unitId: string) =>
      prisma.user.findMany({
        where: { unitId, isActive: true, deletedAt: null },
        select,
        take: 500,
      });

    switch (event.scope) {
      case EventScope.SPECIFIC_CLASS:
        return event.classId ? classAudience(event.classId) : [];
      case EventScope.SPECIFIC_UNIT:
        return event.unitId ? unitAudience(event.unitId) : [];
      case EventScope.ALL_UNITS:
        // A unit-bound event is that unit's, not the whole system's, however it
        // is labelled. Only a unit-less public event is foundation-wide.
        if (event.unitId) return unitAudience(event.unitId);
        if (event.isPublic) {
          return prisma.user.findMany({
            where: { isActive: true, deletedAt: null },
            select,
            take: 500,
          });
        }
        return [];
      default:
        return [];
    }
  }

  private static async sendMonthlyReport(): Promise<void> {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    const monthName = lastMonth.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

    const students = await prisma.student.findMany({
      where: {
        status: STUDENT_STATUS.ACTIVE,
      },
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
      take: 200,
    });

    const notifications: CreateNotificationInput[] = [];

    for (const student of students) {
      if (!student.user) continue;

      const studentName = student.user.name;
      const title = 'Laporan Bulanan ' + monthName;
      const message =
        'Laporan progress bulanan ' +
        studentName +
        ' untuk bulan ' +
        monthName +
        ' telah tersedia. Silakan cek di portal orang tua.';

      notifications.push({
        userId: student.user.id,
        title,
        message,
        type: NotificationType.ACADEMIC,
        priority: 'NORMAL',
        channels: ['IN_APP'],
        recipientType: 'INDIVIDUAL',
      });
    }

    if (notifications.length > 0) {
      await createManyNotifications(notifications);
    }

    logger.info('Sent ' + notifications.length + ' monthly reports');
  }
}

// Export singleton
export const notificationScheduler = SchedulerService;
