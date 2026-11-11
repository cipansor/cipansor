import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";
import {
  Exam,
  ExamType,
  ExamStatus,
  Grade,
  GradeType,
  ReportCard,
  CreateExamInput,
  UpdateExamInput,
  CreateGradeInput,
  UpdateGradeInput,
  BulkCreateGradesInput,
  CreateReportCardInput,
  UpdateReportCardInput,
  ExamAnalyticsData,
} from "@cipansor/shared";

// Re-export constants for UI consumption
export { ExamType, ExamStatus, GradeType };

export const ASSESSMENT_TYPES: ExamType[] = [
  ExamType.DAILY_TEST,
  ExamType.QUIZ,
  ExamType.MIDTERM,
  ExamType.FINAL,
  ExamType.PRACTICAL,
  ExamType.PROJECT,
  ExamType.TAHFIDZ_TEST,
];

export const GRADE_TYPES: GradeType[] = [
  GradeType.EXAM,
  GradeType.ASSIGNMENT,
  GradeType.PARTICIPATION,
  GradeType.ATTENDANCE,
  GradeType.PROJECT,
  GradeType.TAHFIDZ,
];

export const ASSESSMENT_TYPE_LABELS: Record<ExamType, string> = {
  [ExamType.DAILY_TEST]: "Ulangan Harian",
  [ExamType.QUIZ]: "Kuis",
  [ExamType.MIDTERM]: "UTS",
  [ExamType.FINAL]: "UAS",
  [ExamType.PRACTICAL]: "Praktik",
  [ExamType.PROJECT]: "Proyek",
  [ExamType.TAHFIDZ_TEST]: "Ujian Tahfidz",
};

export const GRADE_TYPE_LABELS: Record<GradeType, string> = {
  [GradeType.EXAM]: "Ujian",
  [GradeType.ASSIGNMENT]: "Tugas",
  [GradeType.PARTICIPATION]: "Partisipasi",
  [GradeType.ATTENDANCE]: "Kehadiran",
  [GradeType.PROJECT]: "Proyek",
  [GradeType.TAHFIDZ]: "Tahfidz",
};

// UI specific types that might not be in shared or are composed
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

export interface StudentGradeSummary {
  studentId: string;
  studentName: string;
  nis: string;
  averageScore: number;
  totalExams: number;
  rank?: number;
  trend: "UP" | "DOWN" | "STABLE";
}

// Assessment (Exam) queries
export function useExams(params?: {
  classId?: string;
  subjectId?: string;
  teacherId?: string;
  type?: ExamType;
  academicYearId?: string;
  status?: ExamStatus;
  startDate?: string;
  endDate?: string;
  semester?: number;
}) {
  return useQuery({
    queryKey: ["exams", params],
    queryFn: async () => {
      const response = await api.get("/assessment/exams", { params });
      return response.data.data as Exam[];
    },
  });
}

export function useUnifiedRaport(
  studentId: string,
  academicYearId: string,
  semester: number,
) {
  return useQuery({
    queryKey: ["unified-raport", studentId, academicYearId, semester],
    queryFn: async () => {
      const response = await api.get(
        `/assessment/unified-raport/students/${studentId}`,
        {
          params: { academicYearId, semester },
        },
      );
      return response.data;
    },
    enabled: !!studentId && !!academicYearId && !!semester,
  });
}

export function useStudentHolisticAnalytics(
  studentId: string,
  academicYearId: string,
) {
  return useQuery({
    queryKey: ["student-holistic-analytics", studentId, academicYearId],
    queryFn: async () => {
      const response = await api.get(
        `/assessment/students/${studentId}/holistic`,
        {
          params: { academicYearId },
        },
      );
      return response.data.data;
    },
    enabled: !!studentId && !!academicYearId,
  });
}

export function useUnitEducationAnalytics(
  unitId: string,
  academicYearId: string,
) {
  return useQuery({
    queryKey: ["unit-education-analytics", unitId, academicYearId],
    queryFn: async () => {
      const response = await api.get(`/assessment/units/${unitId}/analytics`, {
        params: { academicYearId },
      });
      return response.data.data;
    },
    enabled: !!unitId && !!academicYearId,
  });
}

// Alias for backward compatibility or clarity
export const useAssessments = useExams;
export const useAssessment = useExam;
export const useAssessmentCreation = useCreateExam;
export const useUpdateAssessment = useUpdateExam;
export const useDeleteAssessment = useDeleteExam;
export const useSubmitGrades = useBulkCreateGrades;

export function useExam(id: string) {
  return useQuery({
    queryKey: ["exam", id],
    queryFn: async () => {
      const response = await api.get(`/assessment/exams/${id}`);
      return response.data.data as Exam;
    },
    enabled: !!id,
  });
}

export function useExamAnalytics(id: string) {
  return useQuery({
    queryKey: ["exam-analytics", id],
    queryFn: async () => {
      const response = await api.get(`/assessment/exams/${id}/analytics`);
      return response.data.data as ExamAnalyticsData;
    },
    enabled: !!id,
  });
}

export function useCreateExam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateExamInput) => {
      const response = await api.post("/assessment/exams", data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exams"] });
    },
  });
}

/**
 * After an exam changes: its list, and its own detail and analytics. The
 * detail page reads `["exam", id]`, which `["exams"]` does not cover, so it
 * kept showing "Draft" and the Publish button after a successful publish.
 */
