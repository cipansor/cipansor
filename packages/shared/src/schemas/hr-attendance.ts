import { z } from "zod";

/**
 * Staff attendance contracts — the request bodies the API validates at the edge
 * and the web sends. Defined once here so the two sides cannot drift: the same
 * value that a page posts is the one the API accepts.
 *
 * The status/leave enums mirror the Prisma enums of the same name; they are kept
 * in exact sync (see packages/shared/AGENTS.md). DB enums still come from
 * `@prisma/client` server-side — these are the wire contract only.
 */

/**
 * Enum-like objects: the web reads `StaffAttendanceStatus.PRESENT` as a value
 * and types a field `StaffAttendanceStatus`, so both a const and a type of the
 * same name are exported. The values mirror the Prisma enums exactly.
 */
export const StaffAttendanceStatus = {
  PRESENT: "PRESENT",
  ABSENT: "ABSENT",
  LATE: "LATE",
  SICK: "SICK",
  LEAVE: "LEAVE",
  REMOTE: "REMOTE",
  DUTY: "DUTY",
  HOLIDAY: "HOLIDAY",
} as const;
export type StaffAttendanceStatus =
  (typeof StaffAttendanceStatus)[keyof typeof StaffAttendanceStatus];
/** @deprecated use `StaffAttendanceStatus` — kept for existing imports. */
export type StaffAttendanceStatusValue = StaffAttendanceStatus;

export const LeaveType = {
  ANNUAL: "ANNUAL",
  SICK: "SICK",
  MATERNITY: "MATERNITY",
  PATERNITY: "PATERNITY",
  MARRIAGE: "MARRIAGE",
  BEREAVEMENT: "BEREAVEMENT",
  UNPAID: "UNPAID",
  OTHER: "OTHER",
} as const;
export type LeaveType = (typeof LeaveType)[keyof typeof LeaveType];
/** @deprecated use `LeaveType` — kept for existing imports. */
export type LeaveTypeValue = LeaveType;

export const LeaveStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
} as const;
export type LeaveStatus = (typeof LeaveStatus)[keyof typeof LeaveStatus];
/** @deprecated use `LeaveStatus` — kept for existing imports. */
export type LeaveStatusValue = LeaveStatus;

export const STAFF_ATTENDANCE_STATUSES = Object.values(StaffAttendanceStatus);
export const LEAVE_TYPES = Object.values(LeaveType);
export const LEAVE_STATUSES = Object.values(LeaveStatus);

const staffAttendanceStatus = z.enum(STAFF_ATTENDANCE_STATUSES);

/**
 * A calendar day from a date picker ("yyyy-MM-dd") or a full datetime. The
 * attendance tables key on a WIB calendar day, so a picker's value must be
 * accepted as-is; requiring a datetime is what made bulk attendance 400.
 */
export const attendanceDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, "Format tanggal harus yyyy-MM-dd");

/** A clock time as the form's picker writes it, "HH:mm". */
export const attendanceTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Format jam harus HH:mm");

// ==================== SELF CHECK-IN / CHECK-OUT ====================

export const selfAttendanceSchema = z.object({
  staffId: z.string().uuid().optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  accuracyMeters: z.coerce.number().min(0).optional(),
  /** The reference `POST /hr/attendance/photo` returned — not a URL. */
  photoRef: z.string().min(1).max(200).optional(),
  /** CAMERA when taken live on the page; FILE when picked because no camera was available. */
  photoSource: z.enum(["CAMERA", "FILE"]).optional(),
  deviceInfo: z.string().max(500).optional(),
});
export type SelfAttendanceInput = z.infer<typeof selfAttendanceSchema>;

// ==================== BULK ATTENDANCE ====================

export const staffBulkAttendanceSchema = z.object({
  date: attendanceDate,
  records: z
    .array(
      z.object({
        staffId: z.string().uuid().optional(),
        teacherId: z.string().uuid().optional(),
        status: staffAttendanceStatus,
        checkIn: z.string().datetime().optional(),
        checkOut: z.string().datetime().optional(),
        notes: z.string().optional(),
      }),
    )
    .refine((records) => records.every((r) => r.staffId || r.teacherId), {
      message: "Each record must have either staffId or teacherId",
    }),
});
export type StaffBulkAttendanceInput = z.infer<
  typeof staffBulkAttendanceSchema
>;

// ==================== ATTENDANCE SETTINGS ====================

export const attendanceSiteSchema = z.object({
  unitId: z.string().uuid().nullable().optional(),
  label: z.string().min(2),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusMeters: z.coerce.number().int().min(10).max(5000).default(200),
  isActive: z.boolean().default(true),
});
export type AttendanceSiteInput = z.infer<typeof attendanceSiteSchema>;

