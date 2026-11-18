import type { Prisma } from '@prisma/client';
import { PARENT_ROLE_CODES, STUDENT_ROLE_CODES } from '@cipansor/shared';
import type { ScopeActor } from '@/utils/student-scope';
import { studentScope } from '@/utils/student-scope';
import { seesAllUnits } from '@/utils/resolve-unit-id';

/**
 * The write-authority rule of this module (Penulis_Penilaian) now lives in
 * `@/utils/write-scope` (#1090): kurikulum-merdeka writes a santri's Merdeka
 * grade and P5 assessment too, so the rule has one home both modules share
 * rather than a second copy. Re-exported here so this module's own call sites
 * and tests keep importing from `./assessment-writer`.
 */
export {
  actorExamSubjects,
  assertExamWritable,
  assertGradesWritable,
  assertReportCardsWritable,
  isPenulisPenilaian,
  type AssessmentTarget,
  type TeacherSubjectFact,
} from '@/utils/write-scope';

/** A filter that matches no row. */
const NONE: Prisma.ExamWhereInput = { id: { in: [] } };

/**
 * The exams `actor` may read (R25.7): their own unit; every unit for a
 * cross-unit reader (`seesAllUnits`, narrowed by `unitId` at the call site);
 * for a santri or wali, the exams of classes their santri is actively in.
 */
export function examReadWhere(actor: ScopeActor): Prisma.ExamWhereInput {
  const code = actor.roleCode ?? '';
  if (STUDENT_ROLE_CODES.includes(code) || PARENT_ROLE_CODES.includes(code)) {
    return {
      class: { enrollments: { some: { status: 'active', student: studentScope(actor) } } },
    };
  }
  if (seesAllUnits(actor)) return {};
  return actor.unitId ? { unitId: actor.unitId } : NONE;
}
