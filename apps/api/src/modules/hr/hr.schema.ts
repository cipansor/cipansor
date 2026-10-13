import { z } from 'zod';
import {
  LeaveType,
  LeaveStatus,
  StaffAttendanceStatus,
  UserRole,
  Gender,
  EmploymentStatus,
} from '@prisma/client';
import {
  attendanceDate,
  attendanceExemptionSchema,
  attendancePolicySchema,
  attendanceSiteSchema,
  createLeaveSchema,
  leaveTypeConfigSchema,
  retentionPolicySchema,
  selfAttendanceSchema,
  shiftAssignmentSchema,
  shiftRotationSchema,
  staffBulkAttendanceSchema,
  workShiftSchema,
  workWeekConfigSchema,
} from '@cipansor/shared';
import type {
  AttendanceExemptionInput,
  AttendancePolicyInput,
  AttendanceSiteInput,
  CreateLeaveInput,
  LeaveTypeConfigInput,
  RetentionPolicyInput,
  SelfAttendanceInput,
  ShiftAssignmentInput,
  ShiftRotationInput,
  StaffBulkAttendanceInput,
  WorkShiftInput,
  WorkWeekConfigInput,
} from '@cipansor/shared';

// The attendance-settings contracts live once, in `@cipansor/shared`, so the
// form that posts a value and the API that validates it cannot drift. They are
// re-exported here so this module's controllers and services keep one import site.
export {
  attendanceExemptionSchema,
  attendancePolicySchema,
  attendanceSiteSchema,
  createLeaveSchema,
  leaveTypeConfigSchema,
  retentionPolicySchema,
  selfAttendanceSchema,
  shiftAssignmentSchema,
  shiftRotationSchema,
  workShiftSchema,
  workWeekConfigSchema,
};
export type {
  AttendanceExemptionInput,
  AttendancePolicyInput,
  AttendanceSiteInput,
  CreateLeaveInput,
  LeaveTypeConfigInput,
  RetentionPolicyInput,
  SelfAttendanceInput,
  ShiftAssignmentInput,
  ShiftRotationInput,
  StaffBulkAttendanceInput,
  WorkShiftInput,
  WorkWeekConfigInput,
};

/** The staff bulk register the API validates is the shared contract. */
export const bulkAttendanceSchema = staffBulkAttendanceSchema;

// Staff Attendance schemas
export const createStaffAttendanceSchema = z
  .object({
    staffId: z.string().uuid().optional(),
    teacherId: z.string().uuid().optional(),
    date: attendanceDate,
    status: z.nativeEnum(StaffAttendanceStatus).default(StaffAttendanceStatus.PRESENT),
    checkIn: z.string().datetime().optional(),
    checkOut: z.string().datetime().optional(),
    notes: z.string().optional(),
  })
  .refine((data) => data.staffId || data.teacherId, {
    message: 'Either staffId or teacherId must be provided',
  });

// A correction to a recorded day carries its reason; the service writes an
// AuditLog entry with the old and new values alongside it.
export const updateStaffAttendanceSchema = z.object({
  status: z.nativeEnum(StaffAttendanceStatus).optional(),
  checkIn: z.string().datetime().optional(),
  checkOut: z.string().datetime().optional(),
  notes: z.string().optional(),
  reason: z.string().min(5, 'Alasan koreksi minimal 5 karakter'),
});

export const deleteStaffAttendanceSchema = z.object({
  reason: z.string().min(5, 'Alasan penghapusan minimal 5 karakter'),
});

export const queryStaffAttendanceSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  staffId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  status: z.nativeEnum(StaffAttendanceStatus).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

// ==================== PAYROLL POLICY ====================