export const workShiftSchema = z.object({
  unitId: z.string().uuid().nullable().optional(),
  name: z.string().min(2),
  startTime: attendanceTime,
  endTime: attendanceTime,
  graceMinutes: z.coerce.number().int().min(0).max(180).default(15),
  crossesMidnight: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export type WorkShiftInput = z.infer<typeof workShiftSchema>;

export const shiftAssignmentSchema = z.object({
  staffId: z.string().uuid(),
  shiftId: z.string().uuid(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().optional(),
  daysOfWeek: z.array(z.coerce.number().int().min(0).max(6)).default([]),
});
export type ShiftAssignmentInput = z.infer<typeof shiftAssignmentSchema>;

export const shiftRotationSchema = z.object({
  shiftId: z.string().uuid(),
  name: z.string().min(2),
  memberIds: z.array(z.string().uuid()).min(1),
  startDate: z.string(),
  endDate: z.string().optional(),
  cycleDays: z.coerce.number().int().min(1).max(90).default(7),
  isActive: z.boolean().default(true),
});
export type ShiftRotationInput = z.infer<typeof shiftRotationSchema>;

export const workWeekConfigSchema = z.object({
  unitId: z.string().uuid().nullable().optional(),
  workDays: z.array(z.coerce.number().int().min(0).max(6)).min(1),
  hoursPerDay: z.coerce.number().int().min(1).max(12).default(7),
  // An empty picker sends null; treat it the same as "not set" rather than 400.
  fridayEndTime: attendanceTime.nullable().optional(),
  isActive: z.boolean().default(true),
});
export type WorkWeekConfigInput = z.infer<typeof workWeekConfigSchema>;

/**
 * The shortest a staff attendance row may be kept. The rows are what a payslip's
 * deductions were computed from — a document underlying the books — and UU KUP
 * Ps. 28(11) keeps those ten years. A shorter setting would have the retention
 * job delete the evidence for wages already paid.
 */
export const MIN_ATTENDANCE_RECORD_RETENTION_DAYS = 3650;

/**
 * Selfie and location are off until an admin switches them on (decided
 * 2026-10-09): a facial image is specific personal data (UU PDP Ps. 4), and is
 * not collected before the staff privacy notice exists.
 */
export const attendancePolicySchema = z.object({
  unitId: z.string().uuid().nullable().optional(),
  graceMinutes: z.coerce.number().int().min(0).max(180).default(15),
  requireSelfie: z.boolean().default(false),
  requireLocation: z.boolean().default(false),
  outsideRadiusAction: z.enum(["FLAG", "REJECT"]).default("FLAG"),
  photoRetentionDays: z.coerce.number().int().min(1).max(3650).default(365),
  recordRetentionDays: z.coerce
    .number()
    .int()
    .min(
      MIN_ATTENDANCE_RECORD_RETENTION_DAYS,
      "Catatan absensi disimpan paling singkat 10 tahun (dasar penggajian, UU KUP Ps. 28 ayat 11)",
    )
    .max(36500)
    .default(MIN_ATTENDANCE_RECORD_RETENTION_DAYS),
  isActive: z.boolean().default(true),
});
export type AttendancePolicyInput = z.infer<typeof attendancePolicySchema>;

export const attendanceExemptionSchema = z
  .object({
    roleCode: z.string().optional(),
    staffId: z.string().uuid().optional(),
    reason: z.string().max(500).optional(),
    isActive: z.boolean().default(true),
  })
  .refine((d) => d.roleCode || d.staffId, {
    message: "roleCode atau staffId wajib diisi",
  });
export type AttendanceExemptionInput = z.infer<
  typeof attendanceExemptionSchema
>;

// ==================== RETENTION ====================

export const retentionPolicySchema = z.object({
  dataType: z.enum([
    "ATTENDANCE_PHOTO",
    "ATTENDANCE_RECORD",
    "LEAVE",
    "PAYROLL",
    "AUDIT_LOG",
  ]),
  retentionDays: z.coerce.number().int().min(1).max(36500),
  action: z.enum(["DELETE", "ANONYMIZE", "ARCHIVE"]).default("DELETE"),
  isActive: z.boolean().default(true),
});
export type RetentionPolicyInput = z.infer<typeof retentionPolicySchema>;

export const leaveTypeConfigSchema = z.object({
  leaveType: z.enum(LEAVE_TYPES),
  entitlementDays: z.coerce
    .number()
    .int()
    .min(0)
    .max(365)
    .nullable()
    .optional(),
  periodBasis: z
    .enum(["CALENDAR_YEAR", "ACADEMIC_YEAR"])
    .default("CALENDAR_YEAR"),
  isPaid: z.boolean().default(true),
  requiresDocument: z.boolean().default(false),
  isActive: z.boolean().default(true),
  notes: z.string().max(500).optional(),
});
export type LeaveTypeConfigInput = z.infer<typeof leaveTypeConfigSchema>;

// ==================== LEAVE REQUEST ====================

export const createLeaveSchema = z.object({
  staffId: z.string().uuid().optional(),
  teacherId: z.string().uuid().optional(),
  type: z.enum(LEAVE_TYPES),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  reason: z.string().min(5),
});
export type CreateLeaveInput = z.infer<typeof createLeaveSchema>;