function invalidateExam(
  queryClient: ReturnType<typeof useQueryClient>,
  id: string,
) {
  queryClient.invalidateQueries({ queryKey: ["exams"] });
  queryClient.invalidateQueries({ queryKey: ["exam", id] });
  queryClient.invalidateQueries({ queryKey: ["exam-analytics", id] });
}

export function useUpdateExam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateExamInput }) => {
      const response = await api.patch(`/assessment/exams/${id}`, data);
      return response.data.data;
    },
    onSuccess: (_data, { id }) => invalidateExam(queryClient, id),
  });
}

export function useUpdateExamStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: ExamStatus }) => {
      const response = await api.patch(`/assessment/exams/${id}/status`, {
        status,
      });
      return response.data.data;
    },
    onSuccess: (_data, { id }) => invalidateExam(queryClient, id),
  });
}

export function useDeleteExam() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/assessment/exams/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exams"] });
    },
  });
}

/**
 * Publishing takes an exam out of DRAFT: a status change like any other, on
 * the API's one route for them.
 */
export function usePublishExam() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.patch(`/assessment/exams/${id}/status`, {
        status: ExamStatus.SCHEDULED,
      });
      return response.data.data;
    },
    onSuccess: (_data, id) => invalidateExam(queryClient, id),
  });
}

export type AssessmentType = ExamType;
export const usePublishAssessment = usePublishExam;

// Grade queries
export function useGrades(params: {
  examId?: string;
  studentId?: string;
  subjectId?: string;
  academicYearId?: string;
  type?: GradeType;
}) {
  return useQuery({
    queryKey: ["grades", params],
    queryFn: async () => {
      const response = await api.get("/assessment/grades", { params });
      return response.data.data as Grade[];
    },
  });
}

export function useStudentGrades(studentId: string, academicYearId?: string) {
  return useQuery({
    queryKey: ["student-grades", studentId, academicYearId],
    queryFn: async () => {
      const response = await api.get(
        `/assessment/grades/student/${studentId}`,
        {
          params: { academicYearId },
        },
      );
      return response.data.data as Grade[];
    },
    enabled: !!studentId,
  });
}

export function useExamGrades(examId: string) {
  return useQuery({
    queryKey: ["exam-grades", examId],
    queryFn: async () => {
      const response = await api.get(`/assessment/grades/exam/${examId}`);
      return response.data.data as Grade[];
    },
    enabled: !!examId,
  });
}

export function useCreateGrade() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateGradeInput) => {
      const response = await api.post("/assessment/grades", data);
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["grades"] });
      if (variables.examId) {
        queryClient.invalidateQueries({
          queryKey: ["exam-analytics", variables.examId],
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ["exam-analytics"] });
      }
    },
  });
}

export function useBulkCreateGrades() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: BulkCreateGradesInput) => {
      const response = await api.post("/assessment/grades/bulk", data);
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["grades"] });
      if (variables.examId) {
        queryClient.invalidateQueries({
          queryKey: ["exam-grades", variables.examId],
        });
        queryClient.invalidateQueries({
          queryKey: ["exam-analytics", variables.examId],
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ["exam-analytics"] });
      }
    },
  });
}

export function useUpdateGrade() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateGradeInput;
    }) => {
      const response = await api.patch(`/assessment/grades/${id}`, data);
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["grades"] });
      if (variables.data.examId) {
        queryClient.invalidateQueries({
          queryKey: ["exam-analytics", variables.data.examId],
        });
      } else {
        queryClient.invalidateQueries({ queryKey: ["exam-analytics"] });
      }
    },
  });
}

export function useDeleteGrade() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/assessment/grades/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grades"] });
      queryClient.invalidateQueries({ queryKey: ["exam-analytics"] });
    },
  });
}

// Report Card queries
export function useReportCards(params?: {
  classId?: string;
  academicYearId?: string;
  semester?: number;
  isPublished?: boolean;
}) {
  return useQuery({
    queryKey: ["report-cards", params],
    queryFn: async () => {
      const response = await api.get("/assessment/report-cards", { params });
      return response.data.data as ReportCard[];
    },
  });
}

export function useReportCard(id: string) {
  return useQuery({
    queryKey: ["report-card", id],
    queryFn: async () => {
      const response = await api.get(`/assessment/report-cards/${id}`);
      return response.data.data as ReportCard;
    },
    enabled: !!id,
  });
}

export function useCreateReportCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateReportCardInput) => {
      const response = await api.post("/assessment/report-cards", data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-cards"] });
    },
  });
}

export function useUpdateReportCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateReportCardInput;
    }) => {
      const response = await api.patch(`/assessment/report-cards/${id}`, data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-cards"] });
    },
  });
}

export function useGenerateReportCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      studentId: string;
      classId: string;
      academicYearId: string;
      semester: number;
    }) => {
      const response = await api.post(
        "/assessment/report-cards/generate",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-cards"] });
    },
  });
}

export function useGenerateReportCards() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      classId: string;
      academicYearId: string;
      semester: number;
      options?: {
        includeAttendance: boolean;
        includeTahfidz: boolean;
        includeExtracurricular: boolean;
      };
    }) => {
      const response = await api.post(
        "/assessment/report-cards/generate",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-cards"] });
    },
  });
}

export function usePublishReportCard() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.patch(
        `/assessment/report-cards/${id}/publish`,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-cards"] });
    },
  });
}

export function usePublishReportCards() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(
        ids.map((id) => api.patch(`/assessment/report-cards/${id}/publish`)),
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["report-cards"] });
    },
  });
}
