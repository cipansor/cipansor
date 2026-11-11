import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { ApiResponse, PaginatedResponse } from "@/lib/api";
import {
  RaportMerdekaPdfData,
  AssessmentStudentItem,
  AssessmentAcademicYearItem,
} from "@cipansor/shared";

// ==================== CONSTANTS ====================

export const LEARNING_PHASE_CODES = [
  {
    value: "FASE_A",
    label: "Fase A (PAUD - Kelas 2 SD)",
    startGrade: 0,
    endGrade: 2,
  },
  {
    value: "FASE_B",
    label: "Fase B (Kelas 3 - 4 SD)",
    startGrade: 3,
    endGrade: 4,
  },
  {
    value: "FASE_C",
    label: "Fase C (Kelas 5 - 6 SD)",
    startGrade: 5,
    endGrade: 6,
  },
  {
    value: "FASE_D",
    label: "Fase D (Kelas 7 - 9 SMP)",
    startGrade: 7,
    endGrade: 9,
  },
  {
    value: "FASE_E",
    label: "Fase E (Kelas 10 SMA)",
    startGrade: 10,
    endGrade: 10,
  },
  {
    value: "FASE_F",
    label: "Fase F (Kelas 11 - 12 SMA)",
    startGrade: 11,
    endGrade: 12,
  },
] as const;

export const P5_DIMENSIONS = [
  {
    value: "BERIMAN",
    label: "Beriman, Bertakwa kepada Tuhan YME, dan Berakhlak Mulia",
    color: "bg-emerald-100 text-emerald-800",
  },
  {
    value: "BERKEBINEKAAN",
    label: "Berkebinekaan Global",
    color: "bg-blue-100 text-blue-800",
  },
  {
    value: "BERGOTONG_ROYONG",
    label: "Bergotong Royong",
    color: "bg-orange-100 text-orange-800",
  },
  {
    value: "MANDIRI",
    label: "Mandiri",
    color: "bg-purple-100 text-purple-800",
  },
  {
    value: "BERNALAR_KRITIS",
    label: "Bernalar Kritis",
    color: "bg-red-100 text-red-800",
  },
  { value: "KREATIF", label: "Kreatif", color: "bg-pink-100 text-pink-800" },
] as const;

export const P5_GRADES = [
  { value: "BB", label: "Belum Berkembang", color: "bg-red-100 text-red-800" },
  {
    value: "MB",
    label: "Mulai Berkembang",
    color: "bg-yellow-100 text-yellow-800",
  },
  {
    value: "BSH",
    label: "Berkembang Sesuai Harapan",
    color: "bg-blue-100 text-blue-800",
  },
  {
    value: "SB",
    label: "Sangat Berkembang",
    color: "bg-green-100 text-green-800",
  },
] as const;

export const ASSESSMENT_CATEGORIES = [
  {
    value: "DIAGNOSTIK",
    label: "Diagnostik",
    color: "bg-purple-100 text-purple-800",
  },
  { value: "FORMATIF", label: "Formatif", color: "bg-blue-100 text-blue-800" },
  { value: "SUMATIF", label: "Sumatif", color: "bg-green-100 text-green-800" },
] as const;

export const PROJECT_STATUSES = [
  { value: "DRAFT", label: "Draft", color: "bg-gray-100 text-gray-800" },
  { value: "ACTIVE", label: "Aktif", color: "bg-green-100 text-green-800" },
  { value: "COMPLETED", label: "Selesai", color: "bg-blue-100 text-blue-800" },
] as const;

// Legacy P5 themes (for backward compatibility)
export const P5_THEMES = [
  { value: "GAYA_HIDUP_BERKELANJUTAN", label: "Gaya Hidup Berkelanjutan" },
  { value: "KEARIFAN_LOKAL", label: "Kearifan Lokal" },
  { value: "BHINNEKA_TUNGGAL_IKA", label: "Bhinneka Tunggal Ika" },
  { value: "BANGUNLAH_JIWA_RAGANYA", label: "Bangunlah Jiwa dan Raganya" },
  { value: "SUARA_DEMOKRASI", label: "Suara Demokrasi" },
  {
    value: "BEREKAYASA_BERTEKNOLOGI",
    label: "Berekayasa dan Berteknologi untuk Membangun NKRI",
  },
  { value: "KEWIRAUSAHAAN", label: "Kewirausahaan" },
] as const;

