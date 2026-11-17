import { z } from "zod";
import {
  ADMIN_ROLE_CODES,
  PESANTREN_EDUCATOR_ROLE_CODES,
  PRINCIPAL_ROLE_CODES,
  SCHOOL_TEACHER_ROLE_CODES,
} from "../roles";

/**
 * Wali kelas — the homeroom teacher of a class, `Class.homeroomTeacherId`.
 * It is a duty of a guru for one class in one academic year, not a role
 * (decided 2026-09-26, `.claude/memory/decisions/peran-dan-tugas-tambahan.md`).
 *
 * Who reaches the homeroom routes at all: teachers — whether a teacher is the
 * wali kelas of a class is decided per class by the API — and the unit's
 * kepala sekolah and admin unit, who read. The yayasan organs, tata usaha,
 * bendahara, students and wali are not here.
 */
export const HOMEROOM_ROUTE_ROLE_CODES: readonly string[] = [
  ...SCHOOL_TEACHER_ROLE_CODES,
  ...PESANTREN_EDUCATOR_ROLE_CODES,
  ...PRINCIPAL_ROLE_CODES,
  ...ADMIN_ROLE_CODES,
];

/**
 * What an account may do with one class's homeroom data:
 * - `HOMEROOM` — the class's wali kelas: reads, and writes notes while the
 *   class's academic year is the current one;
 * - `OVERSEER` — the kepala sekolah and the class's admin unit, and
 *   the super admin: read.
 * Anyone else does not reach the class (404).
 */
export type HomeroomAccess = "HOMEROOM" | "OVERSEER";

/** How the caller stands towards a class, sent with its homeroom data. */
export interface HomeroomViewer {
  access: HomeroomAccess;
  /** The wali kelas, in the current academic year. */
  canWrite: boolean;
}

/** One class the caller is wali kelas of (GET /homeroom/my-classes). */
export interface MyHomeroomClass {
  id: string;
  name: string;
  level?: string | null;
  unit: { id: string; name: string };
  academicYear: { id: string; name: string };
  /** Today falls inside the class's academic year. */
  isCurrent: boolean;
  _count?: { enrollments: number };
}

/**
 * A wali kelas's note on a pupil (POST /homeroom/notes, /homeroom/behavior).
 * `POSITIVE` is stored as a reward, `NEGATIVE` as a minor violation — an
 * observation with no points: a sanction and its points are the kesiswaan's,
 * in the violations module.
 */
export const homeroomNoteSchema = z
  .object({
    studentId: z.uuid("ID siswa tidak valid"),
    type: z.enum(["POSITIVE", "NEGATIVE"]),
    /** A short note; `description` is the longer form. One of the two is the note. */
    title: z.string().trim().max(200).optional(),
    description: z.string().trim().max(2000).optional(),
    category: z.string().trim().max(100).optional(),
    /** What was done about it — kept with a NEGATIVE note (`Violation.action`). */
    action: z.string().trim().max(500).optional(),
  })
  .refine((note) => !!(note.description || note.title), {
    message: "Isi catatan wajib diisi",
    path: ["description"],
  });
export type HomeroomNoteInput = z.infer<typeof homeroomNoteSchema>;

/** PUT /homeroom/notes/:noteId */
export const updateHomeroomNoteSchema = z.object({
  noteType: z.enum(["violation", "reward"]).optional(),
  description: z.string().trim().min(1).max(2000).optional(),
  category: z.string().trim().max(100).optional(),
});

/** One note in a class's list (GET /homeroom/behavior?classId=…). */
export interface HomeroomNote {
  id: string;
  /** Where it is stored: a reward (positive) or a violation (needs attention). */
  kind: "reward" | "violation";
  student: {
    id: string;
    nis: string;
    user: { name: string };
  };
  category: string;
  description: string;
  action: string | null;
  /** When it happened (occurredAt / givenAt). */
  at: string;
  author: { id: string; name: string } | null;
  /** The caller wrote it and still writes for this class: they may change or remove it. */
  canChange: boolean;
}
