import { describe, it, expect, vi, beforeEach } from 'vitest';

const { redisMock, prismaMock } = vi.hoisted(() => ({
  redisMock: {
    status: 'ready' as string,
    get: vi.fn(),
    setex: vi.fn(),
    del: vi.fn(),
  },
  prismaMock: {
    student: { count: vi.fn() },
    teacher: { count: vi.fn() },
    attendance: { count: vi.fn() },
    hafidzStudent: { count: vi.fn() },
    murojaahRecord: { aggregate: vi.fn() },
  },
}));

vi.mock('@/lib/redis', () => ({ redis: redisMock }));
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getCurrentDashboardMetrics, invalidateDashboardCache } from './dashboard-metrics';
import { dayOf } from '@/utils/wib';

const CACHED = {
  students: { total: 1, active: 1, change: 0 },
  teachers: { total: 1 },
  attendance: { rate: 100, present: 1, total: 1 },
  tahfidz: { totalHafidz: 0, avgQuality: 0 },
  timestamp: '2026-09-28T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  redisMock.status = 'ready';
  redisMock.get.mockResolvedValue(null);
  redisMock.setex.mockResolvedValue('OK');
  redisMock.del.mockResolvedValue(1);
  prismaMock.student.count.mockReset().mockResolvedValueOnce(120).mockResolvedValueOnce(100);
  prismaMock.teacher.count.mockResolvedValue(12);
  prismaMock.attendance.count.mockResolvedValue(80);
  prismaMock.hafidzStudent.count.mockResolvedValue(3);
  prismaMock.murojaahRecord.aggregate.mockResolvedValue({ _avg: { qualityScore: 82.5 } });
});

describe('getCurrentDashboardMetrics', () => {
  it('answers from the cache when a copy exists', async () => {
    redisMock.get.mockResolvedValue(JSON.stringify(CACHED));

    const metrics = await getCurrentDashboardMetrics('unit-1');

    expect(metrics).toEqual(CACHED);
    expect(redisMock.get).toHaveBeenCalledWith('metrics:unit:unit-1');
    expect(prismaMock.student.count).not.toHaveBeenCalled();
  });

  it('counts the WIB day, not the UTC day, between 00:00 and 06:59 WIB', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    // 1 Nov 2026 00:30 WIB = 31 Oct 2026 17:30 UTC, where the days disagree.
    vi.setSystemTime(new Date('2026-10-31T17:30:00.000Z'));
    try {
      await getCurrentDashboardMetrics('unit-1');

      expect(prismaMock.attendance.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ date: dayOf('2026-11-01') }) })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('computes on a miss, scoped to the unit, and caches for 60 seconds', async () => {
    const metrics = await getCurrentDashboardMetrics('unit-1');

    expect(metrics).toMatchObject({
      students: { total: 120, active: 100, change: 0 },
      teachers: { total: 12 },
      attendance: { rate: 80, present: 80, total: 100 },
      tahfidz: { totalHafidz: 3, avgQuality: 82.5 },
    });
    expect(prismaMock.student.count).toHaveBeenCalledWith({ where: { unitId: 'unit-1' } });
    expect(prismaMock.attendance.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ status: 'PRESENT', student: { unitId: 'unit-1' } }),
    });
    expect(redisMock.setex).toHaveBeenCalledWith(
      'metrics:unit:unit-1',
      60,
      JSON.stringify(metrics)
    );
  });

  it('uses the yayasan-wide key and no unit filter when no unit is given', async () => {
    await getCurrentDashboardMetrics();

    expect(redisMock.get).toHaveBeenCalledWith('metrics:global');
    expect(prismaMock.student.count).toHaveBeenCalledWith({ where: {} });
    expect(prismaMock.attendance.count).toHaveBeenCalledWith({
      where: expect.not.objectContaining({ student: expect.anything() }),
    });
  });

  it('with fresh: true, skips the cached copy but still refreshes it', async () => {
    redisMock.get.mockResolvedValue(JSON.stringify(CACHED));

    const metrics = await getCurrentDashboardMetrics('unit-1', { fresh: true });

    expect(redisMock.get).not.toHaveBeenCalled();
    expect(metrics.students.total).toBe(120);
    expect(redisMock.setex).toHaveBeenCalledWith('metrics:unit:unit-1', 60, expect.any(String));
  });

  it('goes straight to the database while Redis is not connected', async () => {
    redisMock.status = 'reconnecting';

    const metrics = await getCurrentDashboardMetrics('unit-1');

    expect(metrics.students.total).toBe(120);
    expect(redisMock.get).not.toHaveBeenCalled();
    expect(redisMock.setex).not.toHaveBeenCalled();
  });

  it('falls back to the database when the cache read fails', async () => {
    redisMock.get.mockRejectedValue(new Error('connection lost'));

    const metrics = await getCurrentDashboardMetrics('unit-1');

    expect(metrics.students.total).toBe(120);
  });
});

describe('invalidateDashboardCache', () => {
  it("drops the unit's entry", async () => {
    await invalidateDashboardCache('unit-1');
    expect(redisMock.del).toHaveBeenCalledWith('metrics:unit:unit-1');
  });

  it('drops the yayasan-wide entry when no unit is given', async () => {
    await invalidateDashboardCache();
    expect(redisMock.del).toHaveBeenCalledWith('metrics:global');
  });

  it('does nothing while Redis is not connected', async () => {
    redisMock.status = 'connecting';
    await invalidateDashboardCache('unit-1');
    expect(redisMock.del).not.toHaveBeenCalled();
  });
});