export type LearningPhaseCode = (typeof LEARNING_PHASE_CODES)[number]["value"];
export type P5DimensionCode = (typeof P5_DIMENSIONS)[number]["value"];
export type P5Grade = (typeof P5_GRADES)[number]["value"];
export type AssessmentCategory =
  (typeof ASSESSMENT_CATEGORIES)[number]["value"];
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]["value"];
export type P5Theme = (typeof P5_THEMES)[number]["value"];

// ==================== TYPES ====================

export interface LearningPhase {
  id: string;
  code: LearningPhaseCode;
  name: string;
  description?: string;
  gradeRange: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    learningOutcomes: number;
  };
}

export interface LearningOutcome {
  id: string;
  phaseId: string;
  phase?: LearningPhase;
  subjectId: string;
  subject?: {
    id: string;
    name: string;
    code: string;
  };
  code: string;
  description: string;
  elements?: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    learningObjectives: number;
  };
}

export interface LearningObjective {
  id: string;
  learningOutcomeId: string;
  learningOutcome?: LearningOutcome;
  code: string;
  description: string;
  indicators?: Record<string, unknown>;
  sequence: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    teachingModules: number;
  };
}

export interface TeachingModule {
  id: string;
  learningObjectiveId: string;
  learningObjective?: LearningObjective;
  teacherId: string;
  teacher?: {
    id: string;
    name: string;
  };
  classId?: string;
  class?: {
    id: string;
    name: string;
  };
  title: string;
  topic: string;
  duration: number;
  objectives: string;
  prerequisites?: string;
  targetLearners?: string;
  materials?: Record<string, unknown>;
  activities?: Record<string, unknown>;
  assessmentPlan?: Record<string, unknown>;
  differentiation?: Record<string, unknown>;
  reflection?: string;
  attachments?: Record<string, unknown>;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface P5ThemeData {
  id: string;
  code: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    projects: number;
  };
}

export interface P5Project {
  id: string;
  unitId: string;
  unit?: {
    id: string;
    name: string;
  };
  academicYearId: string;
  academicYear?: {
    id: string;
    name: string;
  };
  themeId: string;
  theme?: P5ThemeData;
  classId?: string;
  class?: {
    id: string;
    name: string;
  };
  title: string;
  description: string;
  objectives?: Record<string, unknown>;
  dimensions: P5DimensionCode[];
  activities?: Record<string, unknown>;
  schedule?: Record<string, unknown>;
  startDate: string;
  endDate: string;
  supervisorId: string;
  supervisor?: {
    id: string;
    name: string;
  };
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  _count?: {
    assessments: number;
  };
}

