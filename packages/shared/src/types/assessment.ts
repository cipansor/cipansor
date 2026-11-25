export function calculateLetterGrade(percentage: number): string {
  if (percentage >= 90) return "A";
  if (percentage >= 80) return "B";
  if (percentage >= 70) return "C";
  if (percentage >= 60) return "D";
  return "E";
}

export enum ExamType {
  DAILY_TEST = "DAILY_TEST",
  QUIZ = "QUIZ",
  MIDTERM = "MIDTERM",
  FINAL = "FINAL",
  PRACTICAL = "PRACTICAL",
  PROJECT = "PROJECT",
  TAHFIDZ_TEST = "TAHFIDZ_TEST",
}

export enum ExamStatus {
  DRAFT = "DRAFT",
  SCHEDULED = "SCHEDULED",
  ONGOING = "ONGOING",
  COMPLETED = "COMPLETED",
  GRADED = "GRADED",
}

export enum GradeType {
  EXAM = "EXAM",
  ASSIGNMENT = "ASSIGNMENT",
  PARTICIPATION = "PARTICIPATION",
  ATTENDANCE = "ATTENDANCE",
  PROJECT = "PROJECT",
  TAHFIDZ = "TAHFIDZ",
}

export enum QuestionType {
  MULTIPLE_CHOICE = "MULTIPLE_CHOICE",
  ESSAY = "ESSAY",
  TRUE_FALSE = "TRUE_FALSE",
}

export interface Question {
  id: string;
  bankId?: string;
  type: QuestionType;
  content: string;
  options?: any;
  answerKey?: any;
  explanation?: string;
  points: number;
  order: number;
}

export interface QuestionBank {
  id: string;
  unitId?: string;
  teacherId?: string;
  subjectId?: string;
  title: string;
  description?: string;
  isActive?: boolean;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  teacherRel?: { user: { name: string } };
  subject?: { name: string; code: string };
  questions?: Question[];
  _count?: { questions: number; exams?: number };
}

export interface Exam {
  id: string;
  unitId: string;
  academicYearId: string;
  subjectId: string;
  classId: string;
  teacherId: string;
  type: ExamType;
  title: string;
  semester?: number;
  description?: string;
  scheduledAt: Date | string;
  duration: number;
  maxScore: number;
  passingScore: number;
  weight: number;
  instructions?: string;
  status: ExamStatus;
  createdAt: Date | string;
  updatedAt: Date | string;

  // Relations
  subject?: { id: string; name: string; code: string };
  class?: { id: string; name: string; level: string };
  teacher?: { id: string; user: { id: string; name: string | null } };
  academicYear?: { id: string; name: string };
  questionBank?: QuestionBank;
  grades?: Grade[];
  _count?: { grades: number };
}

export interface CreateExamInput {
  unitId: string;
  academicYearId: string;
  subjectId: string;
  classId: string;
  teacherId: string;
  type: ExamType | string;
  title: string;
  semester?: number;
  description?: string;
  scheduledAt: string | Date;
  duration?: number;
  maxScore?: number;
  passingScore?: number;
  weight?: number;
  instructions?: string;
}

export interface UpdateExamInput extends Partial<CreateExamInput> {
  status?: ExamStatus | string;
}

export interface Grade {
  id: string;
  studentId: string;
  subjectId: string;
  examId?: string | null;
  academicYearId: string;
  type: GradeType;
  score: number;
  maxScore: number;
  percentage: number;
  letterGrade: string;
  notes?: string;
  gradedById: string;
  gradedAt: Date | string;
  createdAt: Date | string;
  updatedAt: Date | string;

  // Relations
  student?: {
    id: string;
    nis: string | null;
    user?: { id: string; name: string | null };
  };
  subject?: { id: string; name: string; code: string };
  exam?: { id: string; title: string; type: ExamType };
  gradedBy?: { id: string; name: string | null };
}

export interface CreateGradeInput {
  studentId: string;
  subjectId: string;
  examId?: string;
  academicYearId: string;
  type: GradeType | string;
  score: number;
  maxScore?: number;
  notes?: string;
  gradedById: string;
}

export interface UpdateGradeInput extends Partial<CreateGradeInput> {}

export interface BulkCreateGradesInput {
  examId?: string;
  subjectId: string;
  academicYearId: string;
  type: GradeType | string;
  maxScore?: number;
  gradedById: string;
  grades: {
    studentId: string;
    score: number;
    notes?: string;
  }[];
}

export interface ReportCardDetail {
  id: string;
  reportCardId: string;
  subjectId?: string;
  subjectName: string;
  subject?: { id: string; name: string };
  knowledgeScore?: number | null;
  skillScore?: number | null;
  dailyScore?: number | null;
  midtermScore?: number | null;
  finalScore?: number | null;
  averageScore?: number | null;
  letterGrade?: string | null;
  comments?: string;
  notes?: string;
}

export interface ReportCard {
  id: string;
  studentId: string;
  classId: string;
  academicYearId: string;
  semester: number;
  averageScore?: number | null;
  rank?: number | null;
  totalStudents?: number | null;
  attendance?: {
    present: number;
    absent: number;
    sick: number;
    excused: number;
    permitted?: number;
  };
  tahfidzSummary?: {
    lastJuz: number;
    lastSurah: string;
    totalAyah: number;
  };
  teacherNotes?: string;
  principalNotes?: string;
  isPublished: boolean;
  publishedAt?: Date | string | null;
  printedAt?: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;

