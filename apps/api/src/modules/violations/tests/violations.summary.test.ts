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
      byType: [
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
});