export interface P5Assessment {
  id: string;
  projectId: string;
  project?: P5Project;
  studentId: string;
  student?: {
    id: string;
    user: {
      name: string;
    };
    nis: string;
    class?: {
      name: string;
    };
  };
  beriman?: P5Grade;
  berkebinekaan?: P5Grade;
  bergotongroyong?: P5Grade;
  mandiri?: P5Grade;
  bernalarkritis?: P5Grade;
  kreatif?: P5Grade;
  overallGrade?: P5Grade;
  notes?: string;
  assessedById: string;
  assessedBy?: {
    id: string;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface MerdekaAssessment {
  id: string;
  unitId: string;
  unit?: {
    id: string;
    name: string;
  };
  classId: string;
  class?: {
    id: string;
    name: string;
  };
  subjectId: string;
  subject?: {
    id: string;
    name: string;
    code: string;
  };
  learningObjectiveId?: string;
  learningObjective?: LearningObjective;
  teacherId: string;
  teacher?: {
    id: string;
    name: string;
  };
  academicYearId: string;
  academicYear?: {
    id: string;
    name: string;
  };
  title: string;
  category: AssessmentCategory;
  description?: string;
  instructions?: string;
  assessmentDate: string;
  duration?: number;
  maxScore: number;
  weight: number;
  rubric?: Record<string, unknown>;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  _count?: {
    results: number;
  };
}

export interface MerdekaAssessmentResult {
  id: string;
  assessmentId: string;
  assessment?: MerdekaAssessment;
  studentId: string;
  student?: {
    id: string;
    user: {
      name: string;
    };
    nis: string;
  };
  score?: number;
  percentage?: number;
  grade?: string;
  feedback?: string;
  attachments?: Record<string, unknown>;
  gradedById: string;
  gradedBy?: {
    id: string;
    name: string;
  };
  gradedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KurikulumMerdekaSummary {
  phases: {
    total: number;
    active: number;
  };
  learningOutcomes: {
    total: number;
    byPhase: Record<string, number>;
  };
  learningObjectives: {
    total: number;
  };
  teachingModules: {
    total: number;
    published: number;
  };
  p5Projects: {
    total: number;
    active: number;
    completed: number;
  };
  assessments: {
    total: number;
    byCategory: Record<string, number>;
  };
}

// ==================== LEARNING PHASES ====================

interface UseLearningPhasesParams {
  page?: number;
  limit?: number;
}

export function useLearningPhases(params?: UseLearningPhasesParams) {
  return useQuery({
    queryKey: ["learning-phases", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<LearningPhase[]>>(
        "/kurikulum-merdeka/phases",
        { params },
      );
      return response.data.data;
    },
  });
}

export function useRaportMerdekaStudentData(
  studentId?: string,
  academicYearId?: string,
  semester?: string | number,
) {
  return useQuery({
    queryKey: ["raport-merdeka-student", studentId, academicYearId, semester],
    queryFn: async () => {
      if (!studentId || !academicYearId || !semester) return null;
      const response = await api.get<ApiResponse<RaportMerdekaPdfData>>(
        `/assessment/raport-merdeka/students/${studentId}`,
        {
          params: { academicYearId, semester },
        },
      );
      return response.data.data;
    },
    enabled: !!studentId && !!academicYearId && !!semester,
  });
}

export function useRaportMerdekaStudentsList(unitId?: string, search?: string) {
  return useQuery({
    queryKey: ["students-list", unitId, search],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AssessmentStudentItem[]>>(
        "/students",
        {
          params: {
            unitId: unitId || undefined,
            search: search || undefined,
            limit: 100,
          },
        },
      );
      return response.data.data;
    },
  });
}

export function useRaportMerdekaP5Dimensions() {
  return useQuery({
    queryKey: ["p5-dimensions"],
    queryFn: async () => {
      const response = await api.get<
        ApiResponse<
          Array<{
            code: string;
            name: string;
            description: string;
            elements: string[];
          }>
        >
      >("/assessment/raport-merdeka/p5-dimensions");
      return response.data.data;
    },
  });
}

export function useRaportMerdekaCpMapping(
  subjectCode: string,
  gradeLevel: string,
) {
  return useQuery({
    queryKey: ["cp-mapping", subjectCode, gradeLevel],
    queryFn: async () => {
      const response = await api.get<
        ApiResponse<{ fase: string; cp: string[] }>
      >(`/assessment/raport-merdeka/cp/${subjectCode}/${gradeLevel}`);
      return response.data.data;
    },
    enabled: !!subjectCode && !!gradeLevel,
  });
}

export function useRaportMerdekaAcademicYears() {
  return useQuery({
    queryKey: ["academic-years-list"],
    queryFn: async () => {
      // No limit → the API defaults to ~10 records, which silently drops old
      // academic years from the selector so they can never be previewed/exported.
      // Ask for the max page size so the full history is available (Flag 8).
      const response = await api.get<ApiResponse<AssessmentAcademicYearItem[]>>(
        "/academic-years",
        { params: { limit: 100 } },
      );
      return response.data.data;
    },
  });
}

export function useExportRaportMerdekaPdf() {
  return useMutation({
    mutationFn: async ({
      studentId,
      academicYearId,
      semester,
    }: {
      studentId: string;
      academicYearId: string;
      semester: string | number;
    }) => {
      const response = await api.get(
        `/assessment/raport-merdeka/students/${studentId}/pdf`,
        {
          params: { academicYearId, semester },
          responseType: "blob",
        },
      );
      return response.data;
    },
  });
}

export interface CreateLearningPhaseData {
  code: LearningPhaseCode;
  name: string;
  description?: string;
  gradeRange: string;
}

export function useCreateLearningPhase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateLearningPhaseData) => {
      const response = await api.post<ApiResponse<LearningPhase>>(
        "/kurikulum-merdeka/phases",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learning-phases"] });
      queryClient.invalidateQueries({
        queryKey: ["kurikulum-merdeka-summary"],
      });
    },
  });
}

