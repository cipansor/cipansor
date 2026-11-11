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
/**
 * Every kind of reader, and the `student` filter its rows must carry. A key
 * missing from `where` means every santri (Super Admin, the yayasan organs);
 * `id in []` means none (komite, a unit role with no unit on its token).
 */
const SCOPE_CASES: Array<[string, ScopeActor, Record<string, unknown>]> = [
  ['Super Admin sees every unit', { sub: 'sa', roleCode: 'SUPER_ADMIN', unitId: null }, {}],
  ['a yayasan organ sees every unit', { sub: 'k', roleCode: 'YAYASAN_KETUA', unitId: null }, {}],
  ['a unit teacher sees their unit', teacher, { student: { unitId: 'unit-1' } }],
  [
    'a wali sees their own children',
    { sub: 'parent-1', roleCode: 'SDIT_ORANG_TUA', unitId: 'unit-1' },
    { student: { parents: { some: { parentId: 'parent-1' } } } },
  ],
  [
    'a santri sees themself',
    { sub: 'santri-1', roleCode: 'SDIT_SISWA', unitId: 'unit-1' },
    { student: { userId: 'santri-1' } },
  ],
  [
    'komite sees nobody',
    { sub: 'kom', roleCode: 'SDIT_KOMITE', unitId: 'unit-1' },
    { student: { id: { in: [] } } },
  ],
  [
    'a unit role without a unit sees nobody',
    { sub: 't2', roleCode: 'SDIT_GURU', unitId: null },
    { student: { id: { in: [] } } },
  ],
];

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

  it.each(SCOPE_CASES)('%s: every count carries the same scope', async (_name, actor, scope) => {
    await getRewardsSummary(actor);
    const where = mocked.reward.count.mock.calls[0][0].where;
    expect(where).toEqual(scope);
    // The points total too: without its scope it would add up the whole yayasan.
    expect(mocked.reward.aggregate.mock.calls[0][0].where).toEqual(where);
    expect(mocked.reward.groupBy).toHaveBeenCalledTimes(2);
    for (const call of mocked.reward.groupBy.mock.calls) {
      expect(call[0].where).toEqual(where);
    }
  });

  it('reads only the name of each santri on the podium', async () => {
    groupByReturns([], [{ studentId: 's-1', _count: { _all: 1 }, _sum: { points: 5 } }]);
    await getRewardsSummary(teacher);
    expect(mocked.student.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['s-1'] } },
      select: { id: true, user: { select: { name: true } } },
    });
  });

  it('orders the podium by points, then by id, so ties do not reshuffle', async () => {
    await getRewardsSummary(teacher);
    const byStudent = mocked.reward.groupBy.mock.calls.find(
      (c) => (c[0] as { by: string[] }).by[0] === 'studentId'
    );
    expect(byStudent?.[0].orderBy).toEqual([{ _sum: { points: 'desc' } }, { studentId: 'asc' }]);
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

  it('refuses a range that ends before it starts', () => {
    expect(
      rewardSummaryQuerySchema.safeParse({ startDate: '2026-10-31', endDate: '2026-10-01' }).success
    ).toBe(false);
  });
});
