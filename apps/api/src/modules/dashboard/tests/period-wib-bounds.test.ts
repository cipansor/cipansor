/**
 * The `month`/`year` bounds behind the Tahfidz and Pelanggaran & Penghargaan
 * cards are the WIB calendar month/year, not midnight UTC.
 *
 * `getTahfidzStats` and `getViolationRewardStats` built them with
 * `new Date(now.getFullYear(), now.getMonth(), 1)`. The container runs UTC, so
 * that constructor produced midnight UTC — 07:00 WIB on the 1st — and, on the
 * first morning of the month (still the previous UTC month, and in January the
 * previous UTC year), it read the *previous* month/year. So a `TahfidzRecord`
 * or `Violation` made 00:00–06:59 WIB on the 1st fell out of "bulan ini", and
 * on the morning of the 1st the window held the whole month before. Same defect
 * class as `studentsGrowth` (#1091/#1120); `week` stays a rolling 7×24h window
 * (decided: not a calendar week) and is out of scope.
 *
 * `TahfidzRecord.recordedAt`, `Violation.createdAt` and `Reward.createdAt` are
 * real `DateTime` columns, so their lower bound must be a WIB instant
 * (17:00Z the day before).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    tahfidzRecord: { aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    student: { findMany: vi.fn() },
    violation: { count: vi.fn(), findMany: vi.fn() },
    reward: { count: vi.fn(), findMany: vi.fn() },
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

/** The `recordedAt.gte` the monthly tahfidz progress read was given. */
const tahfidzSince = () =>
  prismaMock.tahfidzRecord.findMany.mock.calls.at(-1)![0].where.recordedAt.gte as Date;

/** The `createdAt.gte` the violation count was given. */
const violationSince = () =>
  prismaMock.violation.count.mock.calls[0][0].where.createdAt.gte as Date;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });

  prismaMock.tahfidzRecord.aggregate.mockResolvedValue({ _sum: { totalAyah: 0 } });
  prismaMock.tahfidzRecord.groupBy.mockResolvedValue([]);
  prismaMock.tahfidzRecord.findMany.mockResolvedValue([]);
  prismaMock.student.findMany.mockResolvedValue([]);
  prismaMock.violation.count.mockResolvedValue(0);
  prismaMock.reward.count.mockResolvedValue(0);
  prismaMock.violation.findMany.mockResolvedValue([]);
  prismaMock.reward.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Tahfidz card bounds its period on the WIB calendar', () => {
  it('uses the WIB month start on the first morning of the month (1 Nov 03:00 WIB)', async () => {
    // 1 Nov 2026 03:00 WIB = 31 Oct 2026 20:00Z; the UTC clock is still October.
    vi.setSystemTime(new Date('2026-10-31T20:00:00.000Z'));

    await dashboardService.getTahfidzStats({}, { period: 'month' });

    // 1 Nov 2026 00:00 WIB = 31 Oct 17:00Z. The old constructor read the UTC
    // fields (still October) and produced 1 Oct.
    expect(tahfidzSince().toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('keeps an early-morning setoran on the 1st inside "bulan ini"', async () => {
    // Mid-month read: 15 Nov 2026 10:00 WIB = 15 Nov 03:00Z.
    vi.setSystemTime(new Date('2026-11-15T03:00:00.000Z'));

    await dashboardService.getTahfidzStats({}, { period: 'month' });

    const since = tahfidzSince();
    // A record made 1 Nov 2026 03:00 WIB (31 Oct 20:00Z) is >= the WIB month
    // start. The old bound (1 Nov 00:00Z = 07:00 WIB) excluded it.
    const earlyRecord = new Date('2026-10-31T20:00:00.000Z');
    expect(since.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(earlyRecord.getTime()).toBeGreaterThanOrEqual(since.getTime());
  });

  it('uses the WIB year start across the year boundary (1 Jan 00:30 WIB)', async () => {
    // 1 Jan 2027 00:30 WIB = 31 Dec 2026 17:30Z; the UTC clock is still 2026.
    vi.setSystemTime(new Date('2026-12-31T17:30:00.000Z'));

    await dashboardService.getTahfidzStats({}, { period: 'year' });

    // 1 Jan 2027 00:00 WIB = 31 Dec 17:00Z. The old constructor read the UTC
    // year (2026) and jumped to 1 Jan 2026.
    expect(tahfidzSince().toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });

  it('leaves "week" a rolling 7×24h window', async () => {
    const now = new Date('2026-11-15T03:00:00.000Z');
    vi.setSystemTime(now);

    await dashboardService.getTahfidzStats({}, { period: 'week' });

    expect(tahfidzSince().getTime()).toBe(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  });
});

describe('the Pelanggaran & Penghargaan card bounds its period on the WIB calendar', () => {
  it('uses the WIB month start on the first morning of the month (1 Nov 03:00 WIB)', async () => {
    vi.setSystemTime(new Date('2026-10-31T20:00:00.000Z'));

    await dashboardService.getViolationRewardStats({}, { period: 'month' });

    expect(violationSince().toISOString()).toBe('2026-10-31T17:00:00.000Z');
  });

  it('uses the WIB year start across the year boundary (1 Jan 00:30 WIB)', async () => {
    vi.setSystemTime(new Date('2026-12-31T17:30:00.000Z'));

    await dashboardService.getViolationRewardStats({}, { period: 'year' });

    expect(violationSince().toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });

  it('gives the reward count the same WIB month start', async () => {
    vi.setSystemTime(new Date('2026-11-15T03:00:00.000Z'));

    await dashboardService.getViolationRewardStats({}, { period: 'month' });

    expect(prismaMock.reward.count.mock.calls[0][0].where.createdAt.gte.toISOString()).toBe(
      '2026-10-31T17:00:00.000Z'
    );
  });

  it('leaves "week" a rolling 7×24h window', async () => {
    const now = new Date('2026-11-15T03:00:00.000Z');
    vi.setSystemTime(now);

    await dashboardService.getViolationRewardStats({}, { period: 'week' });

    expect(violationSince().getTime()).toBe(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  });
});

describe('the monthly tahfidz progress groups by the WIB month', () => {
  it('keeps an early-morning 1st setoran in its own WIB month, not the previous one', async () => {
    // Read on 15 Nov 2026 10:00 WIB. One setoran at 1 Nov 03:00 WIB is stored as
    // 2026-10-31T20:00Z (UTC month October); another on 20 Nov 09:00 WIB.
    vi.setSystemTime(new Date('2026-11-15T03:00:00.000Z'));
    prismaMock.tahfidzRecord.findMany.mockResolvedValue([
      { recordedAt: new Date('2026-10-31T20:00:00.000Z'), totalAyah: 10, studentId: 's1' },
      { recordedAt: new Date('2026-11-20T02:00:00.000Z'), totalAyah: 5, studentId: 's1' },
      { recordedAt: new Date('2026-11-20T03:00:00.000Z'), totalAyah: 7, studentId: 's2' },
    ]);

    const stats = await dashboardService.getTahfidzStats({}, { period: 'month' });

    // One WIB bucket for November, not a stray "2026-10" plus "2026-11".
    expect(stats.monthlyProgress).toEqual([
      { month: '2026-11', totalAyat: 22, ayahCount: 22, studentCount: 2 },
    ]);
  });
});
