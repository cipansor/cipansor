import type { Prisma } from '@prisma/client';
import {
  ADMIN_ROLE_CODES,
  KEPALA_UNIT_ROLE_CODES,
  PARENT_ROLE_CODES,
  STUDENT_ROLE_CODES,
} from '@cipansor/shared';
import { prisma } from '@/lib/prisma';
import { Errors } from '@/middleware/error';
import type { ScopeActor } from '@/utils/student-scope';
import { studentScope } from '@/utils/student-scope';
import { seesAllUnits } from '@/utils/resolve-unit-id';
import { isCrossUnitWriter, unitWritable, type WriteActor } from '@/utils/write-scope';
import {
  mayWriteGradeVia,
  mayWriteReportCardVia,
  teachingRelations,
  type TeachingRelation,
} from '@/utils/teaching-relation';

/** A filter that matches no row. */
const NONE: Prisma.ExamWhereInput = { id: { in: [] } };

/** One active TeacherSubject of the actor, as the exam rule reads it. */
export interface TeacherSubjectFact {
  subjectId: string;
  classId: string | null;
  /** The unit the subject is taught in: the class's, or the Teacher's for `classId` null. */
  unitId: string;
}

/** The target of an assessment write, from facts the caller has already loaded. */
export type AssessmentTarget =
  | {
      kind: 'EXAM';
      unitId: string;
      subjectId: string;
      classId: string;
      actorSubjects: TeacherSubjectFact[];
    }
  | {
      kind: 'GRADE' | 'REPORT_CARD';
      studentUnitId: string;
      relations: Set<TeachingRelation>;
    };

/**
 * Penulis_Penilaian — whether `actor` may write the given exam, grade or report
 * card (#987). Pure: every fact is passed in, so the rule can be tested
 * directly. The glossary's rule:
 *
 * - Super_Admin: any unit;
 * - Admin_Unit or Kepala_Unit of the record's unit;
 * - anyone else (a teacher-level account): a grade needs relation (a), (b) or
 *   (c); a report card needs any relation; an exam needs an active
 *   TeacherSubject for its subject and class (or all classes) in its unit.
 *
 * A role that reads across units (`seesAllUnits`) gets no write from that
 * breadth: only the rules above apply (R13.8).
 */
export function isPenulisPenilaian(actor: WriteActor, target: AssessmentTarget): boolean {
  if (isCrossUnitWriter(actor)) return true;

  const unit = target.kind === 'EXAM' ? target.unitId : target.studentUnitId;
  const isUnitLeader =
    ADMIN_ROLE_CODES.includes(actor.roleCode) || KEPALA_UNIT_ROLE_CODES.includes(actor.roleCode);
  // A unit leader writes their whole unit and no other — a relation does not
  // extend a leader's reach to another unit (the relation clause is for the
  // teacher-level accounts below).
  if (isUnitLeader) return unitWritable(actor, unit);

  if (target.kind === 'EXAM') {
    return target.actorSubjects.some(
      (s) =>
        s.subjectId === target.subjectId &&
        (s.classId === target.classId || s.classId === null) &&
        s.unitId === target.unitId
    );
  }
  if (target.kind === 'GRADE') return mayWriteGradeVia(target.relations);
  return mayWriteReportCardVia(target.relations);
}

/** The actor's active TeacherSubjects as exam facts, or none if they have no Teacher row. */
export async function actorExamSubjects(actor: WriteActor): Promise<TeacherSubjectFact[]> {
  const teacher = await prisma.teacher.findFirst({
    where: { userId: actor.sub, deletedAt: null },
    select: { unitId: true },
  });
  if (!teacher) return [];
  const rows = await prisma.teacherSubject.findMany({
    where: { teacher: { userId: actor.sub, deletedAt: null }, isActive: true },
    select: { subjectId: true, classId: true, class: { select: { unitId: true } } },
  });
  return rows.map((r) => ({
    subjectId: r.subjectId,
    classId: r.classId,
    unitId: r.classId ? (r.class?.unitId ?? teacher.unitId) : teacher.unitId,
  }));
}

/**
 * 404 unless `examId` is an exam `actor` may write — same answer as an id that
 * does not exist. Returns the row so a caller can reuse it. `resource` names
 * the answer's subject so it reads the same as the endpoint's own missing-id
 * answer (R13.1, R25.4).
 */
export async function assertExamWritable(actor: WriteActor, examId: string, resource = 'Exam') {
  const exam = await prisma.exam.findUnique({
    where: { id: examId },
    select: { id: true, unitId: true, subjectId: true, classId: true },
  });
  if (!exam) throw Errors.notFound(resource);

  const target: AssessmentTarget = {
    kind: 'EXAM',
    unitId: exam.unitId,
    subjectId: exam.subjectId,
    classId: exam.classId,
    actorSubjects: await actorExamSubjects(actor),
  };
  if (!isPenulisPenilaian(actor, target)) throw Errors.notFound(resource);
  return exam;
}

/**
 * 404 unless every santri among `studentIds`, and every exam among `examIds`,
 * is one `actor` may write. `resource` names the answer so a grade endpoint's
 * out-of-scope answer reads like its own missing-id answer (R13.2, R25.4).
 */
export async function assertGradesWritable(
  actor: WriteActor,
  studentIds: string[],
  examIds: string[] = [],
  resource = 'Student'
): Promise<void> {
  const ids = [...new Set(studentIds)];
  if (ids.length) {
    const students = await prisma.student.findMany({
      where: { id: { in: ids } },
      select: { id: true, unitId: true },
    });
    if (students.length !== ids.length) throw Errors.notFound(resource);
    // A Penulis_Lintas_Unit writes any santri; relations are not consulted.
    if (!isCrossUnitWriter(actor)) {
      const relations = await teachingRelations(actor.sub, ids);
      for (const s of students) {
        if (
          !isPenulisPenilaian(actor, {
            kind: 'GRADE',
            studentUnitId: s.unitId,
            relations: relations.get(s.id) ?? new Set(),
          })
        ) {
          throw Errors.notFound(resource);
        }
      }
    }
  }
  for (const examId of [...new Set(examIds)].filter(Boolean)) {
    await assertExamWritable(actor, examId, resource);
  }
}

/**
 * 404 unless every santri among `studentIds` is one `actor` may write a report
 * card for. `resource` names the answer so a report card endpoint's
 * out-of-scope answer reads like its own missing-id answer (R13.3, R25.5).
 */
export async function assertReportCardsWritable(
  actor: WriteActor,
  studentIds: string[],
  resource = 'Student'
): Promise<void> {
  const ids = [...new Set(studentIds)];
  if (!ids.length) return;
  const students = await prisma.student.findMany({
    where: { id: { in: ids } },
    select: { id: true, unitId: true },
  });
  if (students.length !== ids.length) throw Errors.notFound(resource);
  if (isCrossUnitWriter(actor)) return;
  const relations = await teachingRelations(actor.sub, ids);
  for (const s of students) {
    if (
      !isPenulisPenilaian(actor, {
        kind: 'REPORT_CARD',
        studentUnitId: s.unitId,
        relations: relations.get(s.id) ?? new Set(),
      })
    ) {
      throw Errors.notFound(resource);
    }
  }
}

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