// ==================== LEARNING OUTCOMES ====================

interface UseLearningOutcomesParams {
  phaseId?: string;
  subjectId?: string;
  isActive?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

export function useLearningOutcomes(params?: UseLearningOutcomesParams) {
  return useQuery({
    queryKey: ["learning-outcomes", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<LearningOutcome>>(
        "/kurikulum-merdeka/learning-outcomes",
        { params },
      );
      return response.data;
    },
  });
}

export function useLearningOutcome(id: string) {
  return useQuery({
    queryKey: ["learning-outcomes", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<LearningOutcome>>(
        `/kurikulum-merdeka/learning-outcomes/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export interface CreateLearningOutcomeData {
  phaseId: string;
  subjectId: string;
  code: string;
  description: string;
  elements?: Record<string, unknown>;
  isActive?: boolean;
}

export function useCreateLearningOutcome() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateLearningOutcomeData) => {
      const response = await api.post<ApiResponse<LearningOutcome>>(
        "/kurikulum-merdeka/learning-outcomes",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learning-outcomes"] });
      queryClient.invalidateQueries({
        queryKey: ["kurikulum-merdeka-summary"],
      });
    },
  });
}

export function useUpdateLearningOutcome() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateLearningOutcomeData>;
    }) => {
      const response = await api.put<ApiResponse<LearningOutcome>>(
        `/kurikulum-merdeka/learning-outcomes/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["learning-outcomes"] });
      queryClient.invalidateQueries({
        queryKey: ["learning-outcomes", variables.id],
      });
    },
  });
}

export function useDeleteLearningOutcome() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/kurikulum-merdeka/learning-outcomes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learning-outcomes"] });
      queryClient.invalidateQueries({
        queryKey: ["kurikulum-merdeka-summary"],
      });
    },
  });
}

// ==================== LEARNING OBJECTIVES ====================

interface UseLearningObjectivesParams {
  learningOutcomeId?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
}

export function useLearningObjectives(params?: UseLearningObjectivesParams) {
  return useQuery({
    queryKey: ["learning-objectives", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<LearningObjective>>(
        "/kurikulum-merdeka/learning-objectives",
        { params },
      );
      return response.data;
    },
  });
}

export function useLearningObjective(id: string) {
  return useQuery({
    queryKey: ["learning-objectives", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<LearningObjective>>(
        `/kurikulum-merdeka/learning-objectives/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export interface CreateLearningObjectiveData {
  learningOutcomeId: string;
  code: string;
  description: string;
  indicators?: Record<string, unknown>;
  sequence?: number;
  isActive?: boolean;
}

export function useCreateLearningObjective() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateLearningObjectiveData) => {
      const response = await api.post<ApiResponse<LearningObjective>>(
        "/kurikulum-merdeka/learning-objectives",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learning-objectives"] });
      queryClient.invalidateQueries({
        queryKey: ["kurikulum-merdeka-summary"],
      });
    },
  });
}

export function useUpdateLearningObjective() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateLearningObjectiveData>;
    }) => {
      const response = await api.put<ApiResponse<LearningObjective>>(
        `/kurikulum-merdeka/learning-objectives/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["learning-objectives"] });
      queryClient.invalidateQueries({
        queryKey: ["learning-objectives", variables.id],
      });
    },
  });
}

export function useDeleteLearningObjective() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/kurikulum-merdeka/learning-objectives/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learning-objectives"] });
      queryClient.invalidateQueries({
        queryKey: ["kurikulum-merdeka-summary"],
      });
    },
  });
}

