import { prisma } from '../../lib/prisma';
import {
  Prisma,
  LeaveStatus,
  StaffAttendanceStatus,
  LeaveType,
  UserRole,
  User,
} from '@prisma/client';
import {
  CreateStaffAttendanceInput,
  UpdateStaffAttendanceInput,
  BulkAttendanceInput,
  CreateLeaveInput,
  UpdateLeaveInput,
  ApproveLeaveInput,
  CreateEmployeeInput,
  UpdateEmployeeInput,
} from './hr.schema';
import { randomBytes } from 'crypto';
import { hashPassword } from '../../lib/password';
import { assertPasswordAllowed } from '../../lib/password-policy';
import { ApiError, ErrorCode, Errors } from '../../middleware/error';
import {
  actorReachesUnit,
  isFoundationScopedRole,
  writeUnitScopeFor,
  type UnitActor,
} from '../../utils/resolve-unit-id';
import {
  ADMIN_ROLE_CODES,
  MIN_ATTENDANCE_RECORD_RETENTION_DAYS,
  PARENT_ROLE_CODES,
  STUDENT_ROLE_CODES,
  TATA_USAHA_ROLE_CODES,
} from '@cipansor/shared';
import {
  dayOf,
  dayString,
  todayWib,
  wibMinutesOfDay,
  wibTimeOnDay,
  wibWeekday,
} from '../../utils/wib';
import {
  holidaysInRange,
  isHolidayDay,
  isNonWorkingDay as sharedIsNonWorkingDay,
  workWeekFor,
} from '../../utils/work-calendar';
import {
  attendancePhotoRefusal,
  deleteAttendancePhoto,
  isAcceptedAttendancePhoto,
  listAttendancePhotos,
  looksLikeImage,
  readAttendancePhoto,
  storeAttendancePhoto,
  ATTENDANCE_PHOTO_ORPHAN_GRACE_MS,
  MAX_ATTENDANCE_PHOTO_BYTES,
} from '../../utils/attendance-photo-store';

/** The verified token, reduced to what decides an employee's reach. */
export interface HrActor extends UnitActor {
  sub: string;
}

/**
 * The unit an employee list may be narrowed to, decided from the token.
 *
 * The `unitId` query string is a *narrowing* request, not a scope grant: a
 * foundation role may name any unit (or none, for the whole yayasan), and
 * everyone else is pinned to their own whatever the query says. Before this, an
 * HR admin could read another unit's roster by adding `?unitId=` — the finding
 * at `hr.routes.ts:683`.
 */
function employeeListUnit(actor: HrActor, asked?: string): string | undefined {
  // A foundation role oversees every unit and belongs to none. When it asks for
  // no particular unit it gets the whole yayasan — its own token `unitId`, if it
  // happens to carry one, must not narrow the roster back to a single unit
  // (which is what `asked || actor.unitId` did, hiding every other unit from a
  // board account that was assigned one).
  if (isFoundationScopedRole(actor.roleCode)) return asked || undefined;
  if (!actor.unitId) throw Errors.forbidden('Akun ini tidak terikat pada unit mana pun');
  return actor.unitId;
}

/**
 * The directory half of a teacher's or staff member's record: who they are and
 * what they do, as a colleague may see it. A teacher's personal columns — NIK,
 * KK, address, place and date of birth, bank account — are for whoever keeps
 * the HR record: the employee, the unit's admin and Tata Usaha (who keep
 * kepegawaian and the Dapodik/EMIS PTK data) and the foundation board.
 * Decided by the owner on 2026-10-10 (UU 27/2022 Pasal 16 ayat 2: processing
 * limited to its purpose).
 */
const TEACHER_DIRECTORY_SELECT = {
  id: true,
  userId: true,
  unitId: true,
  nip: true,
  nuptk: true,
  specialization: true,
  departmentId: true,
  employmentStatus: true,
  joinDate: true,
} as const;

const STAFF_DIRECTORY_SELECT = {
  id: true,
  userId: true,
  unitId: true,
  nip: true,
  position: true,
  department: true,
  departmentId: true,
  joinDate: true,
} as const;

/** Whether `actor` keeps HR records — and so may read a colleague's in full. */
function keepsHrRecords(actor: HrActor): boolean {
  const code = actor.roleCode ?? '';
  return (
    isFoundationScopedRole(code) ||
    ADMIN_ROLE_CODES.includes(code) ||
    TATA_USAHA_ROLE_CODES.includes(code)
  );
}

/**
 * An employee's HR record beyond the directory — contracts, documents,
 * employment history, leave balances — is read by the employee and by whoever
 * keeps HR records for the employee's unit (decisions/akses-data-pegawai.md).
 * Anyone else gets 404, so a colleague's id or another unit's says nothing.
 */
export async function assertMayReadEmployeeRecord(actor: HrActor, userId: string): Promise<void> {
  if (userId === actor.sub) return;
  if (keepsHrRecords(actor)) {
    const employee = await prisma.user.findUnique({
      where: { id: userId },
      select: { unitId: true },
    });
    if (employee && actorReachesUnit(actor, employee.unitId)) return;
  }
  throw Errors.notFound('Employee not found');
}

/** Roles whose own HR record is all they may read — never a colleague's. */
const SELF_ONLY_EMPLOYEE_ROLES: readonly string[] = [...STUDENT_ROLE_CODES, ...PARENT_ROLE_CODES];

// =====================================
// EMPLOYEE SERVICE (UNIFIED TEACHER & STAFF)
// =====================================

/**
 * Columns safe to return to a client. `prisma.user.findMany` without a select
 * returns every scalar — including `passwordHash`, `twoFactorSecret` and
 * `resetTokenHash` — and the HR roster/detail endpoints are read by any teacher
 * or admin, so the credential material must never leave the server.
 */
const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  role: true,
  unitId: true,
  isActive: true,
  isTwoFactorEnabled: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
} satisfies Prisma.UserSelect;

export type SafeUser = Prisma.UserGetPayload<{ select: typeof SAFE_USER_SELECT }>;

export async function getEmployees(
  params: {
    page: number;
    limit: number;
    unitId?: string;
    role?: 'TEACHER' | 'STAFF';
    search?: string;
  },
  actor: HrActor
) {
  const { page, limit, unitId, role, search } = params;
  const skip = (page - 1) * limit;
  // A student or parent who reaches this list sees only their own record; staff
  // and admins see their unit (the foundation board, every unit).
  if (SELF_ONLY_EMPLOYEE_ROLES.includes(actor.roleCode ?? '')) {
    return getSelfEmployee(actor, page, limit, role, search);
  }
  const scopedUnit = employeeListUnit(actor, unitId);

  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    role: role ? (role as UserRole) : { in: [UserRole.TEACHER, UserRole.STAFF] },
  };

  if (scopedUnit) where.unitId = scopedUnit;

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { teacher: { nip: { contains: search, mode: 'insensitive' } } },
      { staff: { nip: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        ...SAFE_USER_SELECT,
        unit: { select: { id: true, name: true } },
        teacher: { select: TEACHER_DIRECTORY_SELECT },
        staff: { select: STAFF_DIRECTORY_SELECT },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

/** A student's or parent's own row, as a one-item page. */
async function getSelfEmployee(
  actor: HrActor,
  page: number,
  limit: number,
  role: 'TEACHER' | 'STAFF' | undefined,
  search?: string
) {
  const where: Prisma.UserWhereInput = {
    id: actor.sub,
    deletedAt: null,
    ...(role ? { role: role as UserRole } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const data = await prisma.user.findMany({
    where,
    select: {
      ...SAFE_USER_SELECT,
      unit: { select: { id: true, name: true } },
      teacher: true,
      staff: true,
    },
  });
  // The caller's own record, so in full.
  return { data, meta: { page, limit, total: data.length, totalPages: 1 } };
}

/**
 * List teachers (Teacher records with user + unit info).
 * Backs the web `useTeachers` hook (homeroom/e-office/dormitory pickers).
 */
export async function getTeachers(params: {
  page: number;
  limit: number;
  unitId?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'ON_LEAVE';
  search?: string;
}) {
  const { page, limit, unitId, status, search } = params;
  const skip = (page - 1) * limit;

  const where: Prisma.TeacherWhereInput = { deletedAt: null };
  if (unitId) where.unitId = unitId;
  if (status === 'ACTIVE') where.user = { isActive: true, deletedAt: null };
  else if (status === 'INACTIVE') where.user = { isActive: false };
  if (search) {
    where.user = {
      ...((where.user as Prisma.UserWhereInput) ?? {}),
      name: { contains: search, mode: 'insensitive' },
    };
  }

  const [teachers, total] = await Promise.all([
    prisma.teacher.findMany({
      where,
      skip,
      take: limit,
      orderBy: { user: { name: 'asc' } },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, isActive: true } },
        unit: { select: { id: true, name: true } },
      },
    }),
    prisma.teacher.count({ where }),
  ]);

  return {
    data: teachers.map((teacher) => ({
      ...teacher,
      status: teacher.user.isActive ? ('ACTIVE' as const) : ('INACTIVE' as const),
    })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getEmployeeById(id: string, actor: HrActor) {
  // A student or parent may read only their own record, and then only if they
  // hold one — a colleague's id answers 404, not their profile.
  if (SELF_ONLY_EMPLOYEE_ROLES.includes(actor.roleCode ?? '') && id !== actor.sub) {
    throw Errors.notFound('Employee not found');
  }
  // In full for the employee and for whoever keeps HR records; the directory
  // columns for everyone else (the unit check below still applies to both).
  const full = id === actor.sub || keepsHrRecords(actor);
  const employee = await prisma.user.findUnique({
    where: { id },
    select: {
      ...SAFE_USER_SELECT,
      unit: { select: { id: true, name: true } },
      teacher: full ? true : { select: TEACHER_DIRECTORY_SELECT },
      staff: full ? true : { select: STAFF_DIRECTORY_SELECT },
    },
  });
  if (!employee) throw Errors.notFound('Employee not found');
  // 404 rather than 403 for another unit's employee, so an id guessed from
  // another unit says nothing about that unit.
  if (!actorReachesUnit(actor, employee.unitId)) {
    throw Errors.notFound('Employee not found');
  }
  return employee;
}

/**
 * Calculate Retention Risk for employees in a unit.
 * Best Practice: Early warning system for talent turnover.
 */
export async function getRetentionRiskAnalytics(unitId?: string) {
  const employees = await prisma.user.findMany({
    where: {
      // Omitted for a super admin aggregating the whole yayasan.
      ...(unitId ? { unitId } : {}),
      role: { in: [UserRole.TEACHER, UserRole.STAFF] },
      deletedAt: null,
      isActive: true,
    },
    include: {
      teacher: {
        include: {
          leaves: {
            where: {
              status: LeaveStatus.APPROVED,
              startDate: { gte: new Date(new Date().getFullYear(), 0, 1) },
            },
          },
        },
      },
      staff: {
        include: {
          leaves: {
            where: {
              status: LeaveStatus.APPROVED,
              startDate: { gte: new Date(new Date().getFullYear(), 0, 1) },
            },
          },
        },
      },
      talentProfile: {
        include: {
          assessments: { orderBy: { assessedAt: 'desc' }, take: 1 },
        },
      },
      trainingEnrollments: { where: { status: 'COMPLETED' } },
    },
  });

  return employees
    .map((emp) => {
      let riskScore = 0;
      const riskFactors = [];

      // 1. Performance Factor
      const latestAssessment = emp.talentProfile?.assessments[0];
      if (latestAssessment) {
        if (
          latestAssessment.performanceRating === 'BELOW' ||
          latestAssessment.performanceRating === 'UNSATISFACTORY'
        ) {
          riskScore += 40;
          riskFactors.push('Performa Rendah');
        }
      }

      // 2. Leave Pattern Factor (High unplanned leaves).
      // Leaves are recorded against the Teacher/Staff profile, not the User.
      const empLeaves = [...(emp.teacher?.leaves ?? []), ...(emp.staff?.leaves ?? [])];
      const totalLeaveDays = empLeaves.reduce((sum, l) => sum + l.totalDays, 0);
      if (totalLeaveDays > 15) {
        riskScore += 20;
        riskFactors.push('Absensi Tinggi');
      }

      // 3. Training/Development Factor (Low engagement)
      if (emp.trainingEnrollments.length === 0) {
        riskScore += 15;
        riskFactors.push('Kurang Pengembangan Diri');
      }

      // 4. Tenure Factor (Stagnation - simplified)
      const joinDate = emp.teacher?.joinDate || emp.staff?.joinDate;
      if (joinDate) {
        const years =
          (new Date().getTime() - new Date(joinDate).getTime()) / (1000 * 60 * 60 * 24 * 365);
        if (years > 5 && (!emp.talentProfile || emp.talentProfile.category === 'SOLID_PERFORMER')) {
          riskScore += 15;
          riskFactors.push('Stagnasi Karir Potensial');
        }
      }

      let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'LOW';
      if (riskScore >= 60) riskLevel = 'HIGH';
      else if (riskScore >= 30) riskLevel = 'MEDIUM';

      return {
        userId: emp.id,
        name: emp.name,
        role: emp.role,
        riskScore,
        riskLevel,
        factors: riskFactors,
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore);
}

export async function createEmployee(data: CreateEmployeeInput, actor: HrActor) {
  // The body's `unitId` is a request, not a grant: a unit admin can only ever
  // create an employee in their own unit, whatever the body says.
  const unitId = writeUnitScopeFor(actor, data.unitId);

  // Validate unique email
  const existingUser = await prisma.user.findUnique({ where: { email: data.email } });
  if (existingUser) {
    throw Errors.badRequest('Email already exists');
  }

  // No default password: a known one (it used to be 'password123') opens every
  // account created without one. A password given here follows the policy; with
  // none, a random one is set and the person gets a reset link from an admin.
  if (data.password) {
    assertPasswordAllowed(data.password, {
      twoFactorEnabled: false,
      email: data.email,
      name: data.name,
    });
  }
  const passwordHash = await hashPassword(data.password || randomBytes(24).toString('base64url'));

  return prisma.$transaction(async (tx) => {
    // 1. Create User
    const user = await tx.user.create({
      data: {
        name: data.name,
        email: data.email,
        passwordHash,
        // Someone else chose it: replaced at the first sign-in (also the
        // column default, stated here so the rule is read where it applies).
        mustChangePassword: true,
        role: data.role as UserRole,
        unitId,
        phone: data.phone,
      },
      // Never the credential columns: this row is what the API answers with.
      select: SAFE_USER_SELECT,
    });

    // 2. Create Profile based on Role
    if (data.role === 'TEACHER') {
      // A teacher needs a Staff row too: attendance, leave and payroll all key
      // on Staff, and without one the person is told "Profil pegawai" and can
      // neither clock in nor file leave. One Staff row per person, linked back.
      const staff = await tx.staff.create({
        data: {
          userId: user.id,
          unitId,
          nip: data.nip,
          position: data.specialization || 'Guru',
          joinDate: data.joinDate ? new Date(data.joinDate) : undefined,
          employmentStatus: data.employmentStatus,
        },
      });
      await tx.teacher.create({
        data: {
          userId: user.id,
          unitId,
          staffId: staff.id,
          nip: data.nip,
          nuptk: data.nuptk,
          gender: data.gender,
          birthPlace: data.birthPlace,
          birthDate: data.birthDate ? new Date(data.birthDate) : undefined,
          address: data.address,
          nik: data.nik,
          noKK: data.noKK,
          religion: data.religion || 'ISLAM',
          joinDate: data.joinDate ? new Date(data.joinDate) : undefined,
          employmentStatus: data.employmentStatus,
          specialization: data.specialization,
          certificationNumber: data.certificationNumber,
        },
      });
    } else {
      // STAFF
      if (!data.position) throw Errors.badRequest('Position is required for Staff');

      await tx.staff.create({
        data: {
          userId: user.id,
          unitId,
          nip: data.nip,
          position: data.position,
          department: data.department,
          joinDate: data.joinDate ? new Date(data.joinDate) : undefined,
        },
      });
    }

    return user;
  });
}

export async function updateEmployee(id: string, data: UpdateEmployeeInput, actor: HrActor) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: { teacher: true, staff: true },
  });

  if (!user) throw Errors.notFound('Employee not found');
  // The target must be in the caller's reach, and any unit it is moved to must
  // be too — a unit admin cannot edit another unit's employee, nor transfer one
  // into a unit they do not administer.
  if (!actorReachesUnit(actor, user.unitId)) throw Errors.notFound('Employee not found');
  const nextUnitId = data.unitId
    ? writeUnitScopeFor(actor, data.unitId)
    : (user.unitId ?? undefined);

  return prisma.$transaction(async (tx) => {
    // 1. Update User
    const updatedUser = await tx.user.update({
      where: { id },
      data: {
        name: data.name,
        email: data.email,
        unitId: nextUnitId,
        phone: data.phone,
        isActive: data.isActive,
      },
      // Never the credential columns: this row is what the API answers with.
      select: SAFE_USER_SELECT,
    });

    // 2. Update Profile
    if (user.role === 'TEACHER' && user.teacher) {
      await tx.teacher.update({
        where: { id: user.teacher.id },
        data: {
          nip: data.nip,
          nuptk: data.nuptk,
          gender: data.gender,
          birthPlace: data.birthPlace,
          birthDate: data.birthDate ? new Date(data.birthDate) : undefined,
          address: data.address,
          nik: data.nik,
          noKK: data.noKK,
          religion: data.religion,
          joinDate: data.joinDate ? new Date(data.joinDate) : undefined,
          employmentStatus: data.employmentStatus,
          specialization: data.specialization,
          certificationNumber: data.certificationNumber,
          unitId: nextUnitId, // Update unit if user moved
        },
      });
    } else if (user.role === 'STAFF' && user.staff) {
      await tx.staff.update({
        where: { id: user.staff.id },
        data: {
          nip: data.nip,
          position: data.position,
          department: data.department,
          joinDate: data.joinDate ? new Date(data.joinDate) : undefined,
          unitId: nextUnitId,
        },
      });
    }

    return updatedUser;
  });
}

export async function deleteEmployee(id: string, actor: HrActor) {
  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true, unitId: true },
  });
  if (!existing) throw Errors.notFound('Employee not found');
  if (!actorReachesUnit(actor, existing.unitId)) throw Errors.notFound('Employee not found');

  // Soft delete user and related profile
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        isActive: false,
        email: `deleted_${id}_${Date.now()}@example.com`, // Free up email
      },
      include: { teacher: true, staff: true },
    });

    if (user.teacher) {
      await tx.teacher.update({
        where: { id: user.teacher.id },
        data: { deletedAt: new Date(), nip: null, nuptk: null },
      });
    }

    if (user.staff) {
      await tx.staff.update({
        where: { id: user.staff.id },
        data: { deletedAt: new Date(), nip: null },
      });
    }

    return user;
  });
}

