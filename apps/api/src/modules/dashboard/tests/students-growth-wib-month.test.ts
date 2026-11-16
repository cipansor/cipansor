/**
 * `studentsGrowth` counts the students that already existed *before this month*
 * against the start of the WIB calendar month.
 *
 * The baseline used to be `new Date(now.getFullYear(), now.getMonth() - 1,
 * now.getDate())`. The `Date` constructor rolls a day past the target month's
 * length forward — `new Date(2026, 1, 31)` (31 Feb) is 3 March — so on the
 * 29th–31st the baseline landed in the *current* month and every student added
 * this month was counted as "already there last month". The same constructor
 * read the server clock's UTC fields, so on 00:00–06:59 WIB (the container runs
 * UTC) it was still the previous UTC day. Both made the trend card wrong on the
 * last days of a long month and on the first morning of the next (#1091).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    student: { count: vi.fn() },
    teacher: { count: vi.fn() },
    class: { count: vi.fn() },
    unit: { count: vi.fn() },
    attendance: { count: vi.fn() },
    academicYear: { findFirst: vi.fn() },
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

/**
 * The `where.createdAt.lt` the "already here before this month" count was given.
 * `getStats` calls `prisma.student.count` three times in order — total, active,
 * before-this-month — so the baseline is the third call.
 */
const baselineArg = () => prismaMock.student.count.mock.calls[2][0].where.createdAt.lt as Date;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });

  // total, active, before-this-month — no student added this month, so the
  // active total equals the baseline and the growth reads 0.
  prismaMock.student.count
    .mockResolvedValueOnce(100)
    .mockResolvedValueOnce(100)
    .mockResolvedValueOnce(100);
  prismaMock.teacher.count.mockResolvedValue(10);
  prismaMock.class.count.mockResolvedValue(5);
  prismaMock.unit.count.mockResolvedValue(4);
  prismaMock.attendance.count.mockResolvedValue(80);
  prismaMock.academicYear.findFirst.mockResolvedValue(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('studentsGrowth baseline is the start of the WIB calendar month', () => {
  it('does not roll a 31st into the current month (31 Mar 09:00 WIB)', async () => {
    vi.setSystemTime(new Date('2026-03-31T02:00:00.000Z'));

    await dashboardService.getStats({});

    // 1 March 2026 00:00 WIB = 28 Feb 17:00Z. The old constructor produced
    // 3 March — the same month — so the baseline was not a month back.
    expect(baselineArg().toISOString()).toBe('2026-02-28T17:00:00.000Z');
  });

  it('reads the WIB day on the first morning of the month (1 Nov 00:30 WIB)', async () => {
    vi.setSystemTime(new Date('2026-10-31T17:30:00.000Z'));

    await dashboardService.getStats({});

    // 1 Nov 2026 00:00 WIB = 31 Oct 17:00Z. The old constructor read the UTC
    // fields (still 31 Oct) and produced 1 Oct.
    expect(baselineArg().toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('crosses the year boundary on the WIB clock (1 Jan 00:30 WIB)', async () => {
    vi.setSystemTime(new Date('2025-12-31T17:30:00.000Z'));

    await dashboardService.getStats({});

    expect(baselineArg().toISOString()).toBe('2025-12-31T17:00:00.000Z');
  });

  it('reads 0% growth when nobody was added this month', async () => {
    vi.setSystemTime(new Date('2026-03-31T02:00:00.000Z'));

    const stats = await dashboardService.getStats({});

    expect(stats.studentsGrowth).toBe(0);
  });
});
