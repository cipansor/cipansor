/**
 * Every "hari ini" bound on the dashboard is a WIB calendar day.
 *
 * The container runs UTC. A bound built with `new Date().setHours(0,0,0,0)`
 * is therefore midnight UTC — the day *before* WIB between 00:00 and 06:59
 * WIB. `Attendance.date` is a `@db.Date` holding the WIB day
 * (`dayOf(todayWib(...))`, attendance.service.ts), so the dashboard read the
 * previous day's attendance all morning; `TahfidzRecord.recordedAt` is a real
 * `DateTime`, so its bound must be WIB midnight (17:00Z the day before) or the
 * early-morning setoran falls out of "hari ini".
 *
 * The clock is frozen at 2026-10-31T17:30:00Z = 1 Nov 2026 00:30 WIB, inside
 * the window where the two calendars disagree.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    student: { count: vi.fn() },
    teacher: { count: vi.fn() },
    class: { count: vi.fn(), findMany: vi.fn() },
    unit: { count: vi.fn() },
    attendance: { count: vi.fn() },
    academicYear: { findFirst: vi.fn() },
    invoice: { count: vi.fn() },
    murojaahRecord: { aggregate: vi.fn() },
    tahfidzRecord: { findMany: vi.fn(), count: vi.fn() },
    tahfidzTarget: { findMany: vi.fn() },
    dashboardHistory: { findMany: vi.fn() },
    schedule: { findMany: vi.fn() },
    teacherSubject: { findMany: vi.fn() },
    classEnrollment: { findMany: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/lib/dashboard-metrics', () => ({
  getCurrentDashboardMetrics: vi.fn(async () => ({})),
}));

import { dashboardService } from '../dashboard.service';
import { dayOf, todayWib } from '@/utils/wib';
import { wibDayStart } from '@/utils/wib-day';

/** 1 Nov 2026 00:30 WIB, the window where the UTC and WIB days differ. */
const NOW = new Date('2026-10-31T17:30:00.000Z');
const WIB_DAY = '2026-11-01';

/** The `where.date` a `prisma.attendance.count` call was given. */
const attendanceDateArg = () => prismaMock.attendance.count.mock.calls[0][0].where.date;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);

  prismaMock.student.count.mockResolvedValue(100);
  prismaMock.teacher.count.mockResolvedValue(10);
  prismaMock.class.count.mockResolvedValue(5);
  prismaMock.unit.count.mockResolvedValue(4);
  prismaMock.attendance.count.mockResolvedValue(80);
  prismaMock.academicYear.findFirst.mockResolvedValue(null);
  prismaMock.invoice.count.mockResolvedValue(0);
  prismaMock.murojaahRecord.aggregate.mockResolvedValue({ _avg: { qualityScore: 90 } });
  prismaMock.tahfidzRecord.findMany.mockResolvedValue([]);
  prismaMock.tahfidzRecord.count.mockResolvedValue(0);
  prismaMock.tahfidzTarget.findMany.mockResolvedValue([]);
  prismaMock.dashboardHistory.findMany.mockResolvedValue([]);
  prismaMock.class.findMany.mockResolvedValue([]);
  prismaMock.schedule.findMany.mockResolvedValue([]);
  prismaMock.teacherSubject.findMany.mockResolvedValue([]);
  prismaMock.classEnrollment.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the WIB day the dashboard speaks about', () => {
  it('reads todayWib() as the WIB day, not the UTC day', () => {
    expect(todayWib()).toBe(WIB_DAY);
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-10-31');
  });

  it('bounds the attendance card with the WIB calendar day (getQuickStats)', async () => {
    await dashboardService.getQuickStats({});

    expect(attendanceDateArg()).toEqual(dayOf(WIB_DAY));
  });

  it('bounds the attendance card with the WIB calendar day (getStats)', async () => {
    await dashboardService.getStats({});

    expect(attendanceDateArg()).toEqual(dayOf(WIB_DAY));
  });

  it('bounds the attendance alert with the WIB calendar day (getMetrics)', async () => {
    await dashboardService.getMetrics({});

    expect(attendanceDateArg()).toEqual(dayOf(WIB_DAY));
  });

  it('keeps an early-morning setoran in "hari ini" (getTeacherStats)', async () => {
    await dashboardService.getTeacherStats('teacher-1', 'user-1');

    const todayCall = prismaMock.tahfidzRecord.count.mock.calls[0][0];
    // WIB midnight, so a 00:30 WIB setoran is not excluded as "future".
    expect(todayCall.where.recordedAt.gte).toEqual(wibDayStart(WIB_DAY));
    expect(todayCall.where.recordedAt.gte.getTime()).toBeLessThanOrEqual(NOW.getTime());
  });
});
