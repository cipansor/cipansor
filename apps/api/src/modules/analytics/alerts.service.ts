/**
 * Automated Alert System Service
 * Triggers alerts based on student/payment thresholds
 */

import { prisma } from '@/lib/prisma';
import { createNotification } from '@/modules/notifications/notifications.service';
import { NotificationType, AttendanceStatus } from '@prisma/client';
import { logger } from '@/lib/logger';
import { STUDENT_STATUS } from '@cipansor/shared';
import { wibOverdueCutoff } from '@/utils/wib-day';

export interface AlertRule {
  id: string;
  name: string;
  type: 'attendance' | 'payment' | 'academic' | 'behavior';
  threshold: number;
  operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq';
  action: 'notify' | 'email' | 'whatsapp' | 'all';
  recipients: 'parent' | 'teacher' | 'admin' | 'all';
  enabled: boolean;
}

export interface AlertTrigger {
  ruleId: string;
  studentId: string;
  studentName: string;
  value: number;
  threshold: number;
  message: string;
  triggeredAt: string;
  metadata?: Record<string, any>;
}

// Default alert rules
const DEFAULT_RULES: AlertRule[] = [
  {
    id: 'low-attendance',
    name: 'Kehadiran Rendah',
    type: 'attendance',
    threshold: 75,
    operator: 'lt',
    action: 'notify',
    recipients: 'parent',
    enabled: true,
  },
  {
    id: 'payment-overdue',
    name: 'Pembayaran Terlambat',
    type: 'payment',
    threshold: 7,
    operator: 'gt',
    action: 'all',
    recipients: 'parent',
    enabled: true,
  },
  {
    id: 'finance-anomaly',
    name: 'Anomali Keuangan',
    type: 'payment',
    threshold: 2, // 2 Standard Deviations
    operator: 'gt',
    action: 'notify',
    recipients: 'admin',
    enabled: true,
  },
  {
    id: 'low-grades',
    name: 'Nilai Rendah',
    type: 'academic',
    threshold: 60,
    operator: 'lt',
    action: 'notify',
    recipients: 'parent',
    enabled: true,
  },
  {
    id: 'multiple-violations',
    name: 'Pelanggaran Berulang',
    type: 'behavior',
    threshold: 3,
    operator: 'gte',
    action: 'notify',
    recipients: 'all',
    enabled: true,
  },
];

/**
 * Check all alert rules and trigger notifications
 */
export async function checkAndTriggerAlerts(): Promise<AlertTrigger[]> {
  const triggers: AlertTrigger[] = [];

  for (const rule of DEFAULT_RULES) {
    if (!rule.enabled) continue;

    const ruleTriggers = await checkRule(rule);
    triggers.push(...ruleTriggers);
  }

  return triggers;
}

/**
 * Check a specific rule
 */
async function checkRule(rule: AlertRule): Promise<AlertTrigger[]> {
  const triggers: AlertTrigger[] = [];

  switch (rule.type) {
    case 'attendance':
      triggers.push(...(await checkAttendanceRule(rule)));
      break;
    case 'payment':
      triggers.push(...(await checkPaymentRule(rule)));
      break;
    case 'academic':
      triggers.push(...(await checkAcademicRule(rule)));
      break;
    case 'behavior':
      triggers.push(...(await checkBehaviorRule(rule)));
      break;
  }

  return triggers;
}

/**
 * Check attendance rule
 */
