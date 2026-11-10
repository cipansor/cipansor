import { prisma } from '@/lib/prisma';
import { UserRole } from '@prisma/client';
import { shiftWibDay, todayWib, wibWeekday } from '@/utils/wib';
import { wibDayOf, wibDayStart } from '@/utils/wib-day';
import type {
  ParentEngagementStats,
  ParentEngagementClassBreakdown,
  ParentEngagementDailyActivity,
  ParentEngagementLowItem,
} from '@cipansor/shared';

const ACTIVE_WINDOW_DAYS = 30;
const INVOICE_WINDOW_DAYS = 90;
const LOW_ENGAGEMENT_LIMIT = 10;
const DAY_NAMES_ID = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

/**
 * Parent engagement analytics: portal activity, responsiveness, payment
 * discipline and per-class breakdown — all derived from real data
 * (User.lastLoginAt, Message replies, Notification reads, Invoices).
 */
export async function getParentEngagement(unitId?: string): Promise<ParentEngagementStats> {
  const activeCutoff = daysAgo(ACTIVE_WINDOW_DAYS);
  // The activity chart counts calendar days on the pesantren's clock. The
  // container runs UTC, so a local `setHours(0,0,0,0)` would put the window's
  // first day on the previous WIB day for the whole 00:00–06:59 WIB stretch.
  const today = todayWib();
  const weekStart = wibDayStart(shiftWibDay(today, -6));

  const studentFilter = {
    deletedAt: null,
    ...(unitId ? { unitId } : {}),
  };

  const links = await prisma.studentParent.findMany({
    where: { student: studentFilter },
    include: {
      parent: { select: { id: true, name: true, lastLoginAt: true, role: true } },
      student: {
        select: {
          user: { select: { name: true } },
          enrollments: {
            where: { status: 'active' },
            select: { class: { select: { id: true, name: true } } },
            take: 1,
          },
        },
      },
    },
  });

  // Deduplicate parents (a parent can be linked to several children)
  const parents = new Map<string, { name: string; lastLoginAt: Date | null; childName: string }>();
  const classes = new Map<
    string,
    { className: string; parentIds: Set<string>; activeParentIds: Set<string> }
  >();

  for (const link of links) {
    if (link.parent.role !== UserRole.PARENT) continue;
    const isActive = !!link.parent.lastLoginAt && link.parent.lastLoginAt >= activeCutoff;

    if (!parents.has(link.parent.id)) {
      parents.set(link.parent.id, {
        name: link.parent.name,
        lastLoginAt: link.parent.lastLoginAt,
        childName: link.student.user.name,
      });
    }

    const enrolledClass = link.student.enrollments[0]?.class;
    if (enrolledClass) {
      let entry = classes.get(enrolledClass.id);
      if (!entry) {
        entry = { className: enrolledClass.name, parentIds: new Set(), activeParentIds: new Set() };
        classes.set(enrolledClass.id, entry);
      }
      entry.parentIds.add(link.parent.id);
      if (isActive) entry.activeParentIds.add(link.parent.id);
    }
  }

  const parentIds = [...parents.keys()];
  const totalParents = parentIds.length;
  const activeParents = [...parents.values()].filter(
    (p) => p.lastLoginAt && p.lastLoginAt >= activeCutoff
  ).length;

  const [parentReplies, parentMessages, readNotifications, invoiceGroups, overdueCount] =
    await Promise.all([
      // Replies by parents to teacher messages (for response time)
      prisma.message.findMany({
        where: {
          senderId: { in: parentIds },
          parentId: { not: null },
          createdAt: { gte: daysAgo(ACTIVE_WINDOW_DAYS) },
          deletedAt: null,
        },
        select: { createdAt: true, parent: { select: { createdAt: true } } },
        take: 500,
      }),
      // Messages sent by parents this week (activity chart)
      prisma.message.findMany({
        where: {
          senderId: { in: parentIds },
          createdAt: { gte: weekStart },
          deletedAt: null,
        },
        select: { createdAt: true },
      }),
      // Notifications read by parents this week (activity chart)
      prisma.notification.findMany({
        where: {
          userId: { in: parentIds },
          readAt: { gte: weekStart },
        },
        select: { readAt: true },
      }),
      prisma.invoice.groupBy({
        by: ['status'],
        where: {
          student: studentFilter,
          dueDate: { gte: daysAgo(INVOICE_WINDOW_DAYS) },
        },
        _count: { id: true },
      }),
      prisma.invoice.count({
        where: {
          student: studentFilter,
          dueDate: { gte: daysAgo(INVOICE_WINDOW_DAYS), lt: new Date() },
          status: { not: 'PAID' },
        },
      }),
    ]);

  // Average reply latency in hours
  let avgResponseHours: number | null = null;
  if (parentReplies.length > 0) {
    const totalHours = parentReplies.reduce((sum, reply) => {
      const original = reply.parent?.createdAt;
      if (!original) return sum;
      return sum + (reply.createdAt.getTime() - original.getTime()) / 36e5;
    }, 0);
    avgResponseHours = Math.round((totalHours / parentReplies.length) * 10) / 10;
  }

  // Daily activity for the last 7 days, on the WIB calendar. The bucket and
  // its label come from the same WIB day an event falls on (`wibDayOf`), so a
  // 00:00–06:59 WIB event is not filed under the previous UTC day.
  const weeklyActivity: ParentEngagementDailyActivity[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = shiftWibDay(today, -i);
    weeklyActivity.push({
      date: day,
      day: DAY_NAMES_ID[wibWeekday(day)],
      messages: parentMessages.filter((m) => wibDayOf(m.createdAt) === day).length,
      notificationsRead: readNotifications.filter((n) => n.readAt && wibDayOf(n.readAt) === day)
        .length,
    });
  }

  const classBreakdown: ParentEngagementClassBreakdown[] = [...classes.entries()]
    .map(([classId, entry]) => ({
      classId,
      className: entry.className,
      parents: entry.parentIds.size,
      activeParents: entry.activeParentIds.size,
      engagement:
        entry.parentIds.size > 0
          ? Math.round((entry.activeParentIds.size / entry.parentIds.size) * 100)
          : 0,
    }))
    .sort((a, b) => a.className.localeCompare(b.className));

  const now = Date.now();
  const lowEngagement: ParentEngagementLowItem[] = [...parents.entries()]
    .filter(([, p]) => !p.lastLoginAt || p.lastLoginAt < activeCutoff)
    .map(([parentId, p]) => ({
      parentId,
      parentName: p.name,
      childName: p.childName,
      lastLoginAt: p.lastLoginAt ? p.lastLoginAt.toISOString() : null,
      daysSinceLogin: p.lastLoginAt ? Math.floor((now - p.lastLoginAt.getTime()) / 864e5) : null,
    }))
    // Never logged in first, then longest-inactive
    .sort((a, b) => {
      if (a.daysSinceLogin === null) return b.daysSinceLogin === null ? 0 : -1;
      if (b.daysSinceLogin === null) return 1;
      return b.daysSinceLogin - a.daysSinceLogin;
    })
    .slice(0, LOW_ENGAGEMENT_LIMIT);

  const invoiceCountFor = (status: string) =>
    invoiceGroups.find((g) => g.status === status)?._count.id ?? 0;
  const totalInvoices = invoiceGroups.reduce((sum, g) => sum + g._count.id, 0);
  const paid = invoiceCountFor('PAID');

  return {
    summary: {
      totalParents,
      activeParents,
      engagementRate: totalParents > 0 ? Math.round((activeParents / totalParents) * 1000) / 10 : 0,
      avgResponseHours,
    },
    weeklyActivity,
    classBreakdown,
    invoiceStatus: {
      paid,
      pending: Math.max(totalInvoices - paid - overdueCount, 0),
      overdue: overdueCount,
    },
    lowEngagement,
  };
}
