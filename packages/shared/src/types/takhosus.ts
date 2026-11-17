// Takhosus Shared Types

import type { SimaanGradeCode, SimaanTypeCode } from "../schemas/simaan";

export interface Halaqoh {
  id: string;
  unitId: string;
  unit?: { id: string; name: string };
  name: string;
  code: string;
  teacherId: string;
  teacher?: { id: string; name: string; email?: string };
  level: number;
  capacity: number;
  scheduleDay: string[];
  scheduleTime?: string | null;
  location?: string | null;
  description?: string | null;
  isActive: boolean;
  studentCount?: number;
  maxStudents?: number; // Virtual field
  createdAt: Date;
  updatedAt: Date;
}

export interface TakhosusEnrollment {
  id: string;
  studentId: string;
  student?: {
    id: string;
    user: { id: string; name: string };
    unit?: { id: string; name: string };
  };
  halaqohId?: string | null;
  halaqoh?: {
    id: string;
    name: string;
    code?: string;
    teacher?: { id: string; name: string };
  };
  enrolledAt: Date;
  status: "ACTIVE" | "COMPLETED" | "DROPPED" | "SUSPENDED";
  targetJuz: number;
  targetCompletionDate?: Date | null;
  completedAt?: Date | null;
  completedJuz: number;
  currentJuz: number;
  notes?: string | null;
  sanadRecords?: SanadRecord[];
  sanadCount?: number;
  progressPercentage?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SanadRecord {
  id: string;
  enrollmentId: string;
  enrollment?: TakhosusEnrollment;
  teacherId: string;
  teacher?: { id: string; name: string; email?: string };
  juz: number;
  surahStart?: number | null;
  surahEnd?: number | null;
  certifiedAt: Date;
  grade?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MurojaahRecord {
  id: string;
  studentId: string;
  student?: { id: string; user: { name: string } };
  enrollmentId?: string | null;
  halaqohId?: string | null;
  halaqoh?: { id: string; name: string };
  recordedById: string;
  recordedBy?: { id: string; name: string };
  murojaahType: "YAUMIYAH" | "USBUIYAH" | "SYAHRIYAH" | "TASMI";
  murojaahDate: Date;
  juzStart: number;
  juzEnd: number;
  pagesReviewed: number;
  durationMinutes: number;
  qualityScore: number;
  mistakeCount: number;
  fluencyLevel: number;
  tajwidScore?: number | null;
  notes?: string | null;
  mistakes?: MurojaahMistake[];
  createdAt: Date;
  updatedAt: Date;
}

export interface MurojaahMistake {
  id: string;
  murojaahId: string;
  mistakeType: "LAHIN_JALI" | "LAHIN_KHAFI" | "TAJWID" | "LUPA" | "URUTAN";
  juz: number;
  surahNumber: number;
  ayahNumber?: number | null;
  description?: string | null;
  createdAt: Date;
}

export interface SimaanExam {
  id: string;
  studentId: string;
  student?: { id: string; user: { name: string } };
  enrollmentId?: string | null;
  halaqohId?: string | null;
  halaqoh?: { id: string; name: string };
  simaanType: SimaanTypeCode;
  examDate: Date;
  sessionNumber: number;
  totalSessions: number;
  juzStart: number;
  juzEnd: number;
  overallScore?: number | null;
  tajwidScore?: number | null;
  fashohaScore?: number | null;
  tartilScore?: number | null;
  grade?: SimaanGradeCode | null;
  passed: boolean;
  notes?: string | null;
  recommendations?: string | null;
  examiners?: SimaanExaminer[];
  createdAt: Date;
  updatedAt: Date;
}

export interface SimaanExaminer {
  id: string;
  simaanId: string;
  examinerId: string;
  examiner?: { id: string; name: string };
  score?: number | null;
  notes?: string | null;
  createdAt: Date;
}

export interface TakhosusDashboardStats {
  total: number;
  active: number;
  completed: number;
  dropped: number;
  averageProgress: number;
  atRiskCount: number;
  juzDistribution: { juz: number; count: number }[];
}

export interface StudentProgress {
  enrollment: TakhosusEnrollment;
  student: {
    id: string;
    user: { id: string; name: string };
  };
  halaqoh?: {
    id: string;
    name: string;
    teacher: { id: string; name: string };
  };
  juzProgress: {
    juz: number;
    certified: boolean;
    certifiedAt?: Date;
    grade?: string | null;
    teacherName?: string;
  }[];
  recentActivity: {
    id: string;
    type: string;
    surah: string;
    ayahStart: number;
    ayahEnd: number;
    juz: number;
    score?: number | null;
    recordedAt: Date;
  }[];
  recentSimaan: SimaanExam[];
}
