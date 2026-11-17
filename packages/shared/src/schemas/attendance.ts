import { z } from "zod";
import {
  ADMIN_ROLE_CODES,
  PESANTREN_EDUCATOR_ROLE_CODES,
  PESANTREN_LEADER_ROLE_CODES,
  PRINCIPAL_ROLE_CODES,
  SCHOOL_TEACHER_ROLE_CODES,
} from "../roles";
import { AttendanceStatus } from "../types/enums";

/**
 * Daily attendance — one row per pupil, per class, per day
 * (`Attendance @@unique([studentId, classId, date])`), not per lesson.
 *
 * Who records a class's day is a relation, decided per class by the API
 * (`attendance.access.ts`): the class's wali kelas, a teacher with a lesson
 * in the class, and its admin unit. The kepala sekolah reads — and
 * records only where they are one of the above. These are the role codes that
 * may reach the write routes at all.
 */
export const ATTENDANCE_RECORDER_ROUTE_ROLE_CODES: readonly string[] = [
  ...SCHOOL_TEACHER_ROLE_CODES,
  ...PESANTREN_EDUCATOR_ROLE_CODES,
  ...PESANTREN_LEADER_ROLE_CODES,
  ...PRINCIPAL_ROLE_CODES,
  ...ADMIN_ROLE_CODES,
];

/**
 * A calendar day, "yyyy-MM-dd", as the teacher picked it. Not a datetime: a
 * register taken at 06:45 WIB belongs to that day, which `toISOString()`
 * would move to the day before.
 */
export const attendanceDay = z.iso.date("Tanggal tidak valid (yyyy-MM-dd)");

const status = z.enum(AttendanceStatus);
/** The longest note a mark on the register carries. */
export const ATTENDANCE_NOTES_MAX = 500;
const notes = z.string().trim().max(ATTENDANCE_NOTES_MAX);

/** POST /attendance — one pupil's day. */
export const createAttendanceSchema = z.object({
  studentId: z.uuid("ID siswa tidak valid"),
  classId: z.uuid("ID kelas tidak valid"),
  date: attendanceDay,
  status,
  notes: notes.optional(),
});

/**
 * POST /attendance/bulk — a class's day. Saving the same day again updates
 * the pupils already recorded: the form is how a register is corrected.
 */
export const bulkAttendanceSchema = z.object({
  classId: z.uuid("ID kelas tidak valid"),
  date: attendanceDay,
  records: z
    .array(
      z.object({
        studentId: z.uuid("ID siswa tidak valid"),
        status,
        notes: notes.optional(),
      }),
    )
    .min(1, "Minimal satu siswa")
    .max(200, "Maksimal 200 siswa sekali simpan"),
});

/** PATCH /attendance/:id */
export const updateAttendanceSchema = z.object({
  status: status.optional(),
  notes: notes.nullish(),
});

/** What POST /attendance/bulk did with the class's day. */
export interface BulkAttendanceResult {
  /** Pupils with no record for the day before. */
  created: number;
  /** Pupils whose record for the day was replaced. */
  updated: number;
}

/**
 * A class the caller records daily attendance for, and why:
 * `HOMEROOM` — its wali kelas; `TEACHER` — they have a lesson in it.
 */
export interface AttendanceRecorderClass {
  id: string;
  name: string;
  level?: string | null;
  unit: { id: string; name: string };
  academicYear: { id: string; name: string };
  as: "HOMEROOM" | "TEACHER";
}

/**
 * GET /attendance/me/classes — which classes the caller records:
 * `ALL` — any class (super admin); `UNIT` — any class of `unitId` (the unit's
 * admin unit); `ASSIGNED` — the classes listed, of the current academic year
 * (empty for someone who records none).
 */
export interface AttendanceRecorderScope {
  scope: "ALL" | "UNIT" | "ASSIGNED";
  unitId: string | null;
  classes: AttendanceRecorderClass[];
}

// ------------------------------------------------------------ follow-up

/**
 * Following up an unexplained absence (decisions/absensi-harian.md): the
 * wali kelas of a day pupil, or the musyrif of a santri mukim, contacts the
 * wali and records what came of it. The values are Prisma's
 * `AttendanceFollowUpChannel` and `AttendanceFollowUpOutcome`.
 */
export const ATTENDANCE_FOLLOW_UP_CHANNELS = [
  "PHONE",
  "WHATSAPP",
  "IN_PERSON",
  "OTHER",
] as const;
export type AttendanceFollowUpChannel =
  (typeof ATTENDANCE_FOLLOW_UP_CHANNELS)[number];