// =====================================
// STAFF ATTENDANCE SERVICE
// =====================================

export async function getStaffAttendance(params: {
  page: number;
  limit: number;
  staffId?: string;
  unitId?: string;
  status?: StaffAttendanceStatus;
  startDate?: string;
  endDate?: string;
}) {
  const { page, limit, staffId, unitId, status, startDate, endDate } = params;
  const skip = (page - 1) * limit;

  const where: Prisma.StaffAttendanceWhereInput = {};

  if (staffId) where.staffId = staffId;
  if (unitId) where.staff = { unitId };
  if (status) where.status = status;

  if (startDate || endDate) {
    where.date = {};
    if (startDate) where.date.gte = new Date(startDate);
    if (endDate) where.date.lte = new Date(endDate);
  }

  const [data, total] = await Promise.all([
    prisma.staffAttendance.findMany({
      where,
      skip,
      take: limit,
      orderBy: { date: 'desc' },
      include: {
        shift: { select: { id: true, name: true, startTime: true, endTime: true } },
        records: {
          select: {
            id: true,
            kind: true,
            photoRef: true,
            photoSource: true,
            latitude: true,
            longitude: true,
            accuracyMeters: true,
            distanceMeters: true,
            isWithinRadius: true,
            capturedAt: true,
          },
        },
        staff: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            unit: { select: { id: true, name: true } },
          },
        },
      },
    }),
    prisma.staffAttendance.count({ where }),
  ]);

  return {
    data: data.map((row) => ({ ...row, records: row.records.map(evidenceView) })),
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getStaffAttendanceById(id: string) {
  const row = await prisma.staffAttendance.findUnique({
    where: { id },
    include: {
      shift: true,
      records: { include: { site: true } },
      staff: {
        include: {
          user: { select: { id: true, name: true, email: true } },
          unit: { select: { id: true, name: true } },
        },
      },
    },
  });
  return row ? { ...row, records: row.records.map(evidenceView) } : null;
}

/**
 * Resolve the one Staff identity behind a staffId or a legacy teacherId. The
 * attendance table keys on staffId; a teacher's Staff row is linked from
 * Teacher.staffId. Throws when a teacher has no Staff row yet, rather than
 * silently writing nothing.
 */
export async function resolveStaffId(
  input: {
    staffId?: string;
    teacherId?: string;
  },
  // Pass the transaction client when the caller is already inside one, so the
  // lookup reads the same snapshot as the write it feeds.
  client: Pick<typeof prisma, 'teacher'> = prisma
): Promise<string> {
  if (input.staffId) return input.staffId;
  if (input.teacherId) {
    const teacher = await client.teacher.findUnique({
      where: { id: input.teacherId },
      select: { staffId: true },
    });
    if (teacher?.staffId) return teacher.staffId;
    throw Errors.badRequest('Guru belum memiliki data pegawai (Staff)');
  }
  throw Errors.badRequest('staffId atau teacherId wajib diisi');
}

/** The caller's own Staff row, reached directly or through their Teacher row. */
export async function findStaffIdForUser(userId: string): Promise<string | null> {
  const [staff, teacher] = await Promise.all([
    prisma.staff.findUnique({ where: { userId }, select: { id: true } }),
    prisma.teacher.findUnique({ where: { userId }, select: { staffId: true } }),
  ]);
  return staff?.id ?? teacher?.staffId ?? null;
}

export async function resolveStaffIdForUser(userId: string): Promise<string> {
  const staffId = await findStaffIdForUser(userId);
  if (staffId) return staffId;
  throw new ApiError(ErrorCode.NOT_FOUND, NO_STAFF_PROFILE_MESSAGE);
}

/**
 * The answer an employee gets when their account has no staff record. Every
 * guru has one (the migration made it from the teacher row); other employees
 * get theirs from the unit admin, so the message says whom to ask.
 */
export const NO_STAFF_PROFILE_MESSAGE =
  'Data kepegawaian Anda belum dibuat, jadi absen belum bisa dicatat. Minta admin unit menambahkannya.';

/**
 * Resolve a staff id named by an administrator. Only a super admin or a unit
 * admin may name someone else, and a unit admin is confined to their unit.
 */
export async function resolveDelegatedStaffId(
  user: { roleCode?: string | null; role?: string | null; unitId?: string | null },
  requested: string
): Promise<string> {
  if (!isUnitAdminUser(user) && !isSuperAdminUser(user)) {
    throw Errors.forbidden('Hanya admin unit yang dapat mengabsen pegawai lain');
  }
  const staff = await prisma.staff.findUnique({
    where: { id: requested },
    select: { id: true, unitId: true },
  });
  if (!staff) throw Errors.notFound('Staff');
  assertWithinScope(scopedUnitId(user, null), staff.unitId, 'Pegawai');
  return staff.id;
}

/**
 * Refuse a write on another person's HR record unless the caller administers
 * them. Without this any signed-in staff member could edit a colleague's
 * attendance or leave by naming their id.
 */
export async function assertMayManageStaff(
  user: { sub?: string; roleCode?: string | null; role?: string | null; unitId?: string | null },
  staffId: string
): Promise<void> {
  if (isSuperAdminUser(user)) return;
  if (!isUnitAdminUser(user)) {
    throw Errors.forbidden('Hanya admin yang dapat mengelola data pegawai lain');
  }
  if (!user.unitId) throw Errors.forbidden('Akun admin belum terhubung ke unit');
  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    select: { unitId: true },
  });
  if (!staff) throw Errors.notFound('Staff');
  if (staff.unitId !== user.unitId) {
    throw Errors.forbidden('Pegawai berada di luar unit Anda');
  }
}

/** The Staff identity a leave is filed for, reached through either id. */
export async function leaveStaffId(input: {
  staffId?: string | null;
  teacherId?: string | null;
}): Promise<string> {
  return resolveStaffId({
    staffId: input.staffId ?? undefined,
    teacherId: input.teacherId ?? undefined,
  });
}

/**
 * Refuse a leave write on a record the caller neither owns nor administers.
 * Admins are confined to their unit; everyone else to their own leave.
 */
