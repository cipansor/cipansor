import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tahfidzRecord: { aggregate: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    student: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/dashboard-metrics', () => ({
  getCurrentDashboardMetrics: vi.fn(),
}));

import { prisma } from '@/lib/prisma';
import { dashboardService } from './dashboard.service';

const mocked = prisma as unknown as {
  tahfidzRecord: {
    aggregate: ReturnType<typeof vi.fn>;
    groupBy: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
  student: { findMany: ReturnType<typeof vi.fn> };
};

describe('dashboardService.getTahfidzStats — juz', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports juz by each juz’s own size, not ayat / 600', async () => {
    // Santri A: all of juz 30, 29 and 28 (564 + 431 + 137 = 1,132 ayat).
    // Santri B: the first half of juz 30 (282 ayat).
    mocked.tahfidzRecord.aggregate.mockResolvedValue({ _sum: { totalAyah: 1414 } });
    mocked.tahfidzRecord.groupBy.mockImplementation(({ by }: { by: string[] }) =>
      Promise.resolve(
        by.includes('juz')
          ? [
              { studentId: 'a', juz: 30, _sum: { totalAyah: 564 } },
              { studentId: 'a', juz: 29, _sum: { totalAyah: 431 } },
              { studentId: 'a', juz: 28, _sum: { totalAyah: 137 } },
              { studentId: 'b', juz: 30, _sum: { totalAyah: 282 } },
            ]
          : [
              { studentId: 'a', _sum: { totalAyah: 1132 } },
              { studentId: 'b', _sum: { totalAyah: 282 } },
            ]
      )
    );
    mocked.student.findMany.mockResolvedValue([
      { id: 'a', user: { name: 'Santri A' }, unit: { name: "SMA Qur'an" } },
      { id: 'b', user: { name: 'Santri B' }, unit: { name: 'SD IT' } },
    ]);
    mocked.tahfidzRecord.findMany.mockResolvedValue([]);

    const stats = await dashboardService.getTahfidzStats({});

    // ayat / 600 said 1 juz for A and 0 for B, and an average of 1.2.
    expect(stats.topStudents.map((s) => s.totalJuz)).toEqual([3, 0.5]);
    expect(stats.averageJuz).toBe(1.8);
  });
});