/**
 * ILL and EXCUSED give the reason — the mark becomes Sakit or Izin; NO_REASON
 * closes the absence as Alpa; UNREACHABLE leaves it open for another try.
 */
export const ATTENDANCE_FOLLOW_UP_OUTCOMES = [
  "ILL",
  "EXCUSED",
  "NO_REASON",
  "UNREACHABLE",
] as const;
export type AttendanceFollowUpOutcome =
  (typeof ATTENDANCE_FOLLOW_UP_OUTCOMES)[number];

/**
 * How far back an absence is still followed up: the reason should be on the
 * register within five working days (DfE, *Working together to improve school
 * attendance*, §42) — a calendar week.
 */
export const ATTENDANCE_FOLLOW_UP_WINDOW_DAYS = 7;

export const recordFollowUpSchema = z.object({
  channel: z.enum(ATTENDANCE_FOLLOW_UP_CHANNELS, {
    message: "Pilih cara menghubungi",
  }),
  outcome: z.enum(ATTENDANCE_FOLLOW_UP_OUTCOMES, {
    message: "Pilih hasilnya",
  }),
  note: z.string().trim().max(1000).optional(),
});
export type RecordFollowUpInput = z.infer<typeof recordFollowUpSchema>;

export interface AttendanceFollowUpEntry {
  id: string;
  channel: AttendanceFollowUpChannel;
  outcome: AttendanceFollowUpOutcome;
  note: string | null;
  at: string;
  by: { id: string; name: string };
}

/**
 * GET /attendance/follow-ups — one absence the caller is to follow up: marked
 * Alpa within the window, not yet explained or closed. `as` says why it is
 * theirs; `walis` are whom to contact.
 */
export interface AttendanceFollowUpItem {
  attendanceId: string;
  /** The calendar day, yyyy-MM-dd. */
  date: string;
  student: { id: string; name: string; nis: string | null };
  class: { id: string; name: string };
  as: "WALI_KELAS" | "MUSYRIF";
  /**
   * Linked wali accounts (`relation` father | mother | guardian), then the
   * contact given at enrolment (`relation` "contact") when it is not one of them.
   */
  walis: { name: string; phone: string | null; relation: string }[];
  followUps: AttendanceFollowUpEntry[];
}

/**
 * A pattern in a santri's attendance — the third tier of the follow-up
 * (decided 2026-09-28, decisions/absensi-harian.md). Absent means any absence,
 * Alpa, Sakit or Izin, as persistent absence is counted by the DfE (*Working
 * together to improve school attendance*, 2024) and chronic absence by
 * Attendance Works: a child misses the lesson whatever the reason, and
 * repeated illness is itself worth a look.
 */
export const ATTENDANCE_PATTERN_ABSENCE_RATE = 0.1;
/**
 * Days recorded this semester before the absence rate counts, so one absence
 * in the first week is not already 10%.
 */
export const ATTENDANCE_PATTERN_MIN_DAYS = 10;
/** Late this many times in the last `…_LATE_WINDOW_DAYS` calendar days. */
export const ATTENDANCE_PATTERN_LATE_COUNT = 3;
export const ATTENDANCE_PATTERN_LATE_WINDOW_DAYS = 30;

export const ATTENDANCE_PATTERN_KINDS = ["ABSENCE", "LATE"] as const;
export type AttendancePatternKind = (typeof ATTENDANCE_PATTERN_KINDS)[number];

/**
 * GET /attendance/patterns — a santri whose attendance shows a pattern now,
 * among those the caller is told about: the pupils of their homeroom classes,
 * the santri mukim they are musyrif of, and — for a guru BK — their unit's.
 */
export interface AttendancePatternItem {
  student: { id: string; name: string; nis: string | null };
  class: { id: string; name: string } | null;
  /** Why this santri is the caller's to know about. */
  as: ("WALI_KELAS" | "GURU_BK" | "MUSYRIF")[];
  kinds: AttendancePatternKind[];
  /** This semester, from its first day (yyyy-MM-dd) to today. */
  absence: {
    since: string;
    recordedDays: number;
    absentDays: number;
    alpa: number;
    sakit: number;
    izin: number;
  };
  /** Late marks in the last `ATTENDANCE_PATTERN_LATE_WINDOW_DAYS` days. */
  lateDays: number;
  /** When each pattern was first raised this semester, if it has been. */
  raisedAt: Partial<Record<AttendancePatternKind, string>>;
}
