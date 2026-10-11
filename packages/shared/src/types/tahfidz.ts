import { Student } from "./models";

export type TahfidzActivityType =
  "ZIYADAH" | "MUROJAAH" | "TASMI" | "ASSESSMENT";

export type TahfidzGrade =
  "MUMTAZ" | "JAYYID_JIDDAN" | "JAYYID" | "MAQBUL" | "RASIB";

export interface TahfidzRecord {
  id: string;
  studentId: string;
  activityType: TahfidzActivityType;
  surahNumber: number;
  surahName: string;
  ayahStart: number;
  ayahEnd: number;
  juz: number;
  totalAyah: number;
  score?: number | null;
  grade?: string | null; // For compatibility if needed, though not in schema
  notes?: string | null;
  audioUrl?: string | null; // E-Simaan recording
  recordedAt: string | Date;
  recordedById: string;
  createdAt: string | Date;
  updatedAt: string | Date;

  // Relations
  student?: Student & {
    user?: {
      id: string;
      name: string;
    };
    unit?: {
      id: string;
      name: string;
    };
  };
  recordedBy?: {
    id: string;
    name: string;
  };
}

export interface TahfidzDashboardStats {
  totalRecords: number;
  totalStudents: number;
  recordsByType: {
    type: string;
    count: number;
  }[];
  recordsByGrade: {
    grade: string;
    count: number;
  }[];
  progressByJuz: {
    juz: number;
    studentCount: number;
    completedCount: number;
  }[];
  monthlyActivity: {
    month: string;
    setoran: number;
    murajaah: number;
    tasmi: number;
  }[];
  topStudents: {
    studentId: string;
    studentName: string;
    nis: string;
    totalAyah: number;
    completedJuz: number;
  }[];
  recentRecords: TahfidzRecord[];
}

export interface TahfidzStudentSummary {
  student: Student & {
    user?: { id: string; name: string };
    unit?: { id: string; name: string };
  };
  summary: {
    totalRecords: number;
    totalAyahMemorized: number;
    juzCoveredCount: number;
    surahCoveredCount: number;
    averageScore: number | null;
  };
  byActivity: {
    type: string;
    count: number;
    totalAyah: number;
  }[];
  juzCovered: number[];
  surahCovered: {
    surahNumber: number;
    surahName: string;
  }[];
  recentRecords: TahfidzRecord[];
  estimation?: TahfidzCompletionEstimate;
}

/** Projection of when a student finishes 30 juz, based on observed pace. */
export interface TahfidzCompletionEstimate {
  status: "COMPLETED" | "INSUFFICIENT_DATA" | "PROJECTED";
  totalAyahMemorized: number;
  remainingAyah: number;
  ayahPerDay: number | null;
  estimatedDays: number | null;
  estimatedDate: string | Date | null;
  recordsInWindow: number;
}

export interface CreateTahfidzInput {
  studentId: string;
  activityType: TahfidzActivityType;
  surahNumber: number;
  surahName: string;
  ayahStart: number;
  ayahEnd: number;
  juz: number;
  totalAyah?: number;
  score?: number | null;
  notes?: string;
  audioUrl?: string;
  recordedAt?: Date | string;
}

export interface UpdateTahfidzInput {
  activityType?: TahfidzActivityType;
  surahNumber?: number;
  surahName?: string;
  ayahStart?: number;
  ayahEnd?: number;
  juz?: number;
  totalAyah?: number;
  score?: number | null;
  notes?: string | null;
}

export interface GenerateCertificateInput {
  studentId: string;
  certificateType: string;
  issueDate?: Date | string;
  grade?: string;
  qiraahType?: string;
  musyrifName?: string;
  sanadChain?: string;
  notes?: string;
  completedJuz?: number[];
}

export type QuranSurahStatus = "MEMORIZED" | "IN_PROGRESS" | "NOT_STARTED";

export interface QuranSurahProgress {
  surahNumber: number;
  surahName: string;
  status: QuranSurahStatus;
  strength?: number; // 0-100 score based on murojaah
  lastReview?: string | Date;
}

export interface QuranProgressMap {
  studentId: string;
  surahs: QuranSurahProgress[]; // 114 entries
  stats: {
    totalMemorized: number;
    totalInProgress: number;
    totalNotStarted: number;
    percentage: number;
  };
}
