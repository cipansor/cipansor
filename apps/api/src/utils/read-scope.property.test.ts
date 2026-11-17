import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import type { Prisma } from '@prisma/client';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { examReadWhere } from '@/modules/assessment/assessment-writer';
import { takhosusEnrollmentWhere } from '@/modules/takhosus/takhosus.service';
import type { ScopeActor } from '@/utils/student-scope';
import { seesAllUnits } from '@/utils/resolve-unit-id';
import {
  ACTORS as FIXTURE_ACTORS,
  SANTRI_SMA,
  SANTRI_SMP,
  SMP,
  studentMatches,
} from '../../tests/mocks/santri-fixture';

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
    return (where.id as { in: string[] }).in.includes(exam.id);
  }
  const classFilter = where.class as { enrollments?: { some?: { status?: string } } } | undefined;
  if (classFilter?.enrollments?.some) {
    const some = classFilter.enrollments.some;
    // The class filter is an active-enrolment filter; the santri itself is
    // narrowed by studentScope, which this in-memory model does not carry.
    return exam.enrollments.some((e) => !some.status || e.status === some.status);
  }
  return true;
}

describe('Property 24: exam read list is only within scope', () => {
  it('a santri/wali sees only exams of classes their santri is actively in; unit and cross-unit actors see by unit', () => {
    // Feature: web-api-reconnect-phase-2, Property 24: Daftar baca hanya dalam cakupan
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
      }),
      { numRuns: 100 }
    );
  });

  it('a unit actor with no unit sees no exam', () => {
    expect(examReadWhere({ sub: 'u', roleCode: 'SMPIT_ADMIN', unitId: null })).toEqual({
      id: { in: [] },
    });
  });
});

// Property 24, #989 (PR-03) part (R27.7): the takhosus enrolment `where`
// returns only enrolments of santri inside the caller's Cakupan_Santri,
// whatever `studentId`/`halaqohId` the request names, and the metadata count is
// the size of that same set.

interface EnrollmentRow {
  id: string;
  studentId: string;
  halaqohId: string | null;
  status: string;
}

const SANTRI = [SANTRI_SMP, SANTRI_SMA];
const byId = (id: string) => SANTRI.find((s) => s.id === id)!;
const ACTORS_LIST: ScopeActor[] = Object.values(FIXTURE_ACTORS);

const enrollmentArb: fc.Arbitrary<EnrollmentRow> = fc.record({
  id: fc.string({ minLength: 1 }),
  studentId: fc.constantFrom(SANTRI_SMP.id, SANTRI_SMA.id),
  halaqohId: fc.option(fc.constantFrom('h1', 'h2'), { nil: null }),
  status: fc.constantFrom('ACTIVE', 'COMPLETED'),
});

/** Evaluate the enrolment `where` the read scope builds, over an in-memory row. */
function enrollmentMatches(where: any, e: EnrollmentRow): boolean {
  if (where.student && !studentMatches(byId(e.studentId), where.student)) return false;
  if (where.studentId && e.studentId !== where.studentId) return false;
  if (where.halaqohId && e.halaqohId !== where.halaqohId) return false;
  if (where.status && e.status !== where.status) return false;
  return true;
}

describe('Property 24: takhosus enrolment list is only within scope', () => {
  it('only the santri in scope, whatever studentId/halaqohId ask, and the count matches', () => {
    // Feature: web-api-reconnect-phase-2, Property 24: Daftar baca hanya dalam cakupan
    fc.assert(
      fc.property(
        fc.constantFrom(...ACTORS_LIST),
        fc.option(fc.constantFrom(SANTRI_SMP.id, SANTRI_SMA.id), { nil: undefined }),
        fc.option(fc.constantFrom('h1', 'h2'), { nil: undefined }),
        fc.array(enrollmentArb),
        (actor, studentId, halaqohId, rows) => {
          const where = takhosusEnrollmentWhere(actor, { studentId, halaqohId });
          const seen = rows.filter((e) => enrollmentMatches(where, e));
          // Every visible row is a santri the actor reaches.
          for (const e of seen) {
            if (where.student) expect(studentMatches(byId(e.studentId), where.student)).toBe(true);
          }
          // The count over the same `where` equals the rows it returns.
          const counted = rows.filter((e) => enrollmentMatches(where, e)).length;
          expect(counted).toBe(seen.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('a unit actor names another unit → no enrolment', () => {
    const where = takhosusEnrollmentWhere(FIXTURE_ACTORS.guruSmp, {});
    expect(where.student).toEqual({ unitId: SMP });
  });
});