export async function checkAttendanceRule(rule: AlertRule): Promise<AlertTrigger[]> {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const students = await prisma.student.findMany({
    where: { status: STUDENT_STATUS.ACTIVE },
    select: {
      id: true,
      user: { select: { id: true, name: true } },
      _count: {
        select: {
          attendances: { where: { date: { gte: thirtyDaysAgo } } },
        },
      },
    },
  });

  const triggers: AlertTrigger[] = [];
  const studentIds = students.map((s) => s.id);

  if (studentIds.length === 0) return triggers;

  // Optimization: Fix N+1 by grouping attendance by student and status
  // We already have the total count from the student query (student._count.attendances)
  // We just need the count of PRESENT attendances
  const attendanceStats = await prisma.attendance.groupBy({
    by: ['studentId', 'status'],
    where: {
      studentId: { in: studentIds },
      date: { gte: thirtyDaysAgo },
      status: AttendanceStatus.PRESENT,
    },
    _count: { _all: true },
  });

  // Map for O(1) lookup: studentId -> count of PRESENT
  const presentMap = new Map<string, number>();
  attendanceStats.forEach((stat) => {
    // Since we filtered by PRESENT in the query, this count is the present count
    const count = (stat._count as any)._all || (stat as any)._count || 0;
    presentMap.set(stat.studentId, count);
  });

  for (const student of students) {
    // student._count.attendances is the total number of attendance records in the last 30 days
    // (as defined in the select clause of the student query)
    const total = student._count.attendances || 0;

    // If no attendance records, skip (or handle as 0%? usually undefined denominator)
    if (total === 0) continue;

    const present = presentMap.get(student.id) || 0;
    const rate = (present / total) * 100;

    if (compareValue(rate, rule.threshold, rule.operator)) {
      const trigger: AlertTrigger = {
        ruleId: rule.id,
        studentId: student.id,
        studentName: student.user?.name || 'Unknown',
        value: rate,
        threshold: rule.threshold,
        message: `Kehadiran ${student.user?.name} hanya ${rate.toFixed(1)}% dalam 30 hari terakhir`,
        triggeredAt: new Date().toISOString(),
      };
      triggers.push(trigger);

      // Send notification
      if (student.user?.id) {
        await sendAlertNotification(rule, trigger, student.user.id);
      }
    }
  }

  return triggers;
}

/**
 * Check payment rule
 */
async function checkPaymentRule(rule: AlertRule): Promise<AlertTrigger[]> {
  if (rule.id === 'finance-anomaly') {
    return checkFinanceAnomalies(rule);
  }

  // Default to overdue check for other payment rules or specifically 'payment-overdue'
  return checkOverdueInvoices(rule);
}

/**
 * Check overdue invoices
 */
