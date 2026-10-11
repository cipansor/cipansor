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
import { Errors } from '../../middleware/error';
import {
  actorReachesUnit,
  isFoundationScopedRole,
  writeUnitScopeFor,
  type UnitActor,
} from '../../utils/resolve-unit-id';
import {
  ADMIN_ROLE_CODES,
  PARENT_ROLE_CODES,
  STUDENT_ROLE_CODES,
  TATA_USAHA_ROLE_CODES,
} from '@cipansor/shared';

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
      await tx.teacher.create({
        data: {
          userId: user.id,
          unitId,
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
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function getStaffAttendanceById(id: string) {
  return prisma.staffAttendance.findUnique({
    where: { id },
    include: {
      staff: {
        include: {
          user: { select: { id: true, name: true, email: true } },
          unit: { select: { id: true, name: true } },
        },
      },
    },
  });
}

export async function createStaffAttendance(data: CreateStaffAttendanceInput) {
  const date = new Date(data.date);
  date.setHours(0, 0, 0, 0);

  return prisma.staffAttendance.create({
    data: {
      staffId: data.staffId,
      teacherId: data.teacherId,
      date,
      status: data.status,
      checkIn: data.checkIn ? new Date(data.checkIn) : undefined,
      checkOut: data.checkOut ? new Date(data.checkOut) : undefined,
      notes: data.notes,
    },
  });
}

export async function updateStaffAttendance(id: string, data: UpdateStaffAttendanceInput) {
  return prisma.staffAttendance.update({
    where: { id },
    data: {
      status: data.status,
      checkIn: data.checkIn ? new Date(data.checkIn) : undefined,
      checkOut: data.checkOut ? new Date(data.checkOut) : undefined,
      notes: data.notes,
    },
  });
}

export async function recordBulkAttendance(data: BulkAttendanceInput) {
  const date = new Date(data.date);
  date.setHours(0, 0, 0, 0);

  const results = await prisma.$transaction(
    data.records.map((record) => {
      // Handle upsert with new composite key
      // Must explicitly set the other ID to null for the unique constraint
      const whereUnique = record.staffId
        ? { staffId_teacherId_date: { staffId: record.staffId, teacherId: null, date } }
        : { staffId_teacherId_date: { staffId: null, teacherId: record.teacherId!, date } };

      return prisma.staffAttendance.upsert({
        where: whereUnique as any,
        update: {
          status: record.status,
          checkIn: record.checkIn ? new Date(record.checkIn) : undefined,
          checkOut: record.checkOut ? new Date(record.checkOut) : undefined,
          notes: record.notes,
        },
        create: {
          staffId: record.staffId,
          teacherId: record.teacherId,
          date,
          status: record.status,
          checkIn: record.checkIn ? new Date(record.checkIn) : undefined,
          checkOut: record.checkOut ? new Date(record.checkOut) : undefined,
          notes: record.notes,
        },
      });
    })
  );

  return { count: results.length, records: results };
}

export async function getStaffAttendanceSummary(staffId: string, month: number, year: number) {
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

export async function deleteStaffAttendance(id: string) {
  return prisma.staffAttendance.delete({ where: { id } });
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
  const updateData: Prisma.LeaveUpdateInput = {
    status: data.status,
    approvedBy: { connect: { id: approverId } },
    approvedAt: new Date(),
  };

  if (data.status === LeaveStatus.REJECTED && data.rejectedNote) {
    updateData.rejectedNote = data.rejectedNote;
  }

  const leave = await prisma.leave.update({
    where: { id },
    data: updateData,
    include: { staff: true, teacher: true },
  });

  // If approved, mark staff/teacher attendance as LEAVE for those days
  if (data.status === LeaveStatus.APPROVED) {
    // 1. Update Leave Balance
    const userId = leave.staff?.userId || leave.teacher?.userId;
    if (userId) {
      // Find relevant academic year for the leave start date
      const academicYear = await prisma.academicYear.findFirst({
        where: {
          startDate: { lte: leave.startDate },
          endDate: { gte: leave.endDate },
        },
      });

      if (academicYear) {
        // Update balance if exists
        const balance = await prisma.leaveBalance.findUnique({
          where: {
            userId_academicYearId_leaveType: {
              userId,
              academicYearId: academicYear.id,
              leaveType: leave.type,
            },
          },
        });

        if (balance) {
          await prisma.leaveBalance.update({
            where: { id: balance.id },
            data: {
              usedDays: { increment: leave.totalDays },
              remainingDays: { decrement: leave.totalDays },
            },
          });
        }
      }
    }

    const startDate = new Date(leave.startDate);
    const endDate = new Date(leave.endDate);

    const dates: Date[] = [];
    const currentDate = new Date(startDate);
    while (currentDate <= endDate) {
      dates.push(new Date(currentDate));
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Determine target ID (staff or teacher)
    const staffId = leave.staffId;
    const teacherId = leave.teacherId;

    const transactionOperations = dates
      .map((date) => {
        // Construct upsert args carefully
        // Note: For upsert to work with @@unique([staffId, teacherId, date]),
        // we must explicitly set the other ID to null in the where clause
        // AND ensure the type safety for Prisma client

        if (staffId) {
          return prisma.staffAttendance.upsert({
            where: {
              staffId_teacherId_date: { staffId: staffId, teacherId: null, date } as any,
            },
            update: { status: StaffAttendanceStatus.LEAVE, notes: `Cuti: ${leave.type}` },
            create: {
              staffId: staffId,
              date,
              status: StaffAttendanceStatus.LEAVE,
              notes: `Cuti: ${leave.type}`,
            },
          });
        } else if (teacherId) {
          return prisma.staffAttendance.upsert({
            where: {
              staffId_teacherId_date: { staffId: null, teacherId: teacherId, date } as any,
            },
            update: { status: StaffAttendanceStatus.LEAVE, notes: `Cuti: ${leave.type}` },
            create: {
              teacherId: teacherId,
              date,
              status: StaffAttendanceStatus.LEAVE,
              notes: `Cuti: ${leave.type}`,
            },
          });
        }

        return null;
      })
      .filter((op): op is Prisma.Prisma__StaffAttendanceClient<any, never> => op !== null);

    await prisma.$transaction(transactionOperations);
  }

  return leave;
}

export async function cancelLeave(id: string) {
  return prisma.leave.update({
    where: { id },
    data: { status: LeaveStatus.CANCELLED },
  });
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

      const annualQuota = annualBalance?.totalDays || 12;
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

  // Default annual leave quota (can be configured per company policy)
  const annualQuota = 12;

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
