import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    violation: { count: vi.fn(), aggregate: vi.fn(), groupBy: vi.fn() },
    student: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/prisma';
import { getViolationsSummary } from '../violations.service';
import { violationSummaryQuerySchema } from '../violations.schema';
import type { ScopeActor } from '@/utils/student-scope';

const mocked = prisma as unknown as {
  violation: Record<string, ReturnType<typeof vi.fn>>;
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

/** groupBy is called three times: by type, by category, by student. */
function groupByReturns(byType: unknown[], byCategory: unknown[], byStudent: unknown[]) {
  mocked.violation.groupBy.mockImplementation(async (args: { by: string[] }) => {
    if (args.by[0] === 'type') return byType;
    if (args.by[0] === 'category') return byCategory;
    return byStudent;
  });
}

describe('GET /violations/summary — getViolationsSummary (#764)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.violation.count.mockResolvedValue(0);
    mocked.violation.aggregate.mockResolvedValue({ _sum: { points: null } });
    mocked.student.findMany.mockResolvedValue([]);
    groupByReturns([], [], []);
  });

  it('counts only the santri of the caller\u2019s unit', async () => {
    await getViolationsSummary(teacher);
    const where = mocked.violation.count.mock.calls[0][0].where;
    expect(where).toEqual({ student: { unitId: 'unit-1' } });
    for (const call of mocked.violation.groupBy.mock.calls) {
      expect(call[0].where).toEqual(where);
    }
    expect(mocked.violation.aggregate.mock.calls[0][0].where).toEqual(where);
  });

  it.each(SCOPE_CASES)('%s: every count carries the same scope', async (_name, actor, scope) => {
    await getViolationsSummary(actor);
    const where = mocked.violation.count.mock.calls[0][0].where;
    expect(where).toEqual(scope);
    expect(mocked.violation.aggregate.mock.calls[0][0].where).toEqual(where);
    expect(mocked.violation.groupBy).toHaveBeenCalledTimes(3);
    for (const call of mocked.violation.groupBy.mock.calls) {
      expect(call[0].where).toEqual(where);
    }
  });

  it('reads only the name of each santri on the podium', async () => {
    groupByReturns([], [], [{ studentId: 's-1', _count: { _all: 1 }, _sum: { points: 5 } }]);
    await getViolationsSummary(teacher);
    expect(mocked.student.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['s-1'] } },
      select: { id: true, user: { select: { name: true } } },
    });
  });

  it('orders the podium by points, then by id, so ties do not reshuffle', async () => {
    await getViolationsSummary(teacher);
    const byStudent = mocked.violation.groupBy.mock.calls.find(
      (c) => (c[0] as { by: string[] }).by[0] === 'studentId'
    );
    expect(byStudent?.[0].orderBy).toEqual([{ _sum: { points: 'desc' } }, { studentId: 'asc' }]);
  });

  it('bounds the range by WIB days, the end day included', async () => {
    await getViolationsSummary(teacher, { startDate: '2026-10-01', endDate: '2026-10-31' });
    const where = mocked.violation.count.mock.calls[0][0].where;
    // 2026-10-01 00:00 WIB is 2026-09-30 17:00 UTC; 31 Oct ends at 16:59:59.999 UTC.
    expect(where.occurredAt.gte.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(where.occurredAt.lte.toISOString()).toBe('2026-10-31T16:59:59.999Z');
  });

  it('returns the figures the cards read, with santri names', async () => {
    mocked.violation.count.mockResolvedValue(4);
    mocked.violation.aggregate.mockResolvedValue({ _sum: { points: 35 } });
    groupByReturns(
      [
        { type: 'MINOR', _count: { _all: 3 } },
        { type: 'MAJOR', _count: { _all: 1 } },
      ],
      [{ category: 'ketertiban', _count: { _all: 4 }, _sum: { points: 35 } }],
      [{ studentId: 's-1', _count: { _all: 4 }, _sum: { points: 35 } }]
    );
    mocked.student.findMany.mockResolvedValue([{ id: 's-1', user: { name: 'Ahmad' } }]);

    const summary = await getViolationsSummary(teacher);

    expect(summary).toEqual({
      totalViolations: 4,
      totalPoints: 35,
      bySeverity: [
        { type: 'MINOR', count: 3 },
        { type: 'MAJOR', count: 1 },
      ],
      byCategory: [{ category: 'ketertiban', count: 4, points: 35 }],
      topStudents: [{ studentId: 's-1', name: 'Ahmad', count: 4, points: 35 }],
    });
  });

  it('does not look up names when nobody has a violation', async () => {
    const summary = await getViolationsSummary(teacher);
    expect(mocked.student.findMany).not.toHaveBeenCalled();
    expect(summary.totalPoints).toBe(0);
  });

  it('accepts only calendar dates in the query', () => {
    expect(violationSummaryQuerySchema.safeParse({ startDate: '2026-10-01' }).success).toBe(true);
    expect(violationSummaryQuerySchema.safeParse({ startDate: 'kemarin' }).success).toBe(false);
  });

  it('refuses a range that ends before it starts, and accepts a single day', () => {
    const backwards = violationSummaryQuerySchema.safeParse({
      startDate: '2026-10-31',
      endDate: '2026-10-01',
    });
    expect(backwards.success).toBe(false);
    expect(backwards.error?.issues[0].path).toEqual(['endDate']);
    expect(
      violationSummaryQuerySchema.safeParse({ startDate: '2026-10-01', endDate: '2026-10-01' })
        .success
    ).toBe(true);
  });
});
