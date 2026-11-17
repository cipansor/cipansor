import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    registrant: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    admissionPeriod: { count: vi.fn() },
    exam: { count: vi.fn() },
    examAttempt: { count: vi.fn(), aggregate: vi.fn() },
  },
}));
vi.mock('@/lib/dashboard-metrics', () => ({
  getCurrentDashboardMetrics: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { dashboardService } from './dashboard.service';

const mocked = prisma as unknown as {
  registrant: {
    count: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  admissionPeriod: { count: ReturnType<typeof vi.fn> };
  exam: { count: ReturnType<typeof vi.fn> };
  examAttempt: {
    count: ReturnType<typeof vi.fn>;
    aggregate: ReturnType<typeof vi.fn>;
  };
};

describe('dashboardService.getAdmissionsStats', () => {
  beforeEach(() => vi.clearAllMocks());

  it('aggregates registrants scoped to the unit via the admission period', async () => {
    mocked.registrant.count.mockResolvedValue(42);
    mocked.registrant.groupBy.mockResolvedValue([
      { status: 'REGISTERED', _count: 30 },
      { status: 'ACCEPTED', _count: 12 },
    ]);
    mocked.admissionPeriod.count.mockResolvedValue(1);
    mocked.registrant.findMany.mockResolvedValue([
      {
        id: 'r1',
        fullName: 'Calon Santri',
        status: 'REGISTERED',
        createdAt: new Date('2026-07-01T08:00:00Z'),
      },
    ]);

    const stats = await dashboardService.getAdmissionsStats({ unitId: 'unit-1' });

    expect(stats.totalRegistrants).toBe(42);
    expect(stats.byStatus).toEqual({ REGISTERED: 30, ACCEPTED: 12 });
    expect(stats.activePeriods).toBe(1);
    expect(stats.recentRegistrants).toHaveLength(1);
    expect(stats.recentRegistrants[0].createdAt).toBe('2026-07-01T08:00:00.000Z');

    // Registrants have no direct unitId — scoping must go through the period
    expect(mocked.registrant.count).toHaveBeenCalledWith({
      where: { admissionPeriod: { unitId: 'unit-1' } },
    });
  });

  it('counts a period as active only while it is switched on AND open today', async () => {
    mocked.registrant.count.mockResolvedValue(0);
    mocked.registrant.groupBy.mockResolvedValue([]);
    mocked.admissionPeriod.count.mockResolvedValue(4);
    mocked.registrant.findMany.mockResolvedValue([]);

    const before = Date.now();
    await dashboardService.getAdmissionsStats({});
    const after = Date.now();

    // Same rule as the registration gate: a closed wave or one opening next
    // month is not an "active period", even with isActive still true.
    const where = mocked.admissionPeriod.count.mock.calls[0][0].where;
    expect(where.isActive).toBe(true);
    expect(where.startDate.lte.getTime()).toBeGreaterThanOrEqual(before);
    expect(where.startDate.lte.getTime()).toBeLessThanOrEqual(after);
    expect(where.endDate.gte.getTime()).toBeGreaterThanOrEqual(before);
    expect(where.endDate.gte.getTime()).toBeLessThanOrEqual(after);
  });
});

describe('dashboardService.getCBTSummary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('summarizes exams and attempts, averaging only scored attempts', async () => {
    mocked.exam.count
      .mockResolvedValueOnce(20) // total
      .mockResolvedValueOnce(2) // ongoing
      .mockResolvedValueOnce(5); // upcoming
    mocked.examAttempt.count.mockResolvedValue(300);
    mocked.examAttempt.aggregate.mockResolvedValue({ _avg: { score: 78.4 } });

    const stats = await dashboardService.getCBTSummary({});

    expect(stats).toEqual({
      totalExams: 20,
      ongoingExams: 2,
      upcomingExams: 5,
      totalAttempts: 300,
      avgScore: 78.4,
    });
    expect(mocked.examAttempt.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ score: { not: null } }) })
    );
  });

  it('counts only question-bank (CBT) exams, not written ones sharing the table', async () => {
    mocked.exam.count.mockResolvedValue(0);
    mocked.examAttempt.count.mockResolvedValue(0);
    mocked.examAttempt.aggregate.mockResolvedValue({ _avg: { score: null } });

    await dashboardService.getCBTSummary({ unitId: 'unit-1' });

    for (const [args] of mocked.exam.count.mock.calls) {
      expect(args.where).toMatchObject({ unitId: 'unit-1', questionBankId: { not: null } });
    }
    expect(mocked.exam.count).toHaveBeenCalledTimes(3);
    expect(mocked.examAttempt.count.mock.calls[0][0].where.exam).toMatchObject({
      questionBankId: { not: null },
    });
  });

  it('returns 0 average when no attempts are scored', async () => {
    mocked.exam.count.mockResolvedValue(0);
    mocked.examAttempt.count.mockResolvedValue(0);
    mocked.examAttempt.aggregate.mockResolvedValue({ _avg: { score: null } });

    const stats = await dashboardService.getCBTSummary({ unitId: 'unit-1' });
    expect(stats.avgScore).toBe(0);
  });
});
