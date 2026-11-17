import { prisma } from '@/lib/prisma';
import { ApiError, ErrorCode, Errors } from '@/middleware/error';
import {
  ADMIN_ROLE_CODES,
  PRINCIPAL_ROLE_CODES,
  type HomeroomAccess,
  type HomeroomViewer,
} from '@cipansor/shared';

/**
 * Who reaches a class's homeroom data (decided 2026-09-26): its wali kelas
 * (`Class.homeroomTeacherId`), who also writes while the class's academic
 * year is the current one; the kepala sekolah and its admin unit,
 * and the super admin, who read. Nobody else — another teacher of the same
 * unit included — receives it: 404, as for a class that does not exist.
 */

/** A 404 in the caller's language — `Errors.notFound` appends " not found". */
export const notFound = (message: string) => new ApiError(ErrorCode.NOT_FOUND, message);

export interface HomeroomActor {
  sub: string;
  roleCode?: string | null;
  unitId: string | null;
}

export interface ClassAccess {
  classId: string;
  unitId: string;
  access: HomeroomAccess;
  /** Today falls inside the class's academic year. */
  current: boolean;
}

/** Today inside an academic year's dates — not `isActive` (lessons/stale-temporal-data). */
export const currentYearWhere = (now: Date = new Date()) => ({
  startDate: { lte: now },
  endDate: { gte: now },
});

const isCurrent = (year: { startDate: Date; endDate: Date }, now: Date = new Date()) =>
  year.startDate <= now && year.endDate >= now;

const CLASS_FOR_ACCESS = {
  id: true,
  unitId: true,
  homeroomTeacherId: true,
  academicYear: { select: { startDate: true, endDate: true } },
} as const;

type ClassForAccess = {
  id: string;
  unitId: string;
  homeroomTeacherId: string | null;
  academicYear: { startDate: Date; endDate: Date };
};

async function standing(cls: ClassForAccess, actor: HomeroomActor): Promise<ClassAccess | null> {
  const base = { classId: cls.id, unitId: cls.unitId, current: isCurrent(cls.academicYear) };

  if (cls.homeroomTeacherId) {
    const teacher = await prisma.teacher.findFirst({
      where: { id: cls.homeroomTeacherId, userId: actor.sub, deletedAt: null },
      select: { id: true },
    });
    if (teacher) return { ...base, access: 'HOMEROOM' };
  }

  const code = actor.roleCode ?? '';
  if (code === 'SUPER_ADMIN') return { ...base, access: 'OVERSEER' };
  const overseesUnit = PRINCIPAL_ROLE_CODES.includes(code) || ADMIN_ROLE_CODES.includes(code);
  if (overseesUnit && actor.unitId === cls.unitId) return { ...base, access: 'OVERSEER' };

  return null;
}

/** How the caller stands towards a class; 404 when they do not reach it. */
export async function classAccess(classId: string, actor: HomeroomActor): Promise<ClassAccess> {
  const cls = await prisma.class.findFirst({
    where: { id: classId, deletedAt: null },
    select: CLASS_FOR_ACCESS,
  });
  const access = cls ? await standing(cls, actor) : null;
  if (!access) throw notFound('Kelas tidak ditemukan');
  return access;
}

/**
 * How the caller stands towards a pupil, through the pupil's class: the one
 * of the current academic year, else the latest they are enrolled in. A pupil
 * in no class is read by the overseers of their unit only.
 */
export async function studentAccess(
  studentId: string,
  actor: HomeroomActor
): Promise<ClassAccess | { classId: null; unitId: string; access: 'OVERSEER'; current: false }> {
  const student = await prisma.student.findFirst({
    where: { id: studentId, deletedAt: null },
    select: {
      unitId: true,
      enrollments: {
        where: { status: 'active', class: { deletedAt: null } },
        select: { class: { select: CLASS_FOR_ACCESS } },
        orderBy: { class: { academicYear: { startDate: 'desc' } } },
      },
    },
  });
  if (!student) throw notFound('Siswa tidak ditemukan');

  const classes = student.enrollments.map((e) => e.class);
  const cls = classes.find((c) => isCurrent(c.academicYear)) ?? classes[0];
  if (cls) {
    const access = await standing(cls, actor);
    if (access) return access;
  } else {
    const code = actor.roleCode ?? '';
    const overseesUnit = PRINCIPAL_ROLE_CODES.includes(code) || ADMIN_ROLE_CODES.includes(code);
    if (code === 'SUPER_ADMIN' || (overseesUnit && actor.unitId === student.unitId)) {
      return { classId: null, unitId: student.unitId, access: 'OVERSEER', current: false };
    }
  }
  throw notFound('Siswa tidak ditemukan');
}

export const viewerOf = (access: { access: HomeroomAccess; current: boolean }): HomeroomViewer => ({
  access: access.access,
  canWrite: access.access === 'HOMEROOM' && access.current,
});

/** Notes are written by the class's wali kelas, in the current academic year. */
export function assertMayWrite(access: { access: HomeroomAccess; current: boolean }) {
  if (!viewerOf(access).canWrite) {
    throw Errors.forbidden('Catatan ditulis oleh wali kelas kelas ini, pada tahun ajaran berjalan');
  }
}