  // Relations
  student?: {
    id: string;
    nis: string | null;
    nisn?: string | null;
    user?: { id: string; name: string | null };
  };
  class?: {
    id: string;
    name: string;
    level: string;
    /** The unit that issues the rapor: the class's, that academic year. */
    unitId?: string;
    /** The wali kelas (`Class.homeroomTeacherId`). */
    teacher?: { id: string; name: string | null };
  };
  academicYear?: { id: string; name: string };
  details?: ReportCardDetail[];
  subjects?: ReportCardDetail[];
}

export interface CreateReportCardInput {
  studentId: string;
  classId: string;
  academicYearId: string;
  semester: number;
  teacherNotes?: string;
  principalNotes?: string;
}

export interface UpdateReportCardInput extends Partial<CreateReportCardInput> {
  isPublished?: boolean;
}

export interface GradeStats {
  examId: string;
  totalStudents: number;
  gradedCount: number;
  averageScore: number;
  highestScore: number;
  lowestScore: number;
  passCount: number;
  failCount: number;
  passRate: number;
}

export interface ScoreDistribution {
  range: string;
  count: number;
}

export interface ExamAnalyticsData extends GradeStats {
  scoreDistribution: ScoreDistribution[];
  topStudents: {
    studentId: string;
    studentName: string;
    score: number;
  }[];
}

export interface ExamAnswer {
  id: string;
  attemptId: string;
  questionId: string;
  answer?: unknown;
  isCorrect?: boolean | null;
  score?: number | null;
  createdAt?: string | Date;
}

/**
 * Every anti-cheat / exam-integrity event the system records.
 *
 * A `const` tuple rather than a TypeScript enum, because this one list has to
 * serve three consumers at once: `z.enum()` at the API boundary (which needs a
 * tuple), the writers in the service, and the `exam_security_logs.type` CHECK
 * constraint in the database. A sync test
 * (`apps/api/src/modules/cbt/tests/security-event-types-sync.test.ts`) reads the
 * migration SQL and fails if the constraint and this list drift apart — the shape
 * of bug this repo keeps finding, where one fact is written in two places with no
 * type between them.
 *
 * COPY and PASTE are deliberately separate events rather than one COPY_PASTE:
 * pasting INTO the exam suggests outside help, copying OUT suggests the paper is
 * leaking. Collapsing them throws away the distinction an invigilator needs.
 */
export const SECURITY_EVENT_TYPES = [
  "TAB_SWITCH",
  "FOCUS_LOST",
  "COPY",
  "PASTE",
  "RIGHT_CLICK",
  "FULLSCREEN_EXIT",
  "DEV_TOOLS",
  /** The clock closed the paper; the student did not press Kumpulkan. */
  "TIME_EXPIRED_AUTO_SUBMIT",
] as const;

export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

export interface ExamSecurityLog {
  id: string;
  attemptId: string;
  type: SecurityEventType | string;
  /**
   * Structured payload (JSONB). Client-reported events carry `{ note }`; events
   * the server raises carry their own fields, e.g. the exam duration and grace
   * period the clock used.
   */
  details?: Record<string, unknown> | null;
  createdAt: string | Date;
}

export interface ExamAttempt {
  id: string;
  examId: string;
  studentId: string;
  startedAt: string | Date;
  finishedAt?: string | Date | null;
  score?: number | null;
  status: ExamStatus | string;
  tabSwitchCount?: number;
  securityLogs?: ExamSecurityLog[];
  createdAt?: string | Date;
  updatedAt?: string | Date;
  exam?: Exam;
  answers?: ExamAnswer[];
}

export interface AssessmentStudentItem {
  id: string;
  nis: string;
  user?: { name?: string | null };
}

export interface AssessmentAcademicYearItem {
  id: string;
  name: string;
}

export interface VerificationResponse {
  valid: boolean;
  expired?: boolean;
  message: string;
  studentId?: string;
  nis?: string;
  student?: {
    id: string;
    nis: string;
    name: string;
    photoUrl?: string | null;
    unit: string;
    unitType?: string | null;
    currentClass: string;
    academicYear: string;
  } | null;
  cardData?: {
    nis: string;
    nisn?: string;
    studentName: string;
    unitName: string;
    className?: string;
    issueDate?: string;
  };
}

export interface RaportMerdekaPdfData {
  siswa: {
    nama: string;
    nis: string;
    nisn?: string | null;
    kelas: string;
    unit: string;
    unitType?: string | null;
    fase?: string | null;
  };
  tahunAjaran: {
    tahun: string;
    semester: number;
    semesterLabel: string;
  };
  waliKelas: {
    nama: string;
    nip?: string | null;
  };
  pimpinanUnit?: {
    nama: string;
    jabatan?: string | null;
    nip?: string | null;
  };
  intrakurikuler: {
    kelompokUmum: Array<{
      subjectName: string;
      nilaiAkhir: number;
      predikat: string;
      levelCapaian: string;
      deskripsi: string;
    }>;
    kelompokPesantren: Array<{
      subjectName: string;
      nilaiAkhir: number;
      predikat: string;
      levelCapaian: string;
      deskripsi: string;
    }>;
  };
  projekP5?: Array<{
    tema: string;
    judul: string;
    deskripsiProyek?: string;
    dimensiTerkait?: Array<{
      dimensiName: string;
      capaian?: string;
      deskripsi?: string;
    }>;
  }>;
  ekstrakurikuler?: Array<{
    nama: string;
    predikat: string;
    keterangan: string;
  }>;
  tahfidz?: {
    totalJuz?: number;
    targetCapaian?: string;
    surahTerakhir?: string;
    statusCapaian?: string;
    catatan?: string;
  };
  kehadiran?: {
    hadir?: number;
    sakit?: number;
    izin?: number;
    alpa?: number;
  };
  catatanWaliKelas?: string;
  tanggalCetak?: string;
}