async function checkOverdueInvoices(rule: AlertRule): Promise<AlertTrigger[]> {
  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      status: 'OVERDUE',
      dueDate: { lt: wibOverdueCutoff() },
    },
    include: {
      student: {
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });

  const triggers: AlertTrigger[] = [];

  for (const invoice of overdueInvoices) {
    const daysOverdue = Math.floor(
      (Date.now() - invoice.dueDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (compareValue(daysOverdue, rule.threshold, rule.operator)) {
      const trigger: AlertTrigger = {
        ruleId: rule.id,
        studentId: invoice.studentId,
        studentName: invoice.student?.user?.name || 'Unknown',
        value: daysOverdue,
        threshold: rule.threshold,
        message: `Tagihan ${invoice.invoiceNumber} sudah ${daysOverdue} hari melewati jatuh tempo`,
        triggeredAt: new Date().toISOString(),
      };
      triggers.push(trigger);

      if (invoice.student?.user?.id) {
        await sendAlertNotification(rule, trigger, invoice.student.user.id);
      }
    }
  }

  return triggers;
}

/**
 * Check finance anomalies (Outliers & Duplicates)
 */
async function checkFinanceAnomalies(rule: AlertRule): Promise<AlertTrigger[]> {
  const triggers: AlertTrigger[] = [];
  // Optimization: Restrict anomaly check window to last 24 hours to reduce alert spam and improve performance
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  try {
    // 1. Check for Duplicate Invoices (Potential double billing)
    // Same student, same payment type, same amount, same period (if applicable), created recently
    const potentialDuplicates = await prisma.invoice.groupBy({
      by: ['studentId', 'paymentTypeId', 'amount', 'period'],
      where: {
        createdAt: { gte: oneDayAgo }, // Restrict to last 24h
        status: { not: 'CANCELLED' },
      },
      having: {
        studentId: { _count: { gt: 1 } },
      },
      _count: {
        _all: true,
      },
    });

    // Optimization: Fix N+1 problem by fetching all affected students in one query
    const studentIds = potentialDuplicates.map((d) => d.studentId);

    if (studentIds.length > 0) {
      const students = await prisma.student.findMany({
        where: { id: { in: studentIds } },
        include: { user: { select: { id: true, name: true } } },
      });

      // Create a map for O(1) lookup
      const studentsMap = new Map(students.map((s) => [s.id, s]));

      for (const dup of potentialDuplicates) {
        const student = studentsMap.get(dup.studentId);
        if (!student) continue;

        const count = dup._count._all;

        const trigger: AlertTrigger = {
          ruleId: rule.id,
          studentId: dup.studentId,
          studentName: student.user?.name || 'Unknown',
          value: count,
          threshold: 1,
          message: `Terdeteksi ${count} tagihan duplikat untuk ${student.user?.name || 'Unknown'} (Rp ${Number(dup.amount)})`,
          triggeredAt: new Date().toISOString(),
        };
        triggers.push(trigger);
      }
    }

    // 2. Check for Statistical Outliers (Unusually high amounts)
    // Best Practice: Calculate statistics over a longer period (1 year) to establish a reliable baseline
    // Use raw query for efficient STDDEV calculation as Prisma doesn't support it natively yet
    const stats = await prisma.$queryRaw<
      Array<{ payment_type_id: string; avg_val: number | string; stddev_val: number | string }>
    >`
            SELECT
                "payment_type_id",
                AVG(amount) as avg_val,
                STDDEV(amount) as stddev_val
            FROM invoices
            WHERE created_at > NOW() - INTERVAL '1 year'
            AND status != 'CANCELLED'
            GROUP BY "payment_type_id"
        `;

    // Check recent invoices against these stats
    const recentInvoices = await prisma.invoice.findMany({
      where: {
        createdAt: { gte: oneDayAgo }, // Restrict to last 24h
        status: { not: 'CANCELLED' },
      },
      include: {
        student: { include: { user: { select: { name: true } } } },
      },
    });

    for (const invoice of recentInvoices) {
      const stat = stats.find((s) => s.payment_type_id === invoice.paymentTypeId);
      if (!stat) continue;

      const amount = Number(invoice.amount);
      const avg = Number(stat.avg_val);
      const stddev = Number(stat.stddev_val);

      // Z-Score check: (Value - Mean) / StdDev > Threshold
      // Default threshold is 2 (2 sigma)
      if (stddev > 0) {
        const zScore = (amount - avg) / stddev;

        if (zScore > rule.threshold) {
          const trigger: AlertTrigger = {
            ruleId: rule.id,
            studentId: invoice.studentId,
            studentName: invoice.student?.user?.name || 'Unknown',
            value: amount,
            threshold: avg + rule.threshold * stddev,
            message: `Tagihan tidak wajar (Z-Score: ${zScore.toFixed(2)}) untuk ${invoice.student?.user?.name}. Jumlah: Rp ${amount}, Rata-rata: Rp ${avg.toFixed(0)}`,
            triggeredAt: new Date().toISOString(),
            metadata: {
              type: 'outlier',
              invoiceId: invoice.id,
              zScore: zScore,
            },
          };
          triggers.push(trigger);
        }
      } else if (Math.abs(amount - avg) > 100) {
        // Special case: If stddev is 0 (all historical values are identical),
        // any deviation > 100 (epsilon) is an anomaly (infinite Z-Score)
        const trigger: AlertTrigger = {
          ruleId: rule.id,
          studentId: invoice.studentId,
          studentName: invoice.student?.user?.name || 'Unknown',
          value: amount,
          threshold: avg,
          message: `Tagihan tidak wajar (Z-Score: ∞) untuk ${invoice.student?.user?.name}. Jumlah: Rp ${amount}, Rata-rata: Rp ${avg.toFixed(0)}`,
          triggeredAt: new Date().toISOString(),
          metadata: {
            type: 'outlier',
            invoiceId: invoice.id,
            zScore: 'infinity',
          },
        };
        triggers.push(trigger);
      }
    }
  } catch (error) {
    logger.error('Error checking finance anomalies:', error);
  }

  return triggers;
}

/**
 * Check academic rule
 */
async function checkAcademicRule(rule: AlertRule): Promise<AlertTrigger[]> {
  const recentGrades = await prisma.grade.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    include: {
      student: {
        include: { user: { select: { id: true, name: true } } },
      },
      subject: { select: { name: true } },
    },
  });

  const triggers: AlertTrigger[] = [];

  for (const grade of recentGrades) {
    const score = Number(grade.score);
    if (compareValue(score, rule.threshold, rule.operator)) {
      const trigger: AlertTrigger = {
        ruleId: rule.id,
        studentId: grade.studentId,
        studentName: grade.student?.user?.name || 'Unknown',
        value: score,
        threshold: rule.threshold,
        message: `Nilai ${grade.subject?.name} ${grade.student?.user?.name}: ${score}`,
        triggeredAt: new Date().toISOString(),
      };
      triggers.push(trigger);

      if (grade.student?.user?.id) {
        await sendAlertNotification(rule, trigger, grade.student.user.id);
      }
    }
  }

  return triggers;
}

