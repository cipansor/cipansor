import type {
  LeaveStatus,
  LeaveType,
  StaffAttendanceStatus,
} from "../schemas/hr-attendance";

/**
 * Staff-attendance response contracts — what the API returns and the web reads.
 * Defined once here; the web hook re-exports them so both sides share one shape
 * (see packages/shared/AGENTS.md and golden rule #8).
 *
 * These mirror the API's Prisma-backed responses. They are the wire contract,
 * not the DB model, so they stay plain interfaces with no Prisma import.
 */

export interface AttendanceEvidence {
  id: string;
  kind: "CHECK_IN" | "CHECK_OUT";
  /**
   * Whether a selfie backs this punch. The photo itself is never in a list: it
   * is fetched one at a time from `GET /hr/attendance/records/{id}/photo`,
   * which checks who is asking and records the read.
   */
  hasPhoto: boolean;
  /** FILE = picked from the device because no camera was available; review it. */
  photoSource?: "CAMERA" | "FILE" | null;
  latitude?: number | null;
  longitude?: number | null;
  distanceMeters?: number | null;
  isWithinRadius?: boolean | null;
  capturedAt: string;
}

export interface StaffAttendance {
  id: string;
  staffId?: string;
  teacherId?: string;
  staff?: {
    id: string;
    userId?: string;
    user?: { id: string; name: string; email?: string };
    unitId?: string;
    unit?: { id: string; name: string };
  };
  teacher?: {
    id: string;
    user?: { id: string; name: string; email?: string };
    unit?: { id: string; name: string };
  };
  date: string;
  status: StaffAttendanceStatus;
  checkIn?: string | null;
  checkOut?: string | null;
  lateMinutes?: number | null;
  notes?: string | null;
  recordedById?: string | null;
  records?: AttendanceEvidence[];
  createdAt: string;
  updatedAt: string;
}

export interface MyAttendance {
  id: string;
  date: string;
  status: StaffAttendanceStatus;
  checkIn?: string | null;
  checkOut?: string | null;
  lateMinutes?: number | null;
  shift?: {
    id: string;
    name: string;
    startTime: string;
    endTime: string;
  } | null;
  records: AttendanceEvidence[];
}

/** What the caller's unit asks for on a punch, as the API will enforce it. */
export interface AttendanceRequirements {
  /** False when neither the unit nor the yayasan has a policy row yet. */
  configured: boolean;
  requireSelfie: boolean;
  requireLocation: boolean;
  outsideRadiusAction: "FLAG" | "REJECT";
  /** After this many days the selfie is deleted by the retention job. */
  photoRetentionDays: number;
}

/** GET /hr/attendance/me — the day's row plus what the caller may do next. */
export interface MyAttendanceToday {
  /**
   * False when the account has no staff record yet: nobody can clock in
   * without one, and the page says so instead of greying the buttons out.
   */
  hasProfile: boolean;
  requirements: AttendanceRequirements;
  date: string;
  attendance: MyAttendance | null;
  shift: {
    id: string;
    name: string;
    startTime: string;
    endTime: string;
  } | null;
  isWorkDay: boolean;
  isExempt: boolean;
  canCheckIn: boolean;
  canCheckOut: boolean;
  /** A still-open previous-day row, for a shift that crosses midnight. */
  openAttendance?: MyAttendance | null;
}

export interface AttendanceSite {
  id: string;
  unitId?: string | null;
  label: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  isActive: boolean;
}

export interface WorkShift {
  id: string;
  unitId?: string | null;
  name: string;
  startTime: string;
  endTime: string;
  graceMinutes: number;
  crossesMidnight: boolean;
  isActive: boolean;
}

export interface ShiftAssignment {
  id: string;
  staffId: string;
  shiftId: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  daysOfWeek: number[];
  shift?: WorkShift;
  staff?: { id: string; user?: { name: string } };
}

export interface ShiftRotation {
  id: string;
  shiftId: string;
  name: string;
  memberIds: string[];
  startDate: string;
  endDate?: string | null;
  cycleDays: number;
  isActive: boolean;
  shift?: WorkShift;
}

export interface WorkWeekConfig {
  id: string;
  unitId?: string | null;
  workDays: number[];
  hoursPerDay: number;
  fridayEndTime?: string | null;
  isActive: boolean;
}

export interface AttendancePolicy {
  id: string;
  unitId?: string | null;
  graceMinutes: number;
  requireSelfie: boolean;
  requireLocation: boolean;
  outsideRadiusAction: "FLAG" | "REJECT";
  photoRetentionDays: number;
  recordRetentionDays: number;
  isActive: boolean;
}

export interface AttendanceExemption {
  id: string;
  roleCode?: string | null;
  staffId?: string | null;
  reason?: string | null;
  isActive: boolean;
}

export interface WorkCalendarDay {
  date: string;
  isWorkDay: boolean;
  isHoliday: boolean;
}

export interface RetentionPolicy {
  id: string;
  dataType: string;
  retentionDays: number;
  action: "DELETE" | "ANONYMIZE" | "ARCHIVE";
  isActive: boolean;
}

export interface LeaveTypeConfig {
  id: string;
  leaveType: LeaveType;
  entitlementDays?: number | null;
  periodBasis: "CALENDAR_YEAR" | "ACADEMIC_YEAR";
  isPaid: boolean;
  requiresDocument: boolean;
  isActive: boolean;
  notes?: string | null;
}

export interface HolidaySyncConfig {
  sourceUrl: string;
  years: number[];
  enabled: boolean;
  lastSyncedAt: string | null;
}

export interface HolidaySyncResult {
  year: number;
  created: number;
  updated: number;
  skipped: number;
  entries: number;
}

export interface HolidayDraft {
  id: string;
  title: string;
  startDate: string;
  unitId?: string | null;
}