// ==================== TEACHING MODULES ====================

interface UseTeachingModulesParams {
  learningObjectiveId?: string;
  teacherId?: string;
  classId?: string;
  isPublished?: boolean;
  page?: number;
  limit?: number;
}

export function useTeachingModules(params?: UseTeachingModulesParams) {
  return useQuery({
    queryKey: ["teaching-modules", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<TeachingModule>>(
        "/kurikulum-merdeka/teaching-modules",
        { params },
      );
      return response.data;
    },
  });
}

export function useTeachingModule(id: string) {
  return useQuery({
    queryKey: ["teaching-modules", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<TeachingModule>>(
        `/kurikulum-merdeka/teaching-modules/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export interface CreateTeachingModuleData {
  learningObjectiveId: string;
  teacherId: string;
  classId?: string;
  title: string;
  topic: string;
  duration: number;
  objectives: string;
  prerequisites?: string;
  targetLearners?: string;
  materials?: Record<string, unknown>;
  activities?: Record<string, unknown>;
  assessmentPlan?: Record<string, unknown>;
  differentiation?: Record<string, unknown>;
  reflection?: string;
  attachments?: Record<string, unknown>;
  isPublished?: boolean;
}

export function useCreateTeachingModule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateTeachingModuleData) => {
      const response = await api.post<ApiResponse<TeachingModule>>(
        "/kurikulum-merdeka/teaching-modules",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teaching-modules"] });
      queryClient.invalidateQueries({
        queryKey: ["kurikulum-merdeka-summary"],
      });
    },
  });
}

export function useUpdateTeachingModule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Omit<CreateTeachingModuleData, "teacherId">>;
    }) => {
      const response = await api.put<ApiResponse<TeachingModule>>(
        `/kurikulum-merdeka/teaching-modules/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["teaching-modules"] });
      queryClient.invalidateQueries({
        queryKey: ["teaching-modules", variables.id],
      });
    },
  });
}

export function useDeleteTeachingModule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/kurikulum-merdeka/teaching-modules/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["teaching-modules"] });
      queryClient.invalidateQueries({
        queryKey: ["kurikulum-merdeka-summary"],
      });
    },
  });
}

// ==================== P5 THEMES ====================

export function useP5Themes() {
  return useQuery({
    queryKey: ["p5-themes"],
    queryFn: async () => {
      const response = await api.get<ApiResponse<P5ThemeData[]>>(
        "/kurikulum-merdeka/p5-themes",
      );
      return response.data.data;
    },
  });
}

export function useP5Theme(id: string) {
  return useQuery({
    queryKey: ["p5-themes", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<P5ThemeData>>(
        `/kurikulum-merdeka/p5-themes/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export interface CreateP5ThemeData {
  code: string;
  name: string;
  description?: string;
  isActive?: boolean;
}

export function useCreateP5Theme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateP5ThemeData) => {
      const response = await api.post<ApiResponse<P5ThemeData>>(
        "/kurikulum-merdeka/p5-themes",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["p5-themes"] });
    },
  });
}

export function useUpdateP5Theme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateP5ThemeData>;
    }) => {
      const response = await api.put<ApiResponse<P5ThemeData>>(
        `/kurikulum-merdeka/p5-themes/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["p5-themes"] });
      queryClient.invalidateQueries({ queryKey: ["p5-themes", variables.id] });
    },
  });
}

// ==================== P5 PROJECTS ====================

interface UseP5ProjectsParams {
  unitId?: string;
  academicYearId?: string;
  themeId?: string;
  classId?: string;
  supervisorId?: string;
  status?: ProjectStatus;
  page?: number;
  limit?: number;
}

export function useP5Projects(params?: UseP5ProjectsParams) {
  return useQuery({
    queryKey: ["p5-projects", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<P5Project>>(
        "/kurikulum-merdeka/p5-projects",
        { params },
      );
      return response.data;
    },
  });
}