export async function assertMayManageLeave(
  user: { sub: string; roleCode?: string | null; role?: string | null; unitId?: string | null },
  leave: { staffId: string | null; teacherId: string | null }
): Promise<void> {
  const target = await leaveStaffId(leave);
  if (isSuperAdminUser(user) || isUnitAdminUser(user)) {
    await assertMayManageStaff(user, target);
    return;
  }
  const own = await resolveStaffIdForUser(user.sub);
  if (target !== own) {
    throw Errors.forbidden('Anda hanya dapat mengelola cuti milik sendiri');
  }
}

/** The shift columns lateness is judged against. */
export interface WorkShiftRow {
  id: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  crossesMidnight: boolean;
}

/**
 * Minutes late on the WIB clock, 0 when on time. `policyGraceMinutes` overrides
 * the shift's own grace when the unit policy sets one.
 *
 * A shift that crosses midnight still starts at its start time on the evening
 * the shift begins, so lateness is measured as elapsed minutes since that
 * instant — the WIB minute-of-day comparison is wrong across midnight. Without
 * the shift's start day (`day`) the function cannot place the start, and it
 * falls back to not judging lateness rather than judging it wrongly.
 */
export function computeLateMinutes(
  checkIn: Date,
  shift: WorkShiftRow | null | undefined,
  policyGraceMinutes?: number | null,
  day?: string
): number | undefined {
  if (!shift) return undefined;
  const grace = policyGraceMinutes ?? shift.graceMinutes;
  if (shift.crossesMidnight) {
    if (!day) return 0;
    const start = wibTimeOnDay(day, shift.startTime).getTime();
    const diff = Math.floor((checkIn.getTime() - start) / 60_000) - grace;
    return Math.max(0, diff);
  }
  const [h, m] = shift.startTime.split(':').map(Number);
  const diff = wibMinutesOfDay(checkIn) - (h * 60 + m) - grace;
  return Math.max(0, diff);
}

/**
 * The shift that governs a staff member on a WIB day: a fixed assignment whose
 * day-of-week list covers the day wins; otherwise the active rotation the
 * person is a member of, by turn position. Null when nothing is configured.
 */
