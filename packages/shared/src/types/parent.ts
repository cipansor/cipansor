import { Attendance } from "./attendance";
import { TahfidzRecord } from "./tahfidz";

/**
 * A child as `GET /parent/children` actually returns it.
 *
 * The API flattens the `StudentParent` join and — importantly — sets `id` to the
 * *student's* id, because every downstream route is `/parent/children/{studentId}/…`.
 * It is also the `child` field of each `GET /parent/dashboard` summary.
 */
export interface ParentChild {
  /** The student's id — not the parent-child link id. */
  id: string;
  nis: string;
  nisn?: string | null;
  name: string;
  gender: "MALE" | "FEMALE";
  birthPlace?: string | null;
  /** A `Date` from the API; an ISO string once serialised to JSON. */
  birthDate?: Date | string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  photoUrl?: string | null;
  status: string;
  relation: string;
  isPrimary: boolean;
  unitId: string;
  unit?: {
    id: string;
    name: string;
    type: string;
  } | null;
  currentClass?: {
    id: string;
    name: string;
    level: string;
    academicYear?: { id: string; name: string; isActive: boolean };
    /** `user.id` is the messaging recipient — the Teacher id is not a User id. */
    homeroomTeacher?: { id: string; user: { id: string; name: string } } | null;
  } | null;
}

/**
 * One entry of `GET /parent/dashboard`'s `children` array.
 *
 * The shape is canonical (decision K13, issue #869): the wali's home page reads
 * it as-is. `holisticScore` and `boardingHarmonyScore` are `null` when no query
 * produced them — a screen must show no tile then, never a fabricated `0`. The
 * attendance is the last seven rows, not a pre-computed percentage.
 */
export interface ParentDashboardChildSummary {
  child: ParentChild;
  /** The last seven attendance rows (newest first). */
  recentAttendance: Attendance[];
  pendingInvoices: number;
  activePermits: number;
  lastTahfidz: TahfidzRecord | null;
  holisticScore: number | null;
  holisticInterpretation: string | null;
  boardingHarmonyScore: number | null;
}

export interface ParentDashboardAnnouncement {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  /** 0 = normal, 1 = important, 2 = urgent. */
  priority: number;
}

/** `GET /parent/dashboard` — the wali's home page payload. */
export interface ParentDashboardData {
  children: ParentDashboardChildSummary[];
  unreadNotifications: number;
  recentAnnouncements: ParentDashboardAnnouncement[];
}
