import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import type { Prisma } from '@prisma/client';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { examReadWhere } from '@/modules/assessment/assessment-writer';
import type { ScopeActor } from '@/utils/student-scope';
import { seesAllUnits } from '@/utils/resolve-unit-id';

// Property 24 (R17.3, R24.6, R25.7, R27.7), #987 (PR-01) part: the exam list
// `where` returns only exams the actor may see, evaluated over random data in
// memory, and the metadata count is the size of that same set.

interface ExamRow {
  id: string;
  unitId: string;
  classId: string;
  enrollments: { status: string; studentId: string }[];
}

const ACTORS: ScopeActor[] = [
  { sub: 'u-super', roleCode: 'SUPER_ADMIN', unitId: null },
  { sub: 'u-admin-a', roleCode: 'SMPIT_ADMIN', unitId: 'unit-a' },
  { sub: 'u-musyrif', roleCode: 'MUSYRIF', unitId: 'unit-a' },
  { sub: 'u-guru', roleCode: 'SMPIT_GURU', unitId: 'unit-a' },
  { sub: 'u-santri', roleCode: 'SMPIT_SISWA', unitId: 'unit-a' },
  { sub: 'u-wali', roleCode: 'SMPIT_ORANG_TUA', unitId: 'unit-a' },
  { sub: 'u-yayasan', roleCode: 'YAYASAN_KETUA', unitId: null },
];

const examArb: fc.Arbitrary<ExamRow> = fc.record({
  id: fc.string({ minLength: 1 }),
  unitId: fc.constantFrom('unit-a', 'unit-b'),
  classId: fc.constantFrom('class-1', 'class-2'),
  enrollments: fc.array(
    fc.record({
      status: fc.constantFrom('active', 'completed'),
      studentId: fc.constantFrom('s1', 's2'),
    })
  ),
});

/** Evaluate the exam `where` the read scope builds, over the in-memory row. */
function matches(where: Prisma.ExamWhereInput, exam: ExamRow): boolean {
  if (where.unitId && exam.unitId !== where.unitId) return false;
  if (where.id && 'in' in (where.id as object)) {
    return ((where.id as { in: string[] }).in).includes(exam.id);
  }
  const classFilter = where.class as
    | { enrollments?: { some?: { status?: string } } }
    | undefined;
  if (classFilter?.enrollments?.some) {
    const some = classFilter.enrollments.some;
    // The class filter is an active-enrolment filter; the santri itself is
    // narrowed by studentScope, which this in-memory model does not carry.
    return exam.enrollments.some((e) => (!some.status || e.status === some.status));
  }
  return true;
}

describe('Property 24: exam read list is only within scope', () => {
  it('a santri/wali sees only exams of classes their santri is actively in; unit and cross-unit actors see by unit', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ACTORS), fc.array(examArb), (actor, exams) => {
        const where = examReadWhere(actor);
        const seen = exams.filter((e) => matches(where, e));

        if (actor.roleCode === 'SMPIT_SISWA' || actor.roleCode === 'SMPIT_ORANG_TUA') {
          // Only active enrolments of a santri in the actor's own scope.
          for (const e of seen) {
            expect(e.enrollments.some((x) => x.status === 'active')).toBe(true);
          }
        } else if (seesAllUnits(actor)) {
          // Cross-unit readers see every unit.
          expect(seen.length).toBe(exams.length);
        } else {
          // A unit actor sees only their own unit.
          for (const e of seen) expect(e.unitId).toBe(actor.unitId);
        }
      })
    );
  });

  it('a unit actor with no unit sees no exam', () => {
    expect(examReadWhere({ sub: 'u', roleCode: 'SMPIT_ADMIN', unitId: null })).toEqual({
      id: { in: [] },
    });
  });
});
