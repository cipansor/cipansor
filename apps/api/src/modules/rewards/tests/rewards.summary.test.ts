import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    reward: { count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
    student: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { getRewardsSummary } from '../rewards.service';
import { rewardSummaryQuerySchema } from '../rewards.schema';
import type { ScopeActor } from '@/utils/student-scope';

const mocked = prisma as unknown as {
  reward: Record<string, ReturnType<typeof vi.fn>>;
  student: Record<string, ReturnType<typeof vi.fn>>;
};

const teacher: ScopeActor = { sub: 'teacher-1', roleCode: 'SDIT_GURU', unitId: 'unit-1' };
const parent: ScopeActor = { sub: 'parent-1', roleCode: 'SDIT_ORANG_TUA', unitId: 'unit-1' };

function groupByReturns(byCategory: unknown[], byStudent: unknown[]) {
  mocked.reward.groupBy.mockImplementation(async (args: { by: string[] }) =>
    args.by[0] === 'category' ? byCategory : byStudent
  );
}

describe('GET /rewards/summary — getRewardsSummary (#764)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.reward.count.mockResolvedValue(0);
    mocked.reward.aggregate.mockResolvedValue({ _sum: { points: null } });
    mocked.student.findMany.mockResolvedValue([]);
    groupByReturns([], []);
  });

  it('counts only the santri of the caller\u2019s unit', async () => {
    await getRewardsSummary(teacher);
    const where = mocked.reward.count.mock.calls[0][0].where;
    expect(where).toEqual({ student: { unitId: 'unit-1' } });
    for (const call of mocked.reward.groupBy.mock.calls) {
      expect(call[0].where).toEqual(where);
    }
  });

  it('a wali counts their own children only', async () => {
    await getRewardsSummary(parent);
    expect(mocked.reward.count.mock.calls[0][0].where).toEqual({
      student: { parents: { some: { parentId: 'parent-1' } } },
    });
  });

  it('bounds the range by WIB days on givenAt', async () => {
    await getRewardsSummary(teacher, { startDate: '2026-10-01' });
    const where = mocked.reward.count.mock.calls[0][0].where;
    expect(where.givenAt.gte.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(where.givenAt.lte).toBeUndefined();
  });

  it('returns totals, the real categories and the podium with names', async () => {
    mocked.reward.count.mockResolvedValue(3);
    mocked.reward.aggregate.mockResolvedValue({ _sum: { points: 60 } });
    groupByReturns(
      [
        { category: 'tahfidz', _count: { _all: 2 }, _sum: { points: 50 } },
        { category: 'akhlak', _count: { _all: 1 }, _sum: { points: 10 } },
      ],
      [{ studentId: 's-1', _count: { _all: 3 }, _sum: { points: 60 } }]
    );
    mocked.student.findMany.mockResolvedValue([{ id: 's-1', user: { name: 'Fatimah' } }]);

    expect(await getRewardsSummary(teacher)).toEqual({
      totalRewards: 3,
      totalPoints: 60,
      byCategory: [
        { category: 'tahfidz', count: 2, points: 50 },
        { category: 'akhlak', count: 1, points: 10 },
      ],
      topStudents: [{ studentId: 's-1', name: 'Fatimah', count: 3, points: 60 }],
    });
  });

  it('accepts only calendar dates in the query', () => {
    expect(rewardSummaryQuerySchema.safeParse({ endDate: '2026-10-31' }).success).toBe(true);
    expect(rewardSummaryQuerySchema.safeParse({ endDate: '31/10/2026' }).success).toBe(false);
  });
});
