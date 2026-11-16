import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { isPenulisPenilaian, type AssessmentTarget, type TeacherSubjectFact } from '../assessment-writer';
import type { TeachingRelation } from '@/utils/teaching-relation';
import type { WriteActor } from '@/utils/write-scope';

// Property 9 (R13.1, R13.2, R13.3, R13.6, R13.8, R25.3, R25.6): `isPenulisPenilaian`
// is true exactly when the glossary names the actor a Penulis_Penilaian. It is
// pure, so the rule is checked directly without a database.

const UNITS = ['unit-a', 'unit-b'];
const ACTOR_ROLES = [
  'SUPER_ADMIN',
  'SMPIT_ADMIN',
  'SMPIT_KEPALA_SEKOLAH',
  'PESANTREN_PENGASUH',
  'SMPIT_GURU',
  'MUSYRIF',
  'MUHAFIDZ',
  'USTADZ',
];

const actorArb: fc.Arbitrary<WriteActor> = fc.record({
  sub: fc.constant('u1'),
  roleCode: fc.constantFrom(...ACTOR_ROLES),
  unitId: fc.option(fc.constantFrom(...UNITS), { nil: null }),
});

const relationsArb = fc
  .subarray(['SUBJECT', 'HALAQOH', 'MUSYRIF', 'HOMEROOM'] as TeachingRelation[])
  .map((r) => new Set(r));

const gradeTargetArb: fc.Arbitrary<AssessmentTarget> = fc.record({
  kind: fc.constant('GRADE' as const),
  studentUnitId: fc.constantFrom(...UNITS),
  relations: relationsArb,
});

const reportTargetArb: fc.Arbitrary<AssessmentTarget> = fc.record({
  kind: fc.constant('REPORT_CARD' as const),
  studentUnitId: fc.constantFrom(...UNITS),
  relations: relationsArb,
});

const examTargetArb: fc.Arbitrary<AssessmentTarget> = fc.record({
  kind: fc.constant('EXAM' as const),
  unitId: fc.constantFrom(...UNITS),
  subjectId: fc.constantFrom('sub-1', 'sub-2'),
  classId: fc.constantFrom('class-1', 'class-2'),
  actorSubjects: fc.array(
    fc.record({
      subjectId: fc.constantFrom('sub-1', 'sub-2'),
      classId: fc.option(fc.constantFrom('class-1', 'class-2'), { nil: null }),
      unitId: fc.constantFrom(...UNITS),
    })
  ) as fc.Arbitrary<TeacherSubjectFact[]>,
});

describe('Property 9: Penulis_Penilaian', () => {
  it('Super_Admin writes any record of any unit', () => {
    fc.assert(
      fc.property(
        fc.oneof(gradeTargetArb, reportTargetArb, examTargetArb),
        (target) => {
          const actor: WriteActor = { sub: 'u1', roleCode: 'SUPER_ADMIN', unitId: null };
          expect(isPenulisPenilaian(actor, target)).toBe(true);
        }
      )
    );
  });

  it('an Admin_Unit or Kepala_Unit writes any record of its own unit, none of another', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('SMPIT_ADMIN', 'SMPIT_KEPALA_SEKOLAH', 'PESANTREN_PENGASUH'),
        fc.constantFrom(...UNITS),
        // Grade and report targets: for an exam a leader could also be a
        // teacher with a subject in another unit, which the exam rule covers.
        fc.oneof(gradeTargetArb, reportTargetArb),
        (roleCode, unitId, target) => {
          const actor: WriteActor = { sub: 'u1', roleCode, unitId };
          const targetUnit = target.kind === 'EXAM' ? target.unitId : target.studentUnitId;
          expect(isPenulisPenilaian(actor, target)).toBe(targetUnit === unitId);
        }
      )
    );
  });

  it('a teacher-level account needs the relation: (d) alone never writes a grade', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('SMPIT_GURU', 'MUSYRIF', 'MUHAFIDZ', 'USTADZ'),
        relationsArb,
        (roleCode, relations) => {
          const actor: WriteActor = { sub: 'u1', roleCode, unitId: 'unit-a' };
          const target: AssessmentTarget = {
            kind: 'GRADE',
            studentUnitId: 'unit-a',
            relations,
          };
          const expected =
            relations.has('SUBJECT') || relations.has('HALAQOH') || relations.has('MUSYRIF');
          expect(isPenulisPenilaian(actor, target)).toBe(expected);
        }
      )
    );
  });

  it('a report card is writable through any relation, including (d)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('SMPIT_GURU', 'MUSYRIF', 'MUHAFIDZ', 'USTADZ'),
        relationsArb,
        (roleCode, relations) => {
          const actor: WriteActor = { sub: 'u1', roleCode, unitId: 'unit-a' };
          const target: AssessmentTarget = {
            kind: 'REPORT_CARD',
            studentUnitId: 'unit-a',
            relations,
          };
          expect(isPenulisPenilaian(actor, target)).toBe(relations.size > 0);
        }
      )
    );
  });

  it('an exam needs an active TeacherSubject for its subject and class (or all classes) in its unit', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('SMPIT_GURU', 'MUSYRIF', 'MUHAFIDZ', 'USTADZ'),
        examTargetArb,
        (roleCode, target) => {
          if (target.kind !== 'EXAM') return;
          const actor: WriteActor = { sub: 'u1', roleCode, unitId: 'unit-a' };
          const expected = target.actorSubjects.some(
            (s) =>
              s.subjectId === target.subjectId &&
              (s.classId === target.classId || s.classId === null) &&
              s.unitId === target.unitId
          );
          expect(isPenulisPenilaian(actor, target)).toBe(expected);
        }
      )
    );
  });

  it('never grants a write from cross-unit read breadth: a teacher of another unit is refused', () => {
    fc.assert(
      fc.property(fc.constantFrom('MUSYRIF', 'MUHAFIDZ', 'USTADZ', 'SMPIT_GURU'), (roleCode) => {
        const actor: WriteActor = { sub: 'u1', roleCode, unitId: 'unit-a' };
        const target: AssessmentTarget = {
          kind: 'REPORT_CARD',
          studentUnitId: 'unit-b',
          relations: new Set(),
        };
        expect(isPenulisPenilaian(actor, target)).toBe(false);
      })
    );
  });
});