export function useP5Project(id: string) {
  return useQuery({
    queryKey: ["p5-projects", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<P5Project>>(
        `/kurikulum-merdeka/p5-projects/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export interface CreateP5ProjectData {
  unitId: string;
  academicYearId: string;
  themeId: string;
  classId?: string;
  title: string;
  description: string;
  objectives?: Record<string, unknown>;
  dimensions: P5DimensionCode[];
  activities?: Record<string, unknown>;
  schedule?: Record<string, unknown>;
  startDate: string;
  endDate: string;
  supervisorId: string;
  status?: ProjectStatus;
}

export function useCreateP5Project() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateP5ProjectData) => {
      const response = await api.post<ApiResponse<P5Project>>(
        "/kurikulum-merdeka/p5-projects",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["p5-projects"] });
      queryClient.invalidateQueries({
        queryKey: ["kurikulum-merdeka-summary"],
      });
    },
  });
}

export function useUpdateP5Project() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<Omit<CreateP5ProjectData, "unitId" | "academicYearId">>;
    }) => {
      const response = await api.put<ApiResponse<P5Project>>(
        `/kurikulum-merdeka/p5-projects/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["p5-projects"] });
      queryClient.invalidateQueries({
        queryKey: ["p5-projects", variables.id],
      });
    },
  });
}

export function useDeleteP5Project() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/kurikulum-merdeka/p5-projects/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["p5-projects"] });
      queryClient.invalidateQueries({
        queryKey: ["kurikulum-merdeka-summary"],
      });
    },
  });
}

// ==================== P5 ASSESSMENTS ====================

interface UseP5AssessmentsParams {
  projectId?: string;
  studentId?: string;
  assessedById?: string;
  page?: number;
  limit?: number;
}

export function useP5Assessments(params?: UseP5AssessmentsParams) {
  return useQuery({
    queryKey: ["p5-assessments", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<P5Assessment>>(
        "/kurikulum-merdeka/p5-assessments",
        { params },
      );
      return response.data;
    },
  });
}

export function useP5Assessment(id: string) {
  return useQuery({
    queryKey: ["p5-assessments", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<P5Assessment>>(
        `/kurikulum-merdeka/p5-assessments/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export interface CreateP5AssessmentData {
  projectId: string;
  studentId: string;
  beriman?: P5Grade;
  berkebinekaan?: P5Grade;
  bergotongroyong?: P5Grade;
  mandiri?: P5Grade;
  bernalarkritis?: P5Grade;
  kreatif?: P5Grade;
  overallGrade?: P5Grade;
  notes?: string;
  assessedById: string;
}

export function useCreateP5Assessment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateP5AssessmentData) => {
      const response = await api.post<ApiResponse<P5Assessment>>(
        "/kurikulum-merdeka/p5-assessments",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["p5-assessments"] });
      queryClient.invalidateQueries({ queryKey: ["p5-projects"] });
    },
  });
}

export function useUpdateP5Assessment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<
        Omit<CreateP5AssessmentData, "projectId" | "studentId" | "assessedById">
      >;
    }) => {
      const response = await api.put<ApiResponse<P5Assessment>>(
        `/kurikulum-merdeka/p5-assessments/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["p5-assessments"] });
      queryClient.invalidateQueries({
        queryKey: ["p5-assessments", variables.id],
      });
    },
  });
}

export function useDeleteP5Assessment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/kurikulum-merdeka/p5-assessments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["p5-assessments"] });
      queryClient.invalidateQueries({ queryKey: ["p5-projects"] });
    },
  });
}

// ==================== MERDEKA ASSESSMENTS ====================

interface UseMerdekaAssessmentsParams {
  unitId?: string;
  classId?: string;
  subjectId?: string;
  teacherId?: string;
  academicYearId?: string;
  category?: AssessmentCategory;
  status?: ProjectStatus;
  page?: number;
  limit?: number;
}

export function useMerdekaAssessments(params?: UseMerdekaAssessmentsParams) {
  return useQuery({
    queryKey: ["merdeka-assessments", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<MerdekaAssessment>>(
        "/kurikulum-merdeka/assessments",
        { params },
      );
      return response.data;
    },
  });
}