export async function resolveShiftForDate(staffId: string, day: string) {
  const date = dayOf(day);
  const dow = wibWeekday(day);
  const assignment = await prisma.shiftAssignment.findFirst({
    where: {
      staffId,
      effectiveFrom: { lte: date },
      AND: [
        { OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
        { OR: [{ daysOfWeek: { isEmpty: true } }, { daysOfWeek: { has: dow } }] },
      ],
    },
    include: { shift: true },
    orderBy: { effectiveFrom: 'desc' },
  });
  if (assignment) return assignment.shift;

  const rotation = await prisma.shiftRotation.findFirst({
    where: {
      isActive: true,
      memberIds: { has: staffId },
      startDate: { lte: date },
      OR: [{ endDate: null }, { endDate: { gte: date } }],
    },
    include: { shift: true },
    orderBy: { startDate: 'desc' },
  });
  if (!rotation || rotation.memberIds.length === 0) return null;

  const dayIndex = Math.floor((date.getTime() - new Date(rotation.startDate).getTime()) / 86400000);
  const turn = Math.floor(dayIndex / rotation.cycleDays) % rotation.memberIds.length;
  if (rotation.memberIds[turn] !== staffId) return null;
  return rotation.shift;
}

/** The role codes a staff member's user holds, for role-based exemptions. */
async function roleCodesOf(userId: string): Promise<string[]> {
  const assignments = await prisma.userRoleAssignment.findMany({
    where: { userId, isActive: true },
    select: { role: { select: { code: true } } },
  });
  return assignments.map((a) => a.role.code);
}

export async function createStaffAttendance(
  data: CreateStaffAttendanceInput,
  recordedById?: string
) {
  const staffId = await resolveStaffId(data);
  const date = dayOf(dayString(new Date(data.date)));

  const shift = await resolveShiftForDate(staffId, dayString(date));
  const lateMinutes =
    data.checkIn && shift
      ? computeLateMinutes(new Date(data.checkIn), shift, undefined, dayString(date))
      : undefined;

  return prisma.staffAttendance.create({
    data: {
      staffId,
      date,
      status: data.status,
      shiftId: shift?.id,
      checkIn: data.checkIn ? new Date(data.checkIn) : undefined,
      checkOut: data.checkOut ? new Date(data.checkOut) : undefined,
      lateMinutes,
      notes: data.notes,
      recordedById,
    },
  });
}

export async function updateStaffAttendance(
  id: string,
  data: UpdateStaffAttendanceInput,
  actorId?: string
) {
  const before = await prisma.staffAttendance.findUnique({ where: { id } });
  if (!before) throw Errors.notFound('Absensi');
  const updated = await prisma.staffAttendance.update({
    where: { id },
    data: {
      status: data.status,
      checkIn: data.checkIn ? new Date(data.checkIn) : undefined,
      checkOut: data.checkOut ? new Date(data.checkOut) : undefined,
      notes: data.notes,
    },
  });
  await prisma.auditLog.create({
    data: {
      userId: actorId ?? null,
      action: 'UPDATE',
      entity: 'StaffAttendance',
      entityId: id,
      oldValues: {
        status: before.status,
        checkIn: before.checkIn?.toISOString() ?? null,
        checkOut: before.checkOut?.toISOString() ?? null,
        notes: before.notes,
      },
      newValues: {
        status: updated.status,
        checkIn: updated.checkIn?.toISOString() ?? null,
        checkOut: updated.checkOut?.toISOString() ?? null,
        notes: updated.notes,
        reason: data.reason,
      },
    },
  });
  return updated;
}

export async function recordBulkAttendance(data: BulkAttendanceInput, recordedById?: string) {
  // The day the admin picked is a WIB calendar day, stored as UTC midnight.
  const date = dayOf(dayString(new Date(data.date)));

  // Resolve every row to its Staff identity up front, so the transaction below
  // cannot fail halfway through a list of teachers that lack Staff rows.
  const rows = await Promise.all(
    data.records.map(async (record) => ({
      staffId: await resolveStaffId(record),
      record,
    }))
  );

  const results = await prisma.$transaction(
    rows.map(({ staffId, record }) => {
      const checkIn = record.checkIn ? new Date(record.checkIn) : undefined;
      return prisma.staffAttendance.upsert({
        where: { staffId_date: { staffId, date } },
        update: {
          status: record.status,
          checkIn,
          checkOut: record.checkOut ? new Date(record.checkOut) : undefined,
          notes: record.notes,
          recordedById,
        },
        create: {
          staffId,
          date,
          status: record.status,
          checkIn,
          checkOut: record.checkOut ? new Date(record.checkOut) : undefined,
          notes: record.notes,
          recordedById,
        },
      });
    })
  );

  return { count: results.length, records: results };
}

export async function getStaffAttendanceSummary(
  staffId: string,
  month: number,
  year: number,
  scopeUnitId?: string
) {
  // A unit admin may only read the summary of their own unit's staff.
  if (scopeUnitId) {
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      select: { unitId: true },
    });
    if (!staff || staff.unitId !== scopeUnitId) {
      throw Errors.forbidden('Pegawai berada di luar unit Anda');
    }
  }

  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  const records = await prisma.staffAttendance.findMany({
    where: {
      staffId,
      date: { gte: startDate, lte: endDate },
    },
  });

  const summary = records.reduce(
    (acc, record) => {
      acc[record.status] = (acc[record.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  return {
    staffId,
    month,
    year,
    totalDays: endDate.getDate(),
    recordedDays: records.length,
    summary,
  };
}

export async function deleteStaffAttendance(id: string, reason?: string, actorId?: string) {
  const before = await prisma.staffAttendance.findUnique({ where: { id } });
  if (!before) throw Errors.notFound('Absensi');
  const deleted = await prisma.staffAttendance.delete({ where: { id } });
  await prisma.auditLog.create({
    data: {
      userId: actorId ?? null,
      action: 'DELETE',
      entity: 'StaffAttendance',
      entityId: id,
      oldValues: {
        staffId: before.staffId,
        date: before.date.toISOString(),
        status: before.status,
        checkIn: before.checkIn?.toISOString() ?? null,
        checkOut: before.checkOut?.toISOString() ?? null,
      },
      newValues: { reason: reason ?? null },
    },
  });
  return deleted;
}

// =====================================
// WORK CALENDAR & POLICY SERVICE
// =====================================

/** Distance between two points in metres (haversine). */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

/** The active policy for a unit, falling back to the yayasan-wide default. */
export async function getAttendancePolicy(unitId?: string | null) {
  if (unitId) {
    const own = await prisma.attendancePolicy.findFirst({
      where: { unitId, isActive: true },
    });
    if (own) return own;
  }
  return prisma.attendancePolicy.findFirst({ where: { unitId: null, isActive: true } });
}

/** The work-week for a unit, falling back to the default. */
export async function getWorkWeekConfig(unitId?: string | null) {
  if (unitId) {
    const own = await prisma.workWeekConfig.findFirst({
      where: { unitId, isActive: true },
    });
    if (own) return own;
  }
  return prisma.workWeekConfig.findFirst({ where: { unitId: null, isActive: true } });
}

/**
 * Whether a staff member is exempt from clocking in. Kyai/pimpinan and kepala
 * sekolah are exempt because their role or their person is listed; the check is
 * data-driven so the list is a setting, not a hardcoded name.
 */
export async function isExemptFromAttendance(
  staffId: string,
  roleCodes: string[]
): Promise<boolean> {
  const exemption = await prisma.attendanceExemption.findFirst({
    where: {
      isActive: true,
      OR: [{ staffId }, ...(roleCodes.length ? [{ roleCode: { in: roleCodes } }] : [])],
    },
  });
  return Boolean(exemption);
}

/**
 * Is a date a non-working day for a unit? A whole-unit holiday (a CalendarEvent
 * of type HOLIDAY scoped to the unit or all units) or a day outside the unit's
 * configured work week. This is the single answer the attendance jobs use, so a
 * holiday is defined once.
 */
export async function isNonWorkingDay(day: string, unitId?: string | null): Promise<boolean> {
  return sharedIsNonWorkingDay(day, unitId ?? null);
}

/** The work calendar for a month: each day and whether it is a work day. */
export async function getWorkCalendar(month: number, year: number, unitId?: string | null) {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const monthStart = dayOf(`${year}-${String(month).padStart(2, '0')}-01`);
  const monthEnd = new Date(monthStart.getTime() + daysInMonth * 86_400_000 - 1);
  const week = await workWeekFor(unitId ?? null);
  const holidays = await holidaysInRange(monthStart, monthEnd, unitId ?? null);

  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
    const holiday = isHolidayDay(day, holidays);
    const inWorkWeek = week.workDays.length === 0 || week.workDays.includes(wibWeekday(day));
    return {
      date: day,
      isWorkDay: inWorkWeek && !holiday,
      isHoliday: holiday,
    };
  });
}

// =====================================
// SELF CHECK-IN / CHECK-OUT
// =====================================

export interface SelfAttendanceInput {
  staffId: string;
  /** Who pressed the button — the employee, or an admin punching for them. */
  actorUserId: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  photoRef?: string;
  photoSource?: 'CAMERA' | 'FILE';
  deviceInfo?: string;
}

type PolicyRow = Awaited<ReturnType<typeof getAttendancePolicy>>;

/**
 * What a punch must carry, as this service enforces it. No policy row means
 * nothing is required (decided 2026-10-09: selfie and location stay off until
 * an admin switches them on), and `configured: false` lets the page and the
 * settings say so instead of leaving it to be discovered.
 */
export function attendanceRequirements(policy: PolicyRow) {
  return {
    configured: Boolean(policy),
    requireSelfie: policy?.requireSelfie ?? false,
    requireLocation: policy?.requireLocation ?? false,
    outsideRadiusAction: (policy?.outsideRadiusAction === 'REJECT' ? 'REJECT' : 'FLAG') as
      'FLAG' | 'REJECT',
    photoRetentionDays: policy?.photoRetentionDays ?? 365,
  };
}

/**
 * Refuse a punch that lacks what the policy requires, or whose photo is not a
 * fresh, unused one taken by the person pressing the button. Without the
 * ownership and age checks a "required selfie" was any string — yesterday's
 * upload, or a colleague's.
 */
async function assertPunchEvidence(
  input: SelfAttendanceInput,
  policy: PolicyRow,
  what: 'masuk' | 'pulang'
) {
  const required = attendanceRequirements(policy);
  if (required.requireSelfie && !input.photoRef) {
    throw Errors.badRequest(`Swafoto wajib diambil untuk absen ${what}`);
  }
  if (required.requireLocation && (input.latitude === undefined || input.longitude === undefined)) {
    throw Errors.badRequest(`Lokasi wajib dibaca untuk absen ${what}`);
  }
  if (input.photoRef) {
    const refusal = await attendancePhotoRefusal(input.photoRef, input.actorUserId);
    if (refusal) throw Errors.badRequest(refusal);
    const used = await prisma.attendanceRecord.findFirst({
      where: { photoRef: input.photoRef },
      select: { id: true },
    });
    if (used) throw Errors.badRequest('Foto ini sudah dipakai untuk absen lain; ambil foto lagi');
  }
}

/**
 * Inside or outside the nearest site. `certainlyOutside` subtracts the
 * reported GPS accuracy first, so REJECT refuses only a position that is
 * outside however the error falls; a phone indoors with ±80 m is flagged,
 * not turned away. A browser cannot tell a faked position from a real one, so
 * the flag is a prompt for review, never proof.
 */
function radiusVerdict(match: Awaited<ReturnType<typeof nearestSite>>, accuracyMeters?: number) {
  if (!match) return { withinRadius: null, certainlyOutside: false };
  const withinRadius = match.distanceMeters <= match.site.radiusMeters;
  const margin = Math.max(0, accuracyMeters ?? 0);
  return {
    withinRadius,
    certainlyOutside: match.distanceMeters - margin > match.site.radiusMeters,
  };
}

/**
 * The nearest active site for a unit (or yayasan-wide) and the distance to it.
 * Null coordinates means location was not supplied.
 */
async function nearestSite(lat?: number, lon?: number, unitId?: string | null) {
  if (lat === undefined || lon === undefined) return null;
  const sites = await prisma.attendanceSite.findMany({
    where: { isActive: true, OR: [{ unitId: null }, ...(unitId ? [{ unitId }] : [])] },
  });
  if (!sites.length) return null;
  let best = sites[0];
  let bestDistance = haversineMeters(lat, lon, best.latitude, best.longitude);
  for (const site of sites.slice(1)) {
    const d = haversineMeters(lat, lon, site.latitude, site.longitude);
    if (d < bestDistance) {
      best = site;
      bestDistance = d;
    }
  }
  return { site: best, distanceMeters: bestDistance };
}

/**
 * Advisory-lock namespace for staff-attendance writes. A per-staff key
 * (`hashtext(staffId)`) serializes one person's punches; the two-argument form
 * keeps this namespace separate from other modules' advisory locks. The lock
 * is released when the enclosing transaction commits or rolls back.
 */
const ATTENDANCE_LOCK_NAMESPACE = 1002;

/** Hold the staff member's attendance lock for the rest of the transaction. */
async function lockStaffAttendance(tx: Prisma.TransactionClient, staffId: string) {
  // $executeRaw, not $queryRaw: the lock function returns `void`, which
  // $queryRaw cannot deserialize — every punch failed with a 500.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ATTENDANCE_LOCK_NAMESPACE}::int, hashtext(${staffId})::int)`;
}

/** The evidence row for a punch; check-in and check-out share its shape. */
function attendanceEvidence(
  attendanceId: string,
  kind: 'CHECK_IN' | 'CHECK_OUT',
  input: SelfAttendanceInput,
  match: Awaited<ReturnType<typeof nearestSite>>,
  withinRadius: boolean | null
) {
  return {
    attendanceId,
    kind,
    photoRef: input.photoRef,
    photoSource: input.photoRef ? (input.photoSource ?? 'CAMERA') : null,
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMeters: input.accuracyMeters,
    siteId: match?.site.id,
    distanceMeters: match?.distanceMeters,
    isWithinRadius: withinRadius,
    deviceInfo: input.deviceInfo,
  };
}

export async function selfCheckIn(input: SelfAttendanceInput) {
  const staff = await prisma.staff.findUnique({
    where: { id: input.staffId },
    select: { unitId: true, user: { select: { id: true } } },
  });
  if (!staff) throw new ApiError(ErrorCode.NOT_FOUND, NO_STAFF_PROFILE_MESSAGE);

  // A person exempt from clocking in is refused rather than recorded, so the
  // register never shows a punch for someone the policy says is not on it.
  const roleCodes = await roleCodesOf(staff.user.id);
  if (await isExemptFromAttendance(input.staffId, roleCodes)) {
    throw Errors.badRequest('Anda dikecualikan dari absensi harian');
  }

  const day = todayWib();
  // A shift on the roster makes the day a working day for that person even
  // when the unit is closed: the guard and the nurse work Sundays and national
  // holidays, and were turned away before their shift was ever looked at.
  const shift = await resolveShiftForDate(input.staffId, day);
  if (!shift && (await isNonWorkingDay(day, staff.unitId))) {
    throw Errors.badRequest('Hari ini bukan hari kerja');
  }

  const policy = await getAttendancePolicy(staff.unitId);
  await assertPunchEvidence(input, policy, 'masuk');

  const now = new Date();
  const date = dayOf(day);

  const match = await nearestSite(input.latitude, input.longitude, staff.unitId);
  const { withinRadius, certainlyOutside } = radiusVerdict(match, input.accuracyMeters);
  if (policy?.outsideRadiusAction === 'REJECT' && certainlyOutside) {
    throw Errors.badRequest('Anda berada di luar lokasi absen yang diizinkan');
  }

  const lateMinutes = shift ? computeLateMinutes(now, shift, policy?.graceMinutes, day) : undefined;
  const status =
    lateMinutes && lateMinutes > 0 ? StaffAttendanceStatus.LATE : StaffAttendanceStatus.PRESENT;

  // The day row and its evidence are one write: if the evidence fails, the
  // punch must not remain recorded without it (a retry would otherwise be
  // refused as "already checked in", stranding the row). The staff member's
  // lock serializes concurrent punches, and "already checked in" is re-read
  // inside it so two requests cannot both see an empty day and both write.
  const { attendance, record } = await prisma.$transaction(async (tx) => {
    await lockStaffAttendance(tx, input.staffId);

    const existing = await tx.staffAttendance.findUnique({
      where: { staffId_date: { staffId: input.staffId, date } },
      select: { id: true, checkIn: true },
    });
    if (existing?.checkIn) {
      throw Errors.badRequest('Anda sudah absen masuk hari ini');
    }

    const attendance = await tx.staffAttendance.upsert({
      where: { staffId_date: { staffId: input.staffId, date } },
      update: { checkIn: now, shiftId: shift?.id, status, lateMinutes },
      create: {
        staffId: input.staffId,
        date,
        status,
        shiftId: shift?.id,
        checkIn: now,
        lateMinutes,
      },
    });

    const record = await tx.attendanceRecord.create({
      data: attendanceEvidence(attendance.id, 'CHECK_IN', input, match, withinRadius),
    });
    return { attendance, record };
  });

  return { attendance, record: evidenceView(record), lateMinutes: lateMinutes ?? 0, withinRadius };
}

/**
 * The row a checkout should attach to: today's open check-in, or — for a shift
 * that crosses midnight — the previous day's row that is still open. Attendance
 * rows key on the check-in day, so a 22:00–06:00 shift's checkout belongs to
 * yesterday's row; looking only at today left such a shift unable to close.
 *
 * Takes the transaction client so the lookup and the write that follows it are
 * guarded by the same staff lock.
 */
async function findOpenCheckInRow(
  staffId: string,
  today: string,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  const include = { records: { where: { kind: 'CHECK_OUT' }, select: { id: true } } } as const;
  const current = await client.staffAttendance.findUnique({
    where: { staffId_date: { staffId, date: dayOf(today) } },
    include,
  });
  if (current?.checkIn && !current.checkOut) return current;

  const yesterday = dayString(new Date(dayOf(today).getTime() - 86_400_000));
  const previous = await client.staffAttendance.findUnique({
    where: { staffId_date: { staffId, date: dayOf(yesterday) } },
    include: { ...include, shift: true },
  });
  if (previous?.checkIn && !previous.checkOut && previous.shift?.crossesMidnight) {
    return previous;
  }
  return current;
}

export async function selfCheckOut(input: SelfAttendanceInput) {
  const staff = await prisma.staff.findUnique({
    where: { id: input.staffId },
    select: { unitId: true },
  });
  if (!staff) throw new ApiError(ErrorCode.NOT_FOUND, NO_STAFF_PROFILE_MESSAGE);

  const policy = await getAttendancePolicy(staff.unitId);
  await assertPunchEvidence(input, policy, 'pulang');

  const now = new Date();
  const day = todayWib();

  const match = await nearestSite(input.latitude, input.longitude, staff.unitId);
  const { withinRadius, certainlyOutside } = radiusVerdict(match, input.accuracyMeters);
  // REJECT holds for leaving as it does for arriving; before, a checkout from
  // anywhere was recorded under a policy that refused the same check-in.
  if (policy?.outsideRadiusAction === 'REJECT' && certainlyOutside) {
    throw Errors.badRequest('Anda berada di luar lokasi absen yang diizinkan');
  }

  // The checkout time and its evidence are one write, for the same reason as
  // the check-in. The open row is found inside the staff lock so a concurrent
  // check-in cannot slip in between the read and the close.
  const { attendance, record } = await prisma.$transaction(async (tx) => {
    await lockStaffAttendance(tx, input.staffId);

    const existing = await findOpenCheckInRow(input.staffId, day, tx);
    if (!existing?.checkIn) throw Errors.badRequest('Belum ada absen masuk hari ini');
    if (existing.checkOut) throw Errors.badRequest('Anda sudah absen keluar hari ini');

    const attendance = await tx.staffAttendance.update({
      where: { id: existing.id },
      data: { checkOut: now },
    });

    const record = await tx.attendanceRecord.create({
      data: attendanceEvidence(attendance.id, 'CHECK_OUT', input, match, withinRadius),
    });
    return { attendance, record };
  });

  return { attendance, record: evidenceView(record), withinRadius };
}

/**
 * Keep a selfie the caller just took and return its reference for the punch.
 * Taken by the person pressing the button — the employee, or the admin
 * punching for them — and usable once, within ten minutes.
 */
export async function storePunchPhoto(
  userId: string,
  file: { buffer: Buffer; mimetype: string; size: number }
) {
  if (!isAcceptedAttendancePhoto(file.mimetype) || !looksLikeImage(file.buffer, file.mimetype)) {
    throw Errors.badRequest('Foto absen harus berupa gambar JPEG, PNG, atau WebP');
  }
  if (file.size > MAX_ATTENDANCE_PHOTO_BYTES) {
    throw Errors.badRequest('Foto absen paling besar 5 MB');
  }
  return { photoRef: await storeAttendancePhoto(userId, file.buffer, file.mimetype) };
}

/**
 * A punch's selfie, for the person in it, the admin of their unit, or the
 * super admin — and every read is recorded. The photo is a facial image (UU PDP
 * Ps. 4); who looked at it is something the yayasan must be able to answer.
 */
export async function readPunchPhoto(
  recordId: string,
  user: { sub: string; roleCode?: string | null; role?: string | null; unitId?: string | null }
) {
  const record = await prisma.attendanceRecord.findUnique({
    where: { id: recordId },
    select: {
      photoRef: true,
      attendance: { select: { staff: { select: { unitId: true, userId: true } } } },
    },
  });
  if (!record?.photoRef) throw new ApiError(ErrorCode.NOT_FOUND, 'Foto absen tidak ditemukan');
  const staff = record.attendance.staff;
  if (staff.userId !== user.sub) {
    assertWithinScope(scopedUnitId(user, null), staff.unitId, 'Foto absen');
  }
  const photo = await readAttendancePhoto(record.photoRef);
  await prisma.auditLog.create({
    data: { userId: user.sub, action: 'READ', entity: 'AttendancePhoto', entityId: recordId },
  });
  return photo;
}

/** The caller's own attendance for a WIB day, with the evidence rows. */
/**
 * An evidence row as a list shows it: whether a photo exists and where it came
 * from, never the stored reference — the photo is fetched one at a time from
 * the endpoint that checks the reader.
 */
export function evidenceView<T extends { photoRef?: string | null }>(record: T) {
  const { photoRef, ...rest } = record;
  return { ...rest, hasPhoto: Boolean(photoRef) };
}

/** The answer for an account with no staff record: nothing can be punched yet. */
export function noStaffProfileToday(day: string) {
  return {
    hasProfile: false,
    requirements: attendanceRequirements(null),
    date: day,
    attendance: null,
    shift: null,
    isWorkDay: false,
    isExempt: false,
    openAttendance: null,
    canCheckIn: false,
    canCheckOut: false,
  };
}

export async function getMyAttendance(staffId: string, day: string) {
  const staff = await prisma.staff.findUnique({
    where: { id: staffId },
    select: { unitId: true, user: { select: { id: true } } },
  });
  if (!staff) return noStaffProfileToday(day);

  const roleCodes = staff.user ? await roleCodesOf(staff.user.id) : [];
  const [attendance, exempt, shift, nonWorkingDay, policy] = await Promise.all([
    prisma.staffAttendance.findUnique({
      where: { staffId_date: { staffId, date: dayOf(day) } },
      include: { records: true, shift: true },
    }),
    isExemptFromAttendance(staffId, roleCodes),
    resolveShiftForDate(staffId, day),
    isNonWorkingDay(day, staff.unitId),
    getAttendancePolicy(staff.unitId),
  ]);
  // Same rule as the check-in: a rostered shift makes it a working day.
  const isWorkDay = Boolean(shift) || !nonWorkingDay;

  // An overnight shift checked in yesterday stays open into today; surface that
  // row so the checkout button is available after midnight.
  const openPrevious = await findOpenCheckInRow(staffId, day);
  const overnight = openPrevious && openPrevious.id !== attendance?.id ? openPrevious : null;

  return {
    hasProfile: true,
    requirements: attendanceRequirements(policy),
    date: day,
    attendance: attendance
      ? { ...attendance, records: attendance.records.map(evidenceView) }
      : null,
    shift,
    isWorkDay,
    isExempt: exempt,
    /** A still-open previous-day row, for a shift that crosses midnight. */
    openAttendance: overnight,
    canCheckIn: !exempt && isWorkDay && !attendance?.checkIn,
    canCheckOut: !exempt && (!!overnight || (!!attendance?.checkIn && !attendance?.checkOut)),
  };
}

// =====================================
// ATTENDANCE SETTINGS SERVICE
// =====================================

/**
 * The unit an admin may act on. A unit admin is pinned to their own unit; the
 * super admin may name any (or none, meaning yayasan-wide); anyone else is
 * refused (`assertHrAdmin`). Prefers `roleCode` because the deprecated `role`
 * bucket maps yayasan governance roles (Pembina/Ketua/Bendahara/Pengawas) to
 * `UNIT_ADMIN`.
 */
export function scopedUnitId(
  user: { roleCode?: string | null; role?: string | null; unitId?: string | null },
  requested?: string | null
): string | null {
  assertHrAdmin(user);
  if (isUnitAdminUser(user)) {
    if (!user.unitId) throw Errors.forbidden('Akun admin belum terhubung ke unit');
    // Naming another unit is a refusal, not a silent rewrite: an admin who
    // meant to change SD IT and changed their own unit would never know.
    if (requested && requested !== user.unitId) {
      throw Errors.forbidden('Unit itu berada di luar unit Anda');
    }
    return user.unitId;
  }
  return requested ?? null;
}

/**
 * Staff attendance and its settings are run by the super admin and a unit's
 * admin — the two the menu shows them to. The yayasan's organs share the
 * `UNIT_ADMIN` bucket with unit admins, so `authorize()` lets them through; the
 * role code is what tells them apart. Before this they fell into the super
 * admin's branch and could rewrite any unit's policy and the payroll guard.
 */
export function assertHrAdmin(user: { roleCode?: string | null; role?: string | null }): void {
  if (isSuperAdminUser(user) || isUnitAdminUser(user)) return;
  throw Errors.forbidden('Hanya super admin dan admin unit yang mengelola absensi pegawai');
}

export function isSuperAdminUser(user: {
  roleCode?: string | null;
  role?: string | null;
}): boolean {
  return user.roleCode === 'SUPER_ADMIN' || (!user.roleCode && user.role === 'SUPER_ADMIN');
}

export function isUnitAdminUser(user: { roleCode?: string | null; role?: string | null }): boolean {
  if (isSuperAdminUser(user)) return false;
  if (user.roleCode) return ADMIN_ROLE_CODES.includes(user.roleCode);
  return user.role === 'UNIT_ADMIN';
}

/**
 * Refuse a write on a row outside the caller's unit, or on a yayasan-wide row
 * (`unitId` null) that only the super admin may change. Reads may include the
 * yayasan default; writes may not reach it.
 */
function assertWithinScope(
  scopeUnitId: string | null | undefined,
  ownerUnitId: string | null | undefined,
  what: string
) {
  if (!scopeUnitId) return;
  if (ownerUnitId === null || ownerUnitId === undefined) {
    throw Errors.forbidden(`${what} berlaku yayasan; hanya super admin dapat mengubahnya`);
  }
  if (ownerUnitId !== scopeUnitId) {
    throw Errors.forbidden(`${what} berada di luar unit Anda`);
  }
}

/**
 * Refuse a scoped write whose payload would move the row to another unit. The
 * ownership check reads the row's *current* unit, so without this a unit admin
 * could pass the check and then persist `unitId` = someone else's — the row
 * leaves their unit under their own hand. The scope is authoritative: the unit
 * is pinned to it, and a different `unitId` in the body is a refusal.
 */
function assertNoUnitMove(
  scopeUnitId: string | null | undefined,
  incomingUnitId: unknown,
  what: string
): void {
  if (!scopeUnitId) return;
  if (incomingUnitId !== undefined && incomingUnitId !== null && incomingUnitId !== scopeUnitId) {
    throw Errors.forbidden(`${what} tidak dapat dipindah ke unit lain`);
  }
}

export async function listAttendanceSites(unitId?: string | null) {
  return prisma.attendanceSite.findMany({
    where: unitId ? { OR: [{ unitId }, { unitId: null }] } : {},
    orderBy: { label: 'asc' },
  });
}

export async function createAttendanceSite(
  data: Prisma.AttendanceSiteUncheckedCreateInput,
  scopeUnitId?: string | null
) {
  if (scopeUnitId) data = { ...data, unitId: scopeUnitId };
  return prisma.attendanceSite.create({ data });
}

export async function updateAttendanceSite(
  id: string,
  data: Prisma.AttendanceSiteUncheckedUpdateInput,
  scopeUnitId?: string | null
) {
  const site = await prisma.attendanceSite.findUnique({
    where: { id },
    select: { unitId: true },
  });
  if (!site) throw Errors.notFound('Lokasi absen');
  assertWithinScope(scopeUnitId, site.unitId, 'Lokasi absen');
  assertNoUnitMove(scopeUnitId, data.unitId, 'Lokasi absen');
  const update = scopeUnitId ? { ...data, unitId: scopeUnitId } : data;
  return prisma.attendanceSite.update({ where: { id }, data: update });
}

export async function deleteAttendanceSite(id: string, scopeUnitId?: string | null) {
  const site = await prisma.attendanceSite.findUnique({
    where: { id },
    select: { unitId: true },
  });
  if (!site) throw Errors.notFound('Lokasi absen');
  assertWithinScope(scopeUnitId, site.unitId, 'Lokasi absen');
  return prisma.attendanceSite.delete({ where: { id } });
}

export async function listWorkShifts(unitId?: string | null) {
  return prisma.workShift.findMany({
    where: unitId ? { OR: [{ unitId }, { unitId: null }] } : {},
    orderBy: { name: 'asc' },
  });
}

export async function createWorkShift(
  data: Prisma.WorkShiftUncheckedCreateInput,
  scopeUnitId?: string | null
) {
  if (scopeUnitId) data = { ...data, unitId: scopeUnitId };
  return prisma.workShift.create({ data });
}

export async function updateWorkShift(
  id: string,
  data: Prisma.WorkShiftUncheckedUpdateInput,
  scopeUnitId?: string | null
) {
  const shift = await prisma.workShift.findUnique({
    where: { id },
    select: { unitId: true },
  });
  if (!shift) throw Errors.notFound('Shift');
  assertWithinScope(scopeUnitId, shift.unitId, 'Shift');
  assertNoUnitMove(scopeUnitId, data.unitId, 'Shift');
  const update = scopeUnitId ? { ...data, unitId: scopeUnitId } : data;
  return prisma.workShift.update({ where: { id }, data: update });
}

export async function deleteWorkShift(id: string, scopeUnitId?: string | null) {
  const shift = await prisma.workShift.findUnique({
    where: { id },
    select: { unitId: true },
  });
  if (!shift) throw Errors.notFound('Shift');
  assertWithinScope(scopeUnitId, shift.unitId, 'Shift');
  return prisma.workShift.delete({ where: { id } });
}

export async function listShiftAssignments(staffId?: string, unitId?: string | null) {
  return prisma.shiftAssignment.findMany({
    where: {
      ...(staffId ? { staffId } : {}),
      ...(unitId ? { staff: { unitId } } : {}),
    },
    include: {
      shift: true,
      staff: { include: { user: { select: { name: true } } } },
    },
    orderBy: { effectiveFrom: 'desc' },
  });
}

export async function createShiftAssignment(
  data: {
    staffId: string;
    shiftId: string;
    effectiveFrom: string;
    effectiveTo?: string;
    daysOfWeek: number[];
  },
  scopeUnitId?: string | null
) {
  const [staff, shift] = await Promise.all([
    prisma.staff.findUnique({ where: { id: data.staffId }, select: { unitId: true } }),
    prisma.workShift.findUnique({ where: { id: data.shiftId }, select: { unitId: true } }),
  ]);
  if (!staff) throw Errors.notFound('Staff');
  if (!shift) throw Errors.notFound('Shift');
  assertWithinScope(scopeUnitId, staff.unitId, 'Pegawai');
  assertWithinScope(scopeUnitId, shift.unitId, 'Shift');
  return prisma.shiftAssignment.create({
    data: {
      staffId: data.staffId,
      shiftId: data.shiftId,
      effectiveFrom: new Date(data.effectiveFrom),
      effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
      daysOfWeek: data.daysOfWeek,
    },
  });
}

export async function deleteShiftAssignment(id: string, scopeUnitId?: string | null) {
  const assignment = await prisma.shiftAssignment.findUnique({
    where: { id },
    select: { staff: { select: { unitId: true } } },
  });
  if (!assignment) throw Errors.notFound('Penugasan shift');
  assertWithinScope(scopeUnitId, assignment.staff.unitId, 'Penugasan shift');
  return prisma.shiftAssignment.delete({ where: { id } });
}

export async function listShiftRotations(unitId?: string | null) {
  return prisma.shiftRotation.findMany({
    where: unitId ? { shift: { OR: [{ unitId }, { unitId: null }] } } : {},
    include: { shift: true },
    orderBy: { startDate: 'desc' },
  });
}

export async function createShiftRotation(
  data: Prisma.ShiftRotationUncheckedCreateInput,
  scopeUnitId?: string | null
) {
  const shift = await prisma.workShift.findUnique({
    where: { id: data.shiftId },
    select: { unitId: true },
  });
  if (!shift) throw Errors.notFound('Shift');
  assertWithinScope(scopeUnitId, shift.unitId, 'Rotasi shift');
  return prisma.shiftRotation.create({ data });
}

export async function updateShiftRotation(
  id: string,
  data: Prisma.ShiftRotationUncheckedUpdateInput,
  scopeUnitId?: string | null
) {
  const rotation = await prisma.shiftRotation.findUnique({
    where: { id },
    select: { shift: { select: { unitId: true } } },
  });
  if (!rotation) throw Errors.notFound('Rotasi shift');
  assertWithinScope(scopeUnitId, rotation.shift.unitId, 'Rotasi shift');
  // A rotation is scoped by its shift, so a new `shiftId` must stay inside the
  // caller's unit too — otherwise the rotation is silently moved to another
  // unit's shift while the ownership check read the old one.
  if (data.shiftId !== undefined && data.shiftId !== null) {
    const target = await prisma.workShift.findUnique({
      where: { id: data.shiftId as string },
      select: { unitId: true },
    });
    if (!target) throw Errors.notFound('Shift');
    assertWithinScope(scopeUnitId, target.unitId, 'Shift');
  }
  return prisma.shiftRotation.update({ where: { id }, data });
}

export async function deleteShiftRotation(id: string, scopeUnitId?: string | null) {
  const rotation = await prisma.shiftRotation.findUnique({
    where: { id },
    select: { shift: { select: { unitId: true } } },
  });
  if (!rotation) throw Errors.notFound('Rotasi shift');
  assertWithinScope(scopeUnitId, rotation.shift.unitId, 'Rotasi shift');
  return prisma.shiftRotation.delete({ where: { id } });
}

export async function listWorkWeekConfigs(unitId?: string | null) {
  return prisma.workWeekConfig.findMany({
    where: unitId ? { OR: [{ unitId }, { unitId: null }] } : {},
    orderBy: { createdAt: 'asc' },
  });
}

export async function upsertWorkWeekConfig(
  data: Prisma.WorkWeekConfigUncheckedCreateInput,
  scopeUnitId?: string | null
) {
  const unitId = scopeUnitId ?? data.unitId ?? null;
  if (scopeUnitId && data.unitId && data.unitId !== scopeUnitId) {
    throw Errors.forbidden('Hari kerja berada di luar unit Anda');
  }
  const existing = await prisma.workWeekConfig.findFirst({
    where: { unitId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) {
    return prisma.workWeekConfig.update({ where: { id: existing.id }, data: { ...data, unitId } });
  }
  return prisma.workWeekConfig.create({ data: { ...data, unitId } });
}

export async function listAttendancePolicies(unitId?: string | null) {
  return prisma.attendancePolicy.findMany({
    where: unitId ? { OR: [{ unitId }, { unitId: null }] } : {},
    orderBy: { createdAt: 'asc' },
  });
}

export async function upsertAttendancePolicy(
  data: Prisma.AttendancePolicyUncheckedCreateInput,
  scopeUnitId?: string | null
) {
  const unitId = scopeUnitId ?? data.unitId ?? null;
  if (scopeUnitId && data.unitId && data.unitId !== scopeUnitId) {
    throw Errors.forbidden('Kebijakan absen berada di luar unit Anda');
  }
  const existing = await prisma.attendancePolicy.findFirst({
    where: { unitId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) {
    return prisma.attendancePolicy.update({
      where: { id: existing.id },
      data: { ...data, unitId },
    });
  }
  return prisma.attendancePolicy.create({ data: { ...data, unitId } });
}

export async function listAttendanceExemptions(scopeUnitId?: string | null) {
  if (!scopeUnitId) {
    return prisma.attendanceExemption.findMany({ orderBy: { createdAt: 'desc' } });
  }
  // Role-based exemptions (staffId null) are yayasan-wide and every unit admin
  // needs to see them; person-based ones are limited to their unit's staff.
  const staffIds = (
    await prisma.staff.findMany({ where: { unitId: scopeUnitId }, select: { id: true } })
  ).map((s) => s.id);
  return prisma.attendanceExemption.findMany({
    where: { OR: [{ staffId: null }, { staffId: { in: staffIds } }] },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createAttendanceExemption(
  data: Prisma.AttendanceExemptionUncheckedCreateInput,
  scopeUnitId?: string | null
) {
  if (data.staffId) {
    const staff = await prisma.staff.findUnique({
      where: { id: data.staffId },
      select: { unitId: true },
    });
    if (!staff) throw Errors.notFound('Staff');
    assertWithinScope(scopeUnitId, staff.unitId, 'Pengecualian pegawai');
  } else if (scopeUnitId) {
    throw Errors.forbidden('Pengecualian berbasis peran bersifat yayasan; hanya super admin');
  }
  return prisma.attendanceExemption.create({ data });
}

export async function deleteAttendanceExemption(id: string, scopeUnitId?: string | null) {
  const exemption = await prisma.attendanceExemption.findUnique({ where: { id } });
  if (!exemption) throw Errors.notFound('Pengecualian');
  if (exemption.staffId) {
    const staff = await prisma.staff.findUnique({
      where: { id: exemption.staffId },
      select: { unitId: true },
    });
    assertWithinScope(scopeUnitId, staff?.unitId, 'Pengecualian pegawai');
  } else {
    assertWithinScope(scopeUnitId, null, 'Pengecualian berbasis peran');
  }
  return prisma.attendanceExemption.delete({ where: { id } });
}

// =====================================
// PAYROLL POLICY SERVICE
// =====================================

export async function listPayrollPolicyRules(unitId?: string | null) {
  return prisma.payrollPolicyRule.findMany({
    where: unitId ? { OR: [{ unitId }, { unitId: null }] } : {},
    orderBy: [{ priority: 'asc' }, { code: 'asc' }],
  });
}

export async function upsertPayrollPolicyRule(
  id: string | null,
  data: Prisma.PayrollPolicyRuleUncheckedCreateInput,
  scopeUnitId?: string | null
) {
  if (scopeUnitId && (data.unitId ?? null) !== scopeUnitId) {
    throw Errors.forbidden('Aturan potongan berada di luar unit Anda');
  }
  if (id) {
    const rule = await prisma.payrollPolicyRule.findUnique({
      where: { id },
      select: { unitId: true },
    });
    if (!rule) throw Errors.notFound('Aturan potongan');
    assertWithinScope(scopeUnitId, rule.unitId, 'Aturan potongan');
    return prisma.payrollPolicyRule.update({ where: { id }, data });
  }
  const existing = await prisma.payrollPolicyRule.findFirst({
    where: { unitId: data.unitId ?? null, code: data.code },
  });
  if (existing) {
    return prisma.payrollPolicyRule.update({ where: { id: existing.id }, data });
  }
  return prisma.payrollPolicyRule.create({ data });
}

export async function deletePayrollPolicyRule(id: string, scopeUnitId?: string | null) {
  const rule = await prisma.payrollPolicyRule.findUnique({
    where: { id },
    select: { unitId: true },
  });
  if (!rule) throw Errors.notFound('Aturan potongan');
  assertWithinScope(scopeUnitId, rule.unitId, 'Aturan potongan');
  return prisma.payrollPolicyRule.delete({ where: { id } });
}

export async function getPayrollGuardConfig(unitId?: string | null) {
  if (unitId) {
    const own = await prisma.payrollGuardConfig.findFirst({
      where: { unitId, isActive: true },
    });
    if (own) return own;
  }
  return prisma.payrollGuardConfig.findFirst({ where: { unitId: null, isActive: true } });
}

export async function upsertPayrollGuardConfig(
  data: Prisma.PayrollGuardConfigUncheckedCreateInput,
  scopeUnitId?: string | null
) {
  const unitId = scopeUnitId ?? data.unitId ?? null;
  if (scopeUnitId && data.unitId && data.unitId !== scopeUnitId) {
    throw Errors.forbidden('Batas potongan berada di luar unit Anda');
  }
  const existing = await prisma.payrollGuardConfig.findFirst({
    where: { unitId, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) {
    return prisma.payrollGuardConfig.update({
      where: { id: existing.id },
      data: { ...data, unitId },
    });
  }
  return prisma.payrollGuardConfig.create({ data: { ...data, unitId } });
}

// =====================================
// RETENTION SERVICE
// =====================================

export async function listRetentionPolicies() {
  return prisma.retentionPolicy.findMany({ orderBy: { dataType: 'asc' } });
}

export async function upsertRetentionPolicy(data: Prisma.RetentionPolicyUncheckedCreateInput) {
  return prisma.retentionPolicy.upsert({
    where: { dataType: data.dataType },
    update: data,
    create: data,
  });
}

/**
 * Enforce the attendance retention window. PDP (UU 27/2022 Ps. 42) requires
 * processing to end when the retention period is reached, and a setting with no
 * job behind it is not a policy — selfies were kept forever.
 *
 * The window comes from the unit's `AttendancePolicy` (`photoRetentionDays`,
 * `recordRetentionDays`), falling back to the global `RetentionPolicy` row
 * (`ATTENDANCE_PHOTO` / `ATTENDANCE_RECORD`) and then to the 1-year photo /
 * 10-year record defaults; records are never kept less than ten years. Photos
 * are deleted from the private store before their references are cleared, so
 * clearing a reference cannot leave the bytes behind with nothing left to
 * identify them by.
 *
 * A row still linked to an active approved leave is kept even past its record
 * window: `cancelLeave` restores it (and its balance) on cancellation, and a
 * purged row would leave that cancellation with nothing to restore. The row is
 * removed once the leave is no longer APPROVED.
 */
export async function enforceAttendanceRetention(now = new Date()) {
  const [policies, retention, units] = await Promise.all([
    prisma.attendancePolicy.findMany({ where: { isActive: true } }),
    prisma.retentionPolicy.findMany({ where: { isActive: true } }),
    prisma.unit.findMany({ select: { id: true } }),
  ]);
  const globalPhotoDays =
    retention.find((r) => r.dataType === 'ATTENDANCE_PHOTO')?.retentionDays ?? 365;
  const globalRecordDays =
    retention.find((r) => r.dataType === 'ATTENDANCE_RECORD')?.retentionDays ?? 3650;

  let photosErased = 0;
  let recordsDeleted = 0;

  const photoDaysByUnit = new Map<string, number>();
  for (const unit of units) {
    const policy =
      policies.find((p) => p.unitId === unit.id) ?? policies.find((p) => p.unitId === null);
    photoDaysByUnit.set(unit.id, policy?.photoRetentionDays ?? globalPhotoDays);
  }

  // The due-scan runs per retention window, so a unit with a long window is not
  // revisited day after day before its deadline.
  const unitsByWindow = new Map<number, string[]>();
  for (const unit of units) {
    const days = photoDaysByUnit.get(unit.id) ?? globalPhotoDays;
    const list = unitsByWindow.get(days) ?? [];
    list.push(unit.id);
    unitsByWindow.set(days, list);
  }

  const duePhotos: { id: string; photoRef: string }[] = [];
  for (const [days, unitIds] of unitsByWindow) {
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const rows = await prisma.attendanceRecord.findMany({
      where: {
        photoRef: { not: null },
        capturedAt: { lt: cutoff },
        attendance: { staff: { unitId: { in: unitIds } } },
      },
      select: { id: true, photoRef: true },
    });
    for (const row of rows) {
      if (row.photoRef) duePhotos.push({ id: row.id, photoRef: row.photoRef });
    }
  }

  // Each photo belongs to exactly one punch (`photoRef` is unique), so an
  // expired row's file can go with it. The bytes go first and the reference
  // after, so a failed delete leaves the reference to retry by, not an
  // unnamed file.
  for (const photo of duePhotos) {
    await deleteAttendancePhoto(photo.photoRef);
    const cleared = await prisma.attendanceRecord.updateMany({
      where: { id: photo.id, photoRef: photo.photoRef },
      data: { photoRef: null },
    });
    photosErased += cleared.count;
  }

  // A photo taken but never used for a punch has no row to expire with it.
  // Sweep those once they are older than any punch could still be.
  const onDisk = await listAttendancePhotos();
  const stale = onDisk.filter(
    (f) => now.getTime() - f.modifiedAt.getTime() > ATTENDANCE_PHOTO_ORPHAN_GRACE_MS
  );
  if (stale.length > 0) {
    const referenced = new Set(
      (
        await prisma.attendanceRecord.findMany({
          where: { photoRef: { in: stale.map((f) => f.ref) } },
          select: { photoRef: true },
        })
      ).map((r) => r.photoRef)
    );
    for (const file of stale) {
      if (referenced.has(file.ref)) continue;
      await deleteAttendancePhoto(file.ref);
      photosErased += 1;
    }
  }

  for (const unit of units) {
    const policy =
      policies.find((p) => p.unitId === unit.id) ?? policies.find((p) => p.unitId === null);
    // Never below ten years, whatever a row says: these rows are what the
    // payslips were computed from (UU KUP Ps. 28(11)). The schema refuses a
    // shorter policy; this holds for rows written before it did, and for the
    // global RetentionPolicy row, which has no such floor of its own.
    const recordDays = Math.max(
      policy?.recordRetentionDays ?? globalRecordDays,
      MIN_ATTENDANCE_RECORD_RETENTION_DAYS
    );

    // Rows still carrying an active approved leave are kept: cancelling that
    // leave restores them, and a purged row would leave the cancellation with
    // nothing to restore. `leaveRequestId` is a plain column, not a relation,
    // so the protected ids are resolved first.
    const activeLeaveIds = (
      await prisma.leave.findMany({
        where: { status: LeaveStatus.APPROVED },
        select: { id: true },
      })
    ).map((l) => l.id);
    const deleted = await prisma.staffAttendance.deleteMany({
      where: {
        date: { lt: new Date(now.getTime() - recordDays * 86_400_000) },
        staff: { unitId: unit.id },
        OR: [{ leaveRequestId: null }, { leaveRequestId: { notIn: activeLeaveIds } }],
      },
    });
    recordsDeleted += deleted.count;
  }

  if (photosErased || recordsDeleted) {
    await prisma.auditLog.create({
      data: {
        userId: null,
        action: 'PURGE',
        entity: 'AttendanceRetention',
        newValues: { photosErased, recordsDeleted },
      },
    });
  }
  return { photosErased, recordsDeleted };
}

export async function listLeaveTypeConfigs() {
  return prisma.leaveTypeConfig.findMany({ orderBy: { leaveType: 'asc' } });
}

export async function upsertLeaveTypeConfig(data: Prisma.LeaveTypeConfigUncheckedCreateInput) {
  return prisma.leaveTypeConfig.upsert({
    where: { leaveType: data.leaveType },
    update: data,
    create: data,
  });
}

// =====================================
// LEAVE SERVICE
// =====================================

function calculateTotalDays(startDate: Date, endDate: Date): number {
  const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

export async function getLeaves(params: {
  page: number;
  limit: number;
  staffId?: string;
  teacherId?: string;
  unitId?: string;
  type?: LeaveType;
  status?: LeaveStatus;
  startDate?: string;
  endDate?: string;
}) {
  const { page, limit, staffId, teacherId, unitId, type, status, startDate, endDate } = params;
  const skip = (page - 1) * limit;

  const where: Prisma.LeaveWhereInput = {};
  const andConditions: Prisma.LeaveWhereInput[] = [];

  if (staffId) where.staffId = staffId;
  if (teacherId) where.teacherId = teacherId;

  if (unitId) {
    andConditions.push({
      OR: [{ staff: { unitId } }, { teacher: { unitId } }],
    });
  }

  if (type) where.type = type;
  if (status) where.status = status;

  if (startDate || endDate) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;

    // Use overlap logic: (LeaveStart <= FilterEnd) AND (LeaveEnd >= FilterStart)
    // If only startDate provided: LeaveEnd >= Start
    // If only endDate provided: LeaveStart <= End
    const dateCondition: Prisma.LeaveWhereInput = {};

    if (start) {
      dateCondition.endDate = { gte: start };
    }
    if (end) {
      dateCondition.startDate = { lte: end };
    }

    andConditions.push(dateCondition);
  }

  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  const [data, total] = await Promise.all([
    prisma.leave.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        staff: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            unit: { select: { id: true, name: true } },
          },
        },
        teacher: {
          include: {
            user: { select: { id: true, name: true, email: true } },
            unit: { select: { id: true, name: true } },
          },
        },
        approvedBy: { select: { id: true, name: true } },
      },
    }),
    prisma.leave.count({ where }),
  ]);

  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getLeaveById(id: string) {
  return prisma.leave.findUnique({
    where: { id },
    include: {
      staff: {
        include: {
          user: { select: { id: true, name: true, email: true } },
          unit: { select: { id: true, name: true } },
        },
      },
      teacher: {
        include: {
          user: { select: { id: true, name: true, email: true } },
          unit: { select: { id: true, name: true } },
        },
      },
      approvedBy: { select: { id: true, name: true } },
    },
  });
}

export async function createLeave(data: CreateLeaveInput) {
  const startDate = new Date(data.startDate);
  const endDate = new Date(data.endDate);
  const totalDays = calculateTotalDays(startDate, endDate);

  if (!data.staffId && !data.teacherId) {
    throw Errors.badRequest('Either staffId or teacherId must be provided');
  }

  return prisma.$transaction(async (tx) => {
    // Validate request (overlap, balance)
    await validateLeaveRequest(tx, {
      staffId: data.staffId,
      teacherId: data.teacherId,
      type: data.type,
      startDate,
      endDate,
      totalDays,
    });

    return tx.leave.create({
      data: {
        staffId: data.staffId,
        teacherId: data.teacherId,
        type: data.type,
        startDate,
        endDate,
        totalDays,
        reason: data.reason,
      },
    });
  });
}

// Helper for validation logic to be reused
async function validateLeaveRequest(
  tx: Prisma.TransactionClient,
  params: {
    staffId?: string;
    teacherId?: string;
    type?: LeaveType;
    startDate: Date;
    endDate: Date;
    totalDays: number;
    excludeLeaveId?: string; // For updates
  }
) {
  const { staffId, teacherId, type, startDate, endDate, totalDays, excludeLeaveId } = params;

  // 1. Check for overlapping leaves
  const overlapWhere: Prisma.LeaveWhereInput = {
    status: { in: [LeaveStatus.PENDING, LeaveStatus.APPROVED] },
    OR: [
      {
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
    ],
  };

  if (staffId) overlapWhere.staffId = staffId;
  if (teacherId) overlapWhere.teacherId = teacherId;
  if (excludeLeaveId) overlapWhere.id = { not: excludeLeaveId };

  const overlappingLeave = await tx.leave.findFirst({ where: overlapWhere });

  if (overlappingLeave) {
    throw Errors.badRequest('Leave request overlaps with an existing request');
  }

  // 2. Check Balance (for ANNUAL leave)
  if (type === LeaveType.ANNUAL) {
    let userId: string | undefined;
    if (staffId) {
      const staff = await tx.staff.findUnique({
        where: { id: staffId },
        select: { userId: true },
      });
      userId = staff?.userId;
    } else if (teacherId) {
      const teacher = await tx.teacher.findUnique({
        where: { id: teacherId },
        select: { userId: true },
      });
      userId = teacher?.userId;
    }

    if (userId) {
      // Find Academic Year covering the leave period
      const academicYear = await tx.academicYear.findFirst({
        where: {
          startDate: { lte: startDate },
          endDate: { gte: endDate },
        },
      });

      if (!academicYear) {
        throw Errors.badRequest('No active Academic Year found for the requested dates.');
      }

      // Helper to check for leaves overlapping with AY
      const getOverlappingLeaveQuery = (statusFilter: LeaveStatus): Prisma.LeaveWhereInput => ({
        type: LeaveType.ANNUAL,
        status: statusFilter,
        OR: [
          { startDate: { gte: academicYear.startDate, lte: academicYear.endDate } },
          { endDate: { gte: academicYear.startDate, lte: academicYear.endDate } },
          { startDate: { lte: academicYear.startDate }, endDate: { gte: academicYear.endDate } },
        ],
      });

      // Calculate pending days from other requests overlapping with AY
      const pendingWhere = getOverlappingLeaveQuery(LeaveStatus.PENDING);
      if (staffId) pendingWhere.staffId = staffId;
      else if (teacherId) pendingWhere.teacherId = teacherId;
      if (excludeLeaveId) pendingWhere.id = { not: excludeLeaveId };

      const pendingAgg = await tx.leave.aggregate({
        _sum: { totalDays: true },
        where: pendingWhere,
      });
      const pendingDays = pendingAgg._sum.totalDays || 0;

      // Check against Balance
      const balance = await tx.leaveBalance.findUnique({
        where: {
          userId_academicYearId_leaveType: {
            userId,
            academicYearId: academicYear.id,
            leaveType: LeaveType.ANNUAL,
          },
        },
      });

      if (balance) {
        const effectiveRemaining = balance.remainingDays - pendingDays;
        if (effectiveRemaining < totalDays) {
          throw Errors.badRequest(
            `Insufficient annual leave balance. Remaining: ${effectiveRemaining} days (including pending requests).`
          );
        }
      } else {
        // Fallback: Calculate used days (Approved + Pending) overlapping this AY
        const usedWhere = getOverlappingLeaveQuery(LeaveStatus.APPROVED);
        if (staffId) usedWhere.staffId = staffId;
        else if (teacherId) usedWhere.teacherId = teacherId;
        if (excludeLeaveId) usedWhere.id = { not: excludeLeaveId };

        const usedAgg = await tx.leave.aggregate({
          _sum: { totalDays: true },
          where: usedWhere,
        });

        const usedDays = usedAgg._sum.totalDays || 0;
        const totalUsedAndPending = usedDays + pendingDays;
        const remaining = 12 - totalUsedAndPending; // Default 12 days

        if (remaining < totalDays) {
          throw Errors.badRequest(
            `Insufficient annual leave balance. Remaining: ${remaining} days (including pending requests).`
          );
        }
      }
    }
  }
}

export async function updateLeave(id: string, data: UpdateLeaveInput) {
  return prisma.$transaction(async (tx) => {
    const leave = await tx.leave.findUnique({ where: { id } });
    if (!leave) throw Errors.notFound('Leave request not found');

    const updateData: Prisma.LeaveUpdateInput = {
      type: data.type,
      reason: data.reason,
    };

    let startDate = leave.startDate;
    let endDate = leave.endDate;
    let totalDays = leave.totalDays;
    let type = data.type || leave.type;

    // Recalculate dates if provided
    if (data.startDate || data.endDate) {
      startDate = data.startDate ? new Date(data.startDate) : leave.startDate;
      endDate = data.endDate ? new Date(data.endDate) : leave.endDate;
      totalDays = calculateTotalDays(startDate, endDate);

      updateData.startDate = startDate;
      updateData.endDate = endDate;
      updateData.totalDays = totalDays;
    }

    // Run validation if critical fields changed
    if (data.startDate || data.endDate || data.type) {
      await validateLeaveRequest(tx, {
        staffId: leave.staffId ?? undefined,
        teacherId: leave.teacherId ?? undefined,
        type: type as LeaveType,
        startDate,
        endDate,
        totalDays,
        excludeLeaveId: id,
      });
    }

    return tx.leave.update({ where: { id }, data: updateData });
  });
}

export async function approveLeave(id: string, approverId: string, data: ApproveLeaveInput) {
  const existing = await prisma.leave.findUnique({ where: { id } });
  if (!existing) throw Errors.notFound('Leave request not found');

  // Idempotent, and no silent state flip. Approving twice used to increment
  // usedDays twice and re-upsert attendance; rejecting an approved leave would
  // leave the balance spent with no way to tell. A decision on an already
  // approved leave is refused — cancel it first, which reverts the balance.
  if (existing.status === LeaveStatus.APPROVED) {
    if (data.status === LeaveStatus.APPROVED) {
      return prisma.leave.findUniqueOrThrow({
        where: { id },
        include: { staff: true, teacher: true },
      });
    }
    throw Errors.badRequest(
      'Cuti yang sudah disetujui tidak dapat diubah. Batalkan terlebih dahulu.'
    );
  }

  // A rejection changes only the row, but the move is guarded all the same: an
  // unconditional update racing an approval would overwrite APPROVED while the
  // balance and attendance the approval spent stay put — a rejected leave whose
  // days were debited, with nothing recording that. `updateMany` takes scalar
  // fields only, so the approver is written as `approvedById` here, not as
  // `approvedBy: { connect }` (which only `update` accepts).
  if (data.status !== LeaveStatus.APPROVED) {
    const rejectData: Prisma.LeaveUncheckedUpdateManyInput = {
      status: data.status,
      approvedById: approverId,
      approvedAt: new Date(),
      ...(data.rejectedNote ? { rejectedNote: data.rejectedNote } : {}),
    };

    // Rejection is the one move that may start from PENDING *or* from a leave
    // already REJECTED: re-rejecting is an idempotent no-op, as it always was.
    // The row is read again inside the transaction so the decision is taken on
    // the row this transaction will write, not on the guard's pre-transaction
    // snapshot — otherwise an approval committing in between still finds the
    // stale PENDING and is overwritten, and the status the guard read is not a
    // safe value to lock on (it would turn the idempotent no-op into a 409).
    return prisma.$transaction(async (tx) => {
      const current = await tx.leave.findUnique({
        where: { id },
        include: { staff: true, teacher: true },
      });
      if (!current) throw Errors.notFound('Leave request not found');

      if (current.status === LeaveStatus.REJECTED) {
        // Idempotent: a second rejection changes nothing and reports the row.
        return current;
      }
      if (current.status !== LeaveStatus.PENDING) {
        // Approved or cancelled while this request was in flight. That decision
        // stands; this one must not overwrite it.
        throw Errors.conflict(
          'Cuti ini sudah diputuskan oleh permintaan lain. Muat ulang halaman untuk melihat status terbarunya.'
        );
      }

      // Move PENDING → rejected, guarded on PENDING like the approval path. The
      // row lock the update takes is held until commit, so a `cancelLeave` or
      // `deleteLeave` cannot slip between the write and the read that reports
      // it.
      const { count } = await tx.leave.updateMany({
        where: { id, status: LeaveStatus.PENDING },
        data: rejectData,
      });
      if (count !== 1) {
        throw Errors.conflict(
          'Cuti ini sudah diputuskan oleh permintaan lain. Muat ulang halaman untuk melihat status terbarunya.'
        );
      }
      return tx.leave.findUniqueOrThrow({
        where: { id },
        include: { staff: true, teacher: true },
      });
    });
  }

  // `updateMany` takes scalar fields only — it has no relation `connect` — so
  // the approver is written as `approvedById` here, not as `approvedBy`.
  const moveData: Prisma.LeaveUncheckedUpdateManyInput = {
    status: data.status,
    approvedById: approverId,
    approvedAt: new Date(),
  };

  // Approval writes the status, the balance debit and every attendance day as
  // one unit. The status belongs in here too: written first and outside the
  // transaction, a failing attendance day rolled the debit back but left the
  // request APPROVED — a retry returned early at the guard above, and a later
  // cancellation credited days that were never spent.
  return prisma.$transaction(async (tx) => {
    // Move PENDING → APPROVED in one statement, guarded on the status the guard
    // above read. A concurrent decision (another approval, a cancellation)
    // commits first and this update matches nothing, so the two cannot both
    // write: the loser gets a 409 instead of silently overwriting the winner.
    const { count } = await tx.leave.updateMany({
      where: { id, status: LeaveStatus.PENDING },
      data: moveData,
    });
    if (count !== 1) {
      throw Errors.conflict(
        'Cuti ini sudah diputuskan oleh permintaan lain. Muat ulang halaman untuk melihat status terbarunya.'
      );
    }

    const leave = await tx.leave.findUniqueOrThrow({
      where: { id },
      include: { staff: true, teacher: true },
    });

    // Mark each day of the leave, from the row this transaction just wrote.
    // `updateLeave` can change a pending leave's dates in a concurrent
    // transaction; building the days from the guard's pre-transaction snapshot
    // would then approve the new dates while marking attendance on the stale
    // ones. Keyed on staffId now, so a teacher's leave lands on the same row as
    // their clock-ins.
    const targetStaffId = await resolveStaffId(
      {
        staffId: leave.staffId ?? undefined,
        teacherId: leave.teacherId ?? undefined,
      },
      tx
    );

    const dates: Date[] = [];
    const currentDate = new Date(leave.startDate);
    while (currentDate <= leave.endDate) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // 1. Update Leave Balance
    const userId = leave.staff?.userId || leave.teacher?.userId;
    if (userId) {
      // Find relevant academic year for the leave start date
      const academicYear = await tx.academicYear.findFirst({
        where: {
          startDate: { lte: leave.startDate },
          endDate: { gte: leave.endDate },
        },
      });

      if (academicYear) {
        // Update balance if exists
        const balance = await tx.leaveBalance.findUnique({
          where: {
            userId_academicYearId_leaveType: {
              userId,
              academicYearId: academicYear.id,
              leaveType: leave.type,
            },
          },
        });

        if (balance) {
          await tx.leaveBalance.update({
            where: { id: balance.id },
            data: {
              usedDays: { increment: leave.totalDays },
              remainingDays: { decrement: leave.totalDays },
            },
          });
        }
      }
    }

    // 2. Mark each day LEAVE, but remember what the row held: a day the person
    // already clocked in keeps its evidence, and a later cancellation restores
    // it rather than deleting a day they actually attended.
    for (const date of dates) {
      const existingAttendance = await tx.staffAttendance.findUnique({
        where: { staffId_date: { staffId: targetStaffId, date } },
        select: { id: true, status: true, notes: true, leaveRequestId: true },
      });
      if (existingAttendance) {
        // A day already carrying this leave is idempotent; a day carrying a
        // *different* approved leave is left to that leave's own bookkeeping.
        if (existingAttendance.leaveRequestId && existingAttendance.leaveRequestId !== id) {
          continue;
        }
        await tx.staffAttendance.update({
          where: { id: existingAttendance.id },
          data: {
            status: StaffAttendanceStatus.LEAVE,
            notes: `Cuti: ${leave.type}`,
            leaveRequestId: id,
            leavePreviousStatus: existingAttendance.status,
            // Keep the original explanation so cancelling restores it rather
            // than wiping a recorded reason.
            leavePreviousNotes: existingAttendance.notes,
          },
        });
      } else {
        await tx.staffAttendance.create({
          data: {
            staffId: targetStaffId,
            date,
            status: StaffAttendanceStatus.LEAVE,
            notes: `Cuti: ${leave.type}`,
            leaveRequestId: id,
          },
        });
      }
    }

    await tx.auditLog.create({
      data: {
        userId: approverId,
        action: 'APPROVE',
        entity: 'Leave',
        entityId: id,
        newValues: { status: data.status, type: leave.type, totalDays: leave.totalDays },
      },
    });

    return leave;
  });
}

export async function cancelLeave(id: string) {
  const leave = await prisma.leave.findUnique({
    where: { id },
    include: { staff: true, teacher: true },
  });
  if (!leave) throw Errors.notFound('Leave request not found');

  const wasApproved = leave.status === LeaveStatus.APPROVED;

  // Guarded move to CANCELLED, so a cancellation racing an approval cannot both
  // write: whichever commits first wins, the other's guarded update matches
  // nothing and it reverts its own writes instead of crediting a balance the
  // winner just spent (or spending one it just credited). A second cancellation
  // of a row already CANCELLED is an idempotent no-op, as before.
  const { cancelled } = await prisma.$transaction(async (tx) => {
    const { count } = await tx.leave.updateMany({
      where: { id, status: leave.status },
      data: { status: LeaveStatus.CANCELLED },
    });
    if (count !== 1) {
      throw Errors.conflict(
        'Cuti ini sudah diputuskan oleh permintaan lain. Muat ulang halaman untuk melihat status terbarunya.'
      );
    }

    if (wasApproved) {
      // Revert the balance the approval spent.
      const userId = leave.staff?.userId || leave.teacher?.userId;
      if (userId) {
        const academicYear = await tx.academicYear.findFirst({
          where: {
            startDate: { lte: leave.startDate },
            endDate: { gte: leave.endDate },
          },
        });
        if (academicYear) {
          const balance = await tx.leaveBalance.findUnique({
            where: {
              userId_academicYearId_leaveType: {
                userId,
                academicYearId: academicYear.id,
                leaveType: leave.type,
              },
            },
          });
          if (balance) {
            await tx.leaveBalance.update({
              where: { id: balance.id },
              data: {
                usedDays: { decrement: leave.totalDays },
                remainingDays: { increment: leave.totalDays },
              },
            });
          }
        }
      }
    }

    return {
      cancelled: await tx.leave.findUniqueOrThrow({
        where: { id },
        include: { staff: true, teacher: true },
      }),
    };
  });

  // Only the rows this leave wrote are touched, and they are matched by the
  // leave id — not by a status and a generic note, which also matched a day the
  // person actually clocked in. A row that pre-existed the leave is restored to
  // what it held; a row the leave created is removed.
  if (wasApproved) {
    const rows = await prisma.staffAttendance.findMany({
      where: { leaveRequestId: id },
      select: { id: true, leavePreviousStatus: true, leavePreviousNotes: true },
    });
    await prisma.$transaction(async (tx) => {
      for (const row of rows) {
        if (row.leavePreviousStatus) {
          await tx.staffAttendance.update({
            where: { id: row.id },
            data: {
              status: row.leavePreviousStatus,
              // Restore the pre-leave notes, not null: the row may have carried
              // a recorded explanation that approval overwrote.
              notes: row.leavePreviousNotes,
              leaveRequestId: null,
              leavePreviousStatus: null,
              leavePreviousNotes: null,
            },
          });
        } else {
          await tx.staffAttendance.delete({ where: { id: row.id } });
        }
      }
      await tx.auditLog.create({
        data: {
          userId: null,
          action: 'CANCEL',
          entity: 'Leave',
          entityId: id,
          oldValues: { status: leave.status, type: leave.type, totalDays: leave.totalDays },
        },
      });
    });
  }

  return cancelled;
}

export async function deleteLeave(id: string) {
  const leave = await prisma.leave.findUnique({ where: { id } });
  if (leave?.status === LeaveStatus.APPROVED) {
    throw new Error('Cannot delete approved leave');
  }
  return prisma.leave.delete({ where: { id } });
}

export async function getLeaveBalance(employeeId: string, year: number) {
  // 1. Resolve User ID (accepts User ID, Staff ID, or Teacher ID)
  let userId: string | undefined;

  // Check if ID is directly a User ID
  const user = await prisma.user.findUnique({
    where: { id: employeeId },
    select: { id: true },
  });

  if (user) {
    userId = user.id;
  } else {
    // Check if ID is Staff ID
    const staff = await prisma.staff.findUnique({
      where: { id: employeeId },
      select: { userId: true },
    });
    if (staff) {
      userId = staff.userId;
    } else {
      // Check if ID is Teacher ID
      const teacher = await prisma.teacher.findUnique({
        where: { id: employeeId },
        select: { userId: true },
      });
      if (teacher) {
        userId = teacher.userId;
      }
    }
  }

  // 2. Find Academic Year for the given year (approximate or active)
  const targetDate = new Date(year, 0, 1);
  const academicYear = await prisma.academicYear.findFirst({
    where: {
      startDate: { lte: targetDate },
      endDate: { gte: targetDate },
    },
  });

  // 3. If User and Academic Year found, try to fetch LeaveBalance
  if (userId && academicYear) {
    const balances = await prisma.leaveBalance.findMany({
      where: {
        userId,
        academicYearId: academicYear.id,
      },
    });

    if (balances.length > 0) {
      const annualBalance = balances.find((b) => b.leaveType === LeaveType.ANNUAL);
      const usedByType: Record<string, number> = {};
      balances.forEach((b) => {
        usedByType[b.leaveType] = b.usedDays;
      });

      // The entitlement is a setting (LeaveTypeConfig), not a constant here;
      // 12 days is only the last resort when no config row exists yet.
      const annualConfig = await prisma.leaveTypeConfig.findUnique({
        where: { leaveType: LeaveType.ANNUAL },
      });
      const annualQuota = annualBalance?.totalDays ?? annualConfig?.entitlementDays ?? 12;
      const usedAnnual = annualBalance?.usedDays || 0;
      const remainingAnnual = annualBalance?.remainingDays ?? annualQuota - usedAnnual;

      return {
        employeeId,
        year,
        annualQuota,
        usedAnnual,
        remainingAnnual,
        usedByType,
        totalUsed: balances.reduce((sum, b) => sum + b.usedDays, 0),
      };
    }
  }

  // Fallback: Check both staff and teacher
  const leaves = await prisma.leave.findMany({
    where: {
      OR: [{ staffId: employeeId }, { teacherId: employeeId }],
      status: LeaveStatus.APPROVED,
      startDate: {
        gte: new Date(year, 0, 1),
        lte: new Date(year, 11, 31),
      },
    },
  });

  const usedByType = leaves.reduce(
    (acc, leave) => {
      acc[leave.type] = (acc[leave.type] || 0) + leave.totalDays;
      return acc;
    },
    {} as Record<string, number>
  );

  // A new employee has no stored balance rows yet; the entitlement is still the
  // configured one (LeaveTypeConfig), and 12 is only the last resort.
  const annualConfig = await prisma.leaveTypeConfig.findUnique({
    where: { leaveType: LeaveType.ANNUAL },
  });
  const annualQuota = annualConfig?.entitlementDays ?? 12;

  return {
    employeeId,
    year,
    annualQuota,
    usedAnnual: usedByType[LeaveType.ANNUAL] || 0,
    remainingAnnual: annualQuota - (usedByType[LeaveType.ANNUAL] || 0),
    usedByType,
    totalUsed: leaves.reduce((sum, leave) => sum + leave.totalDays, 0),
  };
}

// =====================================
// STAFF SERVICE (for HR listing)
// =====================================

export async function getStaffList(params: {
  page: number;
  limit: number;
  unitId?: string;
  department?: string;
  search?: string;
}) {
  const { page, limit, unitId, department, search } = params;
  const skip = (page - 1) * limit;

  const where: Prisma.StaffWhereInput = {
    deletedAt: null,
  };

  if (unitId) where.unitId = unitId;
  if (department) where.department = department;

  if (search) {
    where.OR = [
      { user: { name: { contains: search, mode: 'insensitive' } } },
      { nip: { contains: search, mode: 'insensitive' } },
      { position: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.staff.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true, isActive: true } },
        unit: { select: { id: true, name: true } },
      },
    }),
    prisma.staff.count({ where }),
  ]);

  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getStaffById(id: string) {
  return prisma.staff.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true, isActive: true } },
      unit: { select: { id: true, name: true } },
    },
  });
}
