import { prisma } from '@/lib/prisma';
import { ApiError, ErrorCode, Errors } from '@/middleware/error';
import {
  ADMIN_ROLE_CODES,
  type AttendanceRecorderClass,
  type AttendanceRecorderScope,
} from '@cipansor/shared';

/**
 * Who records a class's daily attendance (2026-09-27): the class's wali kelas
 * (`Class.homeroomTeacherId`), a teacher with a lesson in it (an active
 * `Schedule`), the operator of its unit, and the super admin. The kepala
 * sekolah reads the unit's register, and records only where they are one of
 * the above.
 *
 * Until then only admins could write — every teacher's register was refused —
 * and an admin could write any unit's class.
 */

export interface AttendanceActor {
  sub: string;
  roleCode?: string | null;
  unitId: string | null;
}

type Standing = 'ADMIN' | 'HOMEROOM' | 'TEACHER';

// The WIB day helpers live in `@/utils/wib` (one home); re-exported here so
// existing importers of this module keep working.
import { todayWib, dayOf, dayString } from '@/utils/wib';
export { todayWib, dayOf, dayString };

const isSuperAdmin = (actor: AttendanceActor) => actor.roleCode === 'SUPER_ADMIN';
const isUnitAdmin = (actor: AttendanceActor) =>
  !!actor.roleCode && actor.roleCode !== 'SUPER_ADMIN' && ADMIN_ROLE_CODES.includes(actor.roleCode);

const teacherIdOf = async (actor: AttendanceActor) =>
  (
    await prisma.teacher.findFirst({
      where: { userId: actor.sub, deletedAt: null },
      select: { id: true },
    })
  )?.id ?? null;

/**
 * The class, if the caller may record its register on `day`; otherwise 404
 * for a class outside the caller's unit, 403 inside it, 400 for a day outside
 * the class's academic year or after today.
 */
export async function assertMayRecord(classId: string, day: string, actor: AttendanceActor) {
  const cls = await prisma.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: {
      id: true,
      unitId: true,
      homeroomTeacherId: true,
      academicYear: { select: { startDate: true, endDate: true } },
    },
  });
  if (!cls || (!isSuperAdmin(actor) && cls.unitId !== actor.unitId)) {
    throw new ApiError(ErrorCode.NOT_FOUND, 'Kelas tidak ditemukan');
  }

  let standing: Standing | null = null;
  if (isSuperAdmin(actor) || isUnitAdmin(actor)) {
    standing = 'ADMIN';
  } else {
    const teacherId = await teacherIdOf(actor);
    if (teacherId && teacherId === cls.homeroomTeacherId) {
      standing = 'HOMEROOM';
    } else if (teacherId) {
      const lesson = await prisma.schedule.findFirst({
        where: { classId, teacherId, isActive: true },
        select: { id: true },
      });
      if (lesson) standing = 'TEACHER';
    }
  }
  if (!standing) {
    throw Errors.forbidden(
      'Absensi kelas ini dicatat oleh wali kelasnya, guru yang mengajar di kelas itu, atau operator unit'
    );
  }

  const inYear =
    day >= dayString(cls.academicYear.startDate) && day <= dayString(cls.academicYear.endDate);
  if (!inYear || day > todayWib()) {
    throw Errors.badRequest(
      'Absensi dicatat untuk hari pada tahun ajaran kelas ini, paling lambat hari ini'
    );
  }
  return cls;
}

/** GET /attendance/me/classes — which classes the caller records. */
export async function recorderScope(actor: AttendanceActor): Promise<AttendanceRecorderScope> {
  if (isSuperAdmin(actor)) return { scope: 'ALL', unitId: null, classes: [] };
  if (isUnitAdmin(actor)) return { scope: 'UNIT', unitId: actor.unitId, classes: [] };

  const teacherId = await teacherIdOf(actor);
  if (!teacherId) return { scope: 'ASSIGNED', unitId: actor.unitId, classes: [] };

  const now = new Date();
  const classes = await prisma.class.findMany({
    where: {
      deletedAt: null,
      academicYear: { startDate: { lte: now }, endDate: { gte: now } },
      OR: [
        { homeroomTeacherId: teacherId },
        { schedules: { some: { teacherId, isActive: true } } },
      ],
    },
    select: {
      id: true,
      name: true,
      level: true,
      homeroomTeacherId: true,
      unit: { select: { id: true, name: true } },
      academicYear: { select: { id: true, name: true } },
    },
    orderBy: { name: 'asc' },
  });

  const listed: AttendanceRecorderClass[] = classes
    .map(({ homeroomTeacherId, ...cls }) => ({
      ...cls,
      as: homeroomTeacherId === teacherId ? ('HOMEROOM' as const) : ('TEACHER' as const),
    }))
    // Their own class first: the register a wali kelas takes every morning.
    .sort((a, b) => Number(b.as === 'HOMEROOM') - Number(a.as === 'HOMEROOM'));

  return { scope: 'ASSIGNED', unitId: actor.unitId, classes: listed };
}