export function useMerdekaAssessment(id: string) {
  return useQuery({
    queryKey: ["merdeka-assessments", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<MerdekaAssessment>>(
        `/kurikulum-merdeka/assessments/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export interface CreateMerdekaAssessmentData {
  unitId: string;
  classId: string;
  subjectId: string;
  learningObjectiveId?: string;
  teacherId: string;
  academicYearId: string;
  title: string;
  category: AssessmentCategory;
  description?: string;
  instructions?: string;
  assessmentDate: string;
  duration?: number;
  maxScore?: number;
  weight?: number;
  rubric?: Record<string, unknown>;
  status?: ProjectStatus;
}

export function useCreateMerdekaAssessment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateMerdekaAssessmentData) => {
      const response = await api.post<ApiResponse<MerdekaAssessment>>(
        "/kurikulum-merdeka/assessments",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merdeka-assessments"] });
      queryClient.invalidateQueries({
        queryKey: ["kurikulum-merdeka-summary"],
      });
    },
  });
}

export function useUpdateMerdekaAssessment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<
        Omit<
          CreateMerdekaAssessmentData,
          "unitId" | "teacherId" | "academicYearId"
        >
      >;
    }) => {
      const response = await api.put<ApiResponse<MerdekaAssessment>>(
        `/kurikulum-merdeka/assessments/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["merdeka-assessments"] });
      queryClient.invalidateQueries({
        queryKey: ["merdeka-assessments", variables.id],
      });
    },
  });
}

export function useDeleteMerdekaAssessment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/kurikulum-merdeka/assessments/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merdeka-assessments"] });
      queryClient.invalidateQueries({
        queryKey: ["kurikulum-merdeka-summary"],
      });
    },
  });
}

// ==================== MERDEKA ASSESSMENT RESULTS ====================

interface UseMerdekaResultsParams {
  assessmentId?: string;
  studentId?: string;
  page?: number;
  limit?: number;
}

export function useMerdekaResults(params?: UseMerdekaResultsParams) {
  return useQuery({
    queryKey: ["merdeka-results", params],
    queryFn: async () => {
      const response = await api.get<
        PaginatedResponse<MerdekaAssessmentResult>
      >("/kurikulum-merdeka/assessment-results", { params });
      return response.data;
    },
  });
}

export function useMerdekaResult(id: string) {
  return useQuery({
    queryKey: ["merdeka-results", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<MerdekaAssessmentResult>>(
        `/kurikulum-merdeka/assessment-results/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export interface CreateMerdekaResultData {
  assessmentId: string;
  studentId: string;
  score?: number;
  percentage?: number;
  grade?: string;
  feedback?: string;
  attachments?: Record<string, unknown>;
  gradedById: string;
}

export function useCreateMerdekaResult() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateMerdekaResultData) => {
      const response = await api.post<ApiResponse<MerdekaAssessmentResult>>(
        "/kurikulum-merdeka/assessment-results",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merdeka-results"] });
      queryClient.invalidateQueries({ queryKey: ["merdeka-assessments"] });
    },
  });
}

export function useUpdateMerdekaResult() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<
        Omit<
          CreateMerdekaResultData,
          "assessmentId" | "studentId" | "gradedById"
        >
      >;
    }) => {
      const response = await api.put<ApiResponse<MerdekaAssessmentResult>>(
        `/kurikulum-merdeka/assessment-results/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["merdeka-results"] });
      queryClient.invalidateQueries({
        queryKey: ["merdeka-results", variables.id],
      });
    },
  });
}

export function useDeleteMerdekaResult() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/kurikulum-merdeka/assessment-results/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["merdeka-results"] });
      queryClient.invalidateQueries({ queryKey: ["merdeka-assessments"] });
    },
  });
}

// ==================== SUMMARY ====================

export function useKurikulumMerdekaSummary(unitId?: string) {
  return useQuery({
    queryKey: ["kurikulum-merdeka-summary", unitId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<KurikulumMerdekaSummary>>(
        "/kurikulum-merdeka/summary",
        {
          params: unitId ? { unitId } : undefined,
        },
      );
      return response.data.data;
    },
  });
}
