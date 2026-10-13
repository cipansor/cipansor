import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * A teacher is also an employee. Attendance, leave and payslips all key on
 * `Staff`, so every `Teacher` must have a `Staff` row and `teachers.staff_id`
 * must point at it — otherwise a guru's day is written nowhere.
 *
 * The NIP is copied from the teacher so the two records carry the same staff
 * number; `joinDate` is copied when the teacher has one. `position` is NOT
 * NULL on `Staff`, so the department doubles as the default jabatan — a
 * teacher with no explicit position is a "Guru" of their unit.
 */
export function teacherStaffData(
  teacher: { userId: string; unitId: string; nip?: string | null; joinDate?: Date | null },
  department = 'Guru'
): Prisma.StaffUncheckedCreateInput {
  return {
    userId: teacher.userId,
    unitId: teacher.unitId,
    nip: teacher.nip ?? undefined,
    joinDate: teacher.joinDate ?? undefined,
    position: department,
    department,
  };
}

/**
 * Create the `Staff` row for a teacher and link it back, returning the id.
 * Pass the transaction client when called inside one.
 */
export async function linkTeacherToStaff(
  db: PrismaClient | Prisma.TransactionClient,
  teacher: {
    id: string;
    userId: string;
    unitId: string;
    nip?: string | null;
    joinDate?: Date | null;
  },
  department = 'Guru'
): Promise<string> {
  const existing = await db.staff.findUnique({
    where: { userId: teacher.userId },
    select: { id: true },
  });
  const staff =
    existing ??
    (await db.staff.create({
      data: teacherStaffData(teacher, department),
      select: { id: true },
    }));
  await db.teacher.update({ where: { id: teacher.id }, data: { staffId: staff.id } });
  return staff.id;
}
