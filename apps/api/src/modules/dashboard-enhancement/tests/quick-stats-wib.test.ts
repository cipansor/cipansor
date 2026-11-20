/**
 * `getQuickStats()` bounds "hari ini" by the WIB calendar day (#1152).
 *
 * It used `today.setHours(0, 0, 0, 0)`, i.e. midnight UTC on the UTC container,
 * which is 07:00 WIB. `Attendance.date` and `MurojaahRecord.murojaahDate` are
 * `@db.Date` columns filled with the WIB day (`dayOf(todayWib())`), so a `gte`
 * against that instant counted yesterday and every later day as "today", and
 * lost the 00:00–07:00 WIB rows of today.
 *
 * The clock is frozen at 2026-10-26T23:00:00Z = 27 Oct 2026 06:00 WIB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    student: { count: vi.fn() },
    teacher: { count: vi.fn() },
    class: { count: vi.fn() },
    attendance: { count: vi.fn() },
    murojaahRecord: { count: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));

import { dashboardService } from '../dashboard.service';

/** 27 Oct 2026 06:00 WIB — the server clock still reads 26 Oct. */
const NOW = new Date('2026-10-26T23:00:00.000Z');

/** The `where` the attendance count was given. */
const attendanceWhere = () =>
  vi.mocked(prismaMock.attendance.count).mock.calls[0][0]!.where as { date: unknown };

/** The `where` the murojaah count was given. */
const murojaahWhere = () =>
  vi.mocked(prismaMock.murojaahRecord.count).mock.calls[0][0]!.where as {
    murojaahDate: unknown;
  };

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);

  prismaMock.student.count.mockResolvedValue(0);
  prismaMock.teacher.count.mockResolvedValue(0);
  prismaMock.class.count.mockResolvedValue(0);
  prismaMock.attendance.count.mockResolvedValue(0);
  prismaMock.murojaahRecord.count.mockResolvedValue(0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('dashboardService.getQuickStats — "hari ini" is the WIB day', () => {
  it('bounds attendance by the stored day of 27 Oct, not 26 Oct midnight UTC', async () => {
    await dashboardService.getQuickStats();

    expect(attendanceWhere().date).toEqual(new Date('2026-10-27T00:00:00.000Z'));
  });

  it('bounds murojaah by the same stored day', async () => {
    await dashboardService.getQuickStats();

    expect(murojaahWhere().murojaahDate).toEqual(new Date('2026-10-27T00:00:00.000Z'));
  });

  it('counts only that day: yesterday and tomorrow are excluded', async () => {
    await dashboardService.getQuickStats();

    const bound = attendanceWhere().date as Date;
    const storedDay = (day: string) => new Date(`${day}T00:00:00.000Z`);

    expect(storedDay('2026-10-26')).not.toEqual(bound); // yesterday
    expect(storedDay('2026-10-27')).toEqual(bound); // today
    expect(storedDay('2026-10-28')).not.toEqual(bound); // tomorrow
  });
});
