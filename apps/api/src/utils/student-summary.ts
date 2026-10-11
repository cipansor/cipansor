import type { Prisma } from '@prisma/client';
import { CLASS_ENROLLMENT_STATUS } from '@cipansor/shared';

/**
 * The santri as a list or a detail screen names them: NIS, photo, name, unit
 * and the active class. Every read that returns a santri alongside another
 * record (a certificate, a violation, a reward) selects this, never
 * `include: { student: … }` — `include` on a relation sends every column of the
 * santri row, NIK and KK among them
 * (`.claude/memory/lessons/prisma-include-leaks-pii.md`).
 */
export const STUDENT_SUMMARY_SELECT = {
  id: true,
  nis: true,
  photoUrl: true,
  user: { select: { id: true, name: true } },
  unit: { select: { id: true, name: true, type: true } },
  enrollments: {
    where: { status: CLASS_ENROLLMENT_STATUS.ACTIVE },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { class: { select: { id: true, name: true } } },
  },
} as const satisfies Prisma.StudentSelect;

export type StudentSummaryRow = Prisma.StudentGetPayload<{
  select: typeof STUDENT_SUMMARY_SELECT;
}>;

/**
 * The row in the shape the pages and `@cipansor/shared` read: `name` and
 * `class` at the top. The raw row nests both (`user.name`,
 * `enrollments[0].class`), and a page reading `student.name` off it shows a
 * blank.
 */
export function toStudentSummary(row: StudentSummaryRow) {
  const { enrollments, ...rest } = row;
  return { ...rest, name: rest.user.name, class: enrollments[0]?.class };
}

/** A record read with `student: { select: STUDENT_SUMMARY_SELECT }`, its santri reshaped. */
export function withStudentSummary<T extends { student: StudentSummaryRow }>(
  row: T
): Omit<T, 'student'> & { student: ReturnType<typeof toStudentSummary> } {
  return { ...row, student: toStudentSummary(row.student) };
}