/**
 * Check behavior rule
 */
async function checkBehaviorRule(rule: AlertRule): Promise<AlertTrigger[]> {
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const violationCounts = await prisma.violation.groupBy({
    by: ['studentId'],
    where: { occurredAt: { gte: sixtyDaysAgo } },
    _count: { _all: true },
  });

  const triggers: AlertTrigger[] = [];

  // Optimization: Fix N+1 problem by fetching all affected students in one query
  const studentIds = violationCounts.map((vc) => vc.studentId);

  // Using inferred type from Prisma result to ensure type safety
  const students =
    studentIds.length > 0
      ? await prisma.student.findMany({
          where: { id: { in: studentIds } },
          include: { user: { select: { id: true, name: true } } },
        })
      : [];

  const studentsMap = new Map(students.map((s) => [s.id, s]));

  for (const vc of violationCounts) {
    const count = (vc._count as any)?._all || (vc as any)._count || 0;
    if (compareValue(count, rule.threshold, rule.operator)) {
      const student = studentsMap.get(vc.studentId);

      const trigger: AlertTrigger = {
        ruleId: rule.id,
        studentId: vc.studentId,
        studentName: student?.user?.name || 'Unknown',
        value: count,
        threshold: rule.threshold,
        message: `${student?.user?.name} memiliki ${count} pelanggaran dalam 60 hari`,
        triggeredAt: new Date().toISOString(),
      };
      triggers.push(trigger);

      if (student?.user?.id) {
        await sendAlertNotification(rule, trigger, student.user.id);
      }
    }
  }

  return triggers;
}

/**
 * Compare value with threshold
 */
function compareValue(value: number, threshold: number, operator: AlertRule['operator']): boolean {
  switch (operator) {
    case 'lt':
      return value < threshold;
    case 'lte':
      return value <= threshold;
    case 'gt':
      return value > threshold;
    case 'gte':
      return value >= threshold;
    case 'eq':
      return value === threshold;
    default:
      return false;
  }
}

/**
 * Send alert notification
 */
async function sendAlertNotification(
  rule: AlertRule,
  trigger: AlertTrigger,
  userId: string
): Promise<void> {
  try {
    // Prevent duplicate alerts within 24 hours
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Check if similar alert exists
    // We use Prisma's JSON filtering capabilities if possible, or filter in code
    // Since Prisma JSON filtering can be database specific, we'll fetch recent user notifications
    // of type ALERT and filter in memory to be safe and database-agnostic enough for this context.
    const recentAlerts = await prisma.notification.findMany({
      where: {
        userId,
        type: NotificationType.ALERT,
        createdAt: { gte: twentyFourHoursAgo },
      },
      select: { data: true },
    });

    const isDuplicate = recentAlerts.some((alert) => {
      const data = alert.data as any;
      if (!data) return false;

      // Match ruleId and studentId
      if (data.ruleId !== rule.id || data.studentId !== trigger.studentId) return false;

      // If metadata (like invoiceId) is present in trigger, check against existing
      if (trigger.metadata && data.metadata) {
        // Check if all keys in trigger.metadata match
        return Object.keys(trigger.metadata).every(
          (key) => data.metadata[key] === trigger.metadata![key]
        );
      }

      return true;
    });

    if (isDuplicate) {
      logger.info(`Skipping duplicate alert: ${rule.name} for ${trigger.studentName}`);
      return;
    }

    await createNotification({
      userId,
      title: `⚠️ ${rule.name}`,
      message: trigger.message,
      type: NotificationType.ALERT,
      priority: 'HIGH',
      channels: ['IN_APP'],
      recipientType: 'INDIVIDUAL',
      data: {
        ruleId: rule.id,
        studentId: trigger.studentId,
        metadata: trigger.metadata,
      },
    });
    logger.info(`Alert sent: ${rule.name} for ${trigger.studentName}`);
  } catch (error) {
    logger.error('Failed to send alert notification:', error);
  }
}

/**
 * Get alert rules
 */
export function getAlertRules(): AlertRule[] {
  return DEFAULT_RULES;
}

/**
 * Get recent alerts
 */
export async function getRecentAlerts(limit: number = 50): Promise<AlertTrigger[]> {
  // In production, this would query from a stored alerts table
  return [];
}