export const payrollComponentSchema = z.object({
  code: z.string().min(2).max(40),
  name: z.string().min(2),
  classification: z.enum(['POKOK', 'TETAP', 'TIDAK_TETAP']).default('TIDAK_TETAP'),
  kind: z.enum(['EARNING', 'DEDUCTION']).default('EARNING'),
  taxable: z.boolean().default(true),
  bpjsBase: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

// Every optional field is nullable: the settings form copies a saved row back
// into the draft, and a database null (rate, cap, legal basis, dates) would
// otherwise make an unchanged rule fail to save.
export const payrollPolicyRuleSchema = z
  .object({
    unitId: z.string().uuid().nullable().optional(),
    code: z.string().min(2).max(60),
    kind: z.enum(['EARNING', 'DEDUCTION']).default('DEDUCTION'),
    trigger: z.enum(['LATE', 'ABSENT', 'EARLY_LEAVE', 'PRESENT', 'OVERTIME']),
    basis: z.string().min(2),
    mode: z.enum([
      'NOMINAL',
      'PERSENTASE',
      'PRORATA',
      'PENGALI',
      'BERTINGKAT',
      'FORMULA',
      'MANUAL',
    ]),
    rate: z.coerce.number().nullable().optional(),
    unit: z.enum(['PER_MENIT', 'PER_HARI', 'PER_KEJADIAN', 'PER_BULAN']).default('PER_KEJADIAN'),
    tiersJson: z.record(z.string(), z.unknown()).nullable().optional(),
    formulaExpr: z.string().max(500).nullable().optional(),
    capPerDay: z.coerce.number().nullable().optional(),
    capPerMonth: z.coerce.number().nullable().optional(),
    rounding: z.enum(['NONE', 'ROUND', 'FLOOR', 'CEIL']).default('NONE'),
    priority: z.coerce.number().int().default(0),
    legalBasisDoc: z.string().max(500).nullable().optional(),
    isActive: z.boolean().default(false),
    effectiveFrom: z.string().nullable().optional(),
    effectiveTo: z.string().nullable().optional(),
  })
  // A deduction is lawful only as the perjanjian kerja, peraturan kepegawaian
  // or PKB sets it (PP 36/2021 Ps. 63(2)); an active one must name that
  // document. A draft (inactive) rule may be saved without it.
  .refine((r) => !(r.isActive && r.kind === 'DEDUCTION') || Boolean(r.legalBasisDoc?.trim()), {
    message:
      'Aturan potongan yang aktif wajib menyebut dasar hukumnya (perjanjian kerja, peraturan kepegawaian, atau PKB)',
    path: ['legalBasisDoc'],
  });

export const payrollGuardConfigSchema = z.object({
  unitId: z.string().uuid().nullable().optional(),
  // PP 36/2021 Ps. 65: deductions from one wage payment, at most 50% of it.
  maxDeductionPercent: z.coerce
    .number()
    .int()
    .min(0)
    .max(50, 'Potongan paling banyak 50% dari setiap pembayaran upah (PP 36/2021 Ps. 65)')
    .default(50),
  minBasicSharePercent: z.coerce.number().int().min(0).max(100).default(75),
  mustStayAboveUmk: z.boolean().default(true),
  // An empty UMK input sends null; null means "no UMK bound configured".
  umkNominal: z.coerce.number().nullable().optional(),
  isActive: z.boolean().default(true),
});

// Leave schemas
export const updateLeaveSchema = z.object({
  type: z.nativeEnum(LeaveType).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  reason: z.string().min(5).optional(),
});

export const approveLeaveSchema = z.object({
  status: z.enum([LeaveStatus.APPROVED, LeaveStatus.REJECTED]),
  rejectedNote: z.string().optional(),
});

export const queryLeaveSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  staffId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  unitId: z.string().uuid().optional(),
  type: z.nativeEnum(LeaveType).optional(),
  status: z.nativeEnum(LeaveStatus).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  mine: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
});

// Staff/Employee Management Schemas
export const createEmployeeSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  // Optional: without one a random password is set (see createEmployee).
  password: z.string().min(8).max(256).optional(),
  role: z.enum([UserRole.TEACHER, UserRole.STAFF]),
  unitId: z.string().uuid(),
  phone: z.string().optional(),

  // Teacher specific
  nip: z.string().optional(), // Shared with Staff but optional
  nuptk: z.string().optional(),
  gender: z.nativeEnum(Gender).optional(),
  birthPlace: z.string().optional(),
  birthDate: z.string().datetime().optional(),
  address: z.string().optional(),
  nik: z.string().optional(),
  noKK: z.string().optional(),
  religion: z.string().optional(),
  joinDate: z.string().datetime().optional(),
  employmentStatus: z.nativeEnum(EmploymentStatus).optional(),
  specialization: z.string().optional(),
  certificationNumber: z.string().optional(),

  // Staff specific
  position: z.string().optional(), // Required if role is STAFF
  department: z.string().optional(),
});

export const updateEmployeeSchema = z.object({
  name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  unitId: z.string().uuid().optional(),
  phone: z.string().optional(),
  isActive: z.boolean().optional(),

  // Profile fields
  nip: z.string().optional(),
  nuptk: z.string().optional(),
  gender: z.nativeEnum(Gender).optional(),
  birthPlace: z.string().optional(),
  birthDate: z.string().datetime().optional(),
  address: z.string().optional(),
  nik: z.string().optional(),
  noKK: z.string().optional(),
  religion: z.string().optional(),
  joinDate: z.string().datetime().optional(),
  employmentStatus: z.nativeEnum(EmploymentStatus).optional(),
  specialization: z.string().optional(),
  certificationNumber: z.string().optional(),

  position: z.string().optional(),
  department: z.string().optional(),
});

export const queryStaffSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  unitId: z.string().uuid().optional(),
  department: z.string().optional(),
  search: z.string().optional(),
});

export const queryTeachersSchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  // Some callers send an empty string while their unit filter hydrates
  unitId: z.preprocess((value) => (value === '' ? undefined : value), z.string().uuid().optional()),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ON_LEAVE']).optional(),
  search: z.string().optional(),
});

export type QueryTeachersInput = z.infer<typeof queryTeachersSchema>;

export type CreateStaffAttendanceInput = z.infer<typeof createStaffAttendanceSchema>;
export type UpdateStaffAttendanceInput = z.infer<typeof updateStaffAttendanceSchema>;
/** The staff bulk register; the same shape the web posts. */
export type BulkAttendanceInput = StaffBulkAttendanceInput;
export type UpdateLeaveInput = z.infer<typeof updateLeaveSchema>;
export type ApproveLeaveInput = z.infer<typeof approveLeaveSchema>;
export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
