import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";

// Types
export type AlumniStatus = "REGISTERED" | "VERIFIED" | "ACTIVE" | "INACTIVE";
export type EducationLevel =
  "SMP" | "SMA" | "D3" | "S1" | "S2" | "S3" | "OTHER";
export type EmploymentStatus =
  "EMPLOYED" | "SELF_EMPLOYED" | "STUDENT" | "UNEMPLOYED" | "OTHER";

export const ALUMNI_STATUSES: AlumniStatus[] = [
  "REGISTERED",
  "VERIFIED",
  "ACTIVE",
  "INACTIVE",
];
export const EDUCATION_LEVELS: EducationLevel[] = [
  "SMP",
  "SMA",
  "D3",
  "S1",
  "S2",
  "S3",
  "OTHER",
];
export const EMPLOYMENT_STATUSES: EmploymentStatus[] = [
  "EMPLOYED",
  "SELF_EMPLOYED",
  "STUDENT",
  "UNEMPLOYED",
  "OTHER",
];

export const ALUMNI_STATUS_LABELS: Record<AlumniStatus, string> = {
  REGISTERED: "Terdaftar",
  VERIFIED: "Terverifikasi",
  ACTIVE: "Aktif",
  INACTIVE: "Tidak Aktif",
};

export const EDUCATION_LEVEL_LABELS: Record<EducationLevel, string> = {
  SMP: "SMP",
  SMA: "SMA/SMK",
  D3: "D3",
  S1: "S1",
  S2: "S2",
  S3: "S3",
  OTHER: "Lainnya",
};

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  EMPLOYED: "Bekerja",
  SELF_EMPLOYED: "Wirausaha",
  STUDENT: "Mahasiswa",
  UNEMPLOYED: "Belum Bekerja",
  OTHER: "Lainnya",
};

export interface Alumni {
  id: string;
  studentId?: string;
  student?: {
    id: string;
    nis: string;
    name: string;
  };

  // Personal info
  name?: string; // The API persists the alumnus name on `name`
  fullName: string;
  studentName?: string; // For backward compatibility
  gender: "MALE" | "FEMALE";
  birthPlace: string;
  birthDate: string;
  phone: string;
  email: string;
  address?: string;
  city?: string;
  province?: string;

  // Graduation info
  graduationYear: number;
  unitId: string;
  unit?: {
    id: string;
    name: string;
  };
  classId?: string;
  class?: {
    id: string;
    name: string;
  };

  // Current info
  currentEducation?: EducationLevel;
  educationInstitution?: string;
  educationMajor?: string;
  educationYear?: number;
  currentOccupation?: string;
  currentCompany?: string;
  currentCity?: string;

  // Employment
  employmentStatus?: EmploymentStatus;
  companyName?: string;
  position?: string;
  industry?: string;
  workCity?: string;

  // Social
  linkedinUrl?: string;
  instagramUrl?: string;
  facebookUrl?: string;

  // Status
  status: AlumniStatus;
  photoUrl?: string;
  bio?: string;

  // Achievements
  achievements?: AlumniAchievement[];

  createdAt: string;
  updatedAt: string;
}

export interface AlumniAchievement {
  id: string;
  alumniId: string;
  title: string;
  description?: string;
  year: number;
  category: string;
  certificateUrl?: string;
  createdAt: string;
}

export interface AlumniEvent {
  id: string;
  title: string;
  description: string;
  date: string;
  eventDate?: string; // Alias for date
  time?: string;
  location?: string;
  isOnline: boolean;
  meetingUrl?: string;
  maxParticipants?: number;
  registeredCount: number;
  imageUrl?: string;
  isPublished: boolean;
  status?: "UPCOMING" | "ONGOING" | "COMPLETED" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
}

export interface AlumniDonation {
  id: string;
  alumniId: string;
  alumni?: Alumni;
  amount: number;
  purpose: string;
  message?: string;
  status: "PENDING" | "CONFIRMED" | "REJECTED";
  paymentMethod?: string;
  paymentProofUrl?: string;
  confirmedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlumniStats {
  total: number;
  byStatus: Record<AlumniStatus, number>;
  byGraduationYear: Record<number, number>;
  byEmploymentStatus: Record<EmploymentStatus, number>;
  byEducationLevel: Record<EducationLevel, number>;
  recentGraduates: number;
  activeMembers: number;
}

// Alumni queries
export function useAlumni(params?: {
  status?: AlumniStatus;
  graduationYear?: number;
  unitId?: string;
  employmentStatus?: EmploymentStatus;
  search?: string;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["alumni", params],
    queryFn: async () => {
      const response = await api.get("/alumni", { params });
      return response.data as {
        data: Alumni[];
        meta: {
          total: number;
          page: number;
          limit: number;
          totalPages: number;
        };
      };
    },
  });
}

export function useAlumniOutcomeAnalytics(unitId?: string, enabled = true) {
  return useQuery({
    queryKey: ["alumni-outcome-analytics", unitId],
    // Nilai per nama alumni: hanya pembaca data diri (lihat lib/alumni-access).
    enabled,
    queryFn: async () => {
      const response = await api.get("/alumni/stats/outcome", {
        params: { unitId },
      });
      return response.data.data as {
        id: string;
        name: string;
        avgGrade: number | null;
        maxJuz: number;
        outcomeScore: number;
        graduationYear: number;
      }[];
    },
  });
}

export function useAlumniDetail(id: string) {
  return useQuery({
    queryKey: ["alumni", id],
    queryFn: async () => {
      const response = await api.get(`/alumni/${id}`);
      return response.data.data as Alumni;
    },
    enabled: !!id,
  });
}

export function useAlumniStats() {
  return useQuery({
    queryKey: ["alumni-stats"],
    queryFn: async () => {
      const response = await api.get("/alumni/stats");
      return response.data.data as AlumniStats;
    },
  });
}

export interface CreateAlumniData {
  studentId?: string;
  graduationYear: number;
  currentOccupation?: string;
  currentCompany?: string;
  currentCity?: string;
  phone?: string;
  email?: string;
  bio?: string;
}

export function useCreateAlumni() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateAlumniData | FormData) => {
      const response = await api.post("/alumni", data, {
        headers:
          data instanceof FormData
            ? { "Content-Type": "multipart/form-data" }
            : undefined,
      });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alumni"] });
      queryClient.invalidateQueries({ queryKey: ["alumni-stats"] });
    },
  });
}

export function useUpdateAlumni() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormData }) => {
      const response = await api.put(`/alumni/${id}`, data, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return response.data.data;
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ["alumni"] });
      queryClient.invalidateQueries({ queryKey: ["alumni", id] });
      queryClient.invalidateQueries({ queryKey: ["alumni-stats"] });
    },
  });
}

export function useVerifyAlumni() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await api.post(`/alumni/${id}/verify`);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alumni"] });
      queryClient.invalidateQueries({ queryKey: ["alumni-stats"] });
    },
  });
}

export function useDeleteAlumni() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/alumni/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alumni"] });
      queryClient.invalidateQueries({ queryKey: ["alumni-stats"] });
    },
  });
}

// Alumni Events
export function useAlumniEvents(params?: {
  isPublished?: boolean;
  upcoming?: boolean;
  page?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ["alumni-events", params],
    queryFn: async () => {
      const response = await api.get("/alumni/events", { params });
      return response.data as {
        data: AlumniEvent[];
        meta: {
          total: number;
          page: number;
          limit: number;
          totalPages: number;
        };
      };
    },
  });
}

export function useAlumniEvent(id: string) {
  return useQuery({
    queryKey: ["alumni-event", id],
    queryFn: async () => {
      const response = await api.get(`/alumni/events/${id}`);
      return response.data.data as AlumniEvent;
    },
    enabled: !!id,
  });
}

export interface CreateAlumniEventData {
  title: string;
  description: string;
  eventDate: string;
  location?: string;
  maxParticipants?: number;
  isOnline?: boolean;
  meetingUrl?: string;
}

export function useCreateAlumniEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateAlumniEventData | FormData) => {
      const response = await api.post("/alumni/events", data, {
        headers:
          data instanceof FormData
            ? { "Content-Type": "multipart/form-data" }
            : undefined,
      });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alumni-events"] });
    },
  });
}

export function useUpdateAlumniEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormData }) => {
      const response = await api.put(`/alumni/events/${id}`, data, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alumni-events"] });
    },
  });
}

export function useRegisterForEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (eventId: string) => {
      const response = await api.post(`/alumni/events/${eventId}/register`);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alumni-events"] });
    },
  });
}

export function useDeleteAlumniEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/alumni/events/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alumni-events"] });
    },
  });
}

// Alumni Achievements
export function useAddAlumniAchievement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      alumniId,
      data,
    }: {
      alumniId: string;
      data: FormData;
    }) => {
      const response = await api.post(
        `/alumni/${alumniId}/achievements`,
        data,
        {
          headers: { "Content-Type": "multipart/form-data" },
        },
      );
      return response.data.data;
    },
    onSuccess: (_, { alumniId }) => {
      queryClient.invalidateQueries({ queryKey: ["alumni", alumniId] });
    },
  });
}

export function useDeleteAlumniAchievement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      alumniId,
      achievementId,
    }: {
      alumniId: string;
      achievementId: string;
    }) => {
      await api.delete(`/alumni/${alumniId}/achievements/${achievementId}`);
    },
    onSuccess: (_, { alumniId }) => {
      queryClient.invalidateQueries({ queryKey: ["alumni", alumniId] });
    },
  });
}

// ==================== SI-TAKA (PLACEMENTS) ====================

export interface AlumniPlacement {
  id: string;
  institution: string;
  degree: string;
  field: string;
  startYear: number;
  admissionPath?: string | null;
  scholarshipName?: string | null;
  isInternational: boolean;
  alumni: { id: string; name: string; graduationYear: number };
}

export interface PlacementStats {
  total: number;
  internationalCount: number;
  scholarshipCount: number;
  byPath: { path: string; count: number }[];
  topInstitutions: { institution: string; count: number }[];
}

/** Si-Taka placement data (GET /alumni/stats/placements). */
export function useAlumniPlacements(unitId?: string) {
  return useQuery({
    queryKey: ["alumni", "placements", unitId],
    queryFn: async () => {
      const res = await api.get<{
        data: { placements: AlumniPlacement[]; stats: PlacementStats };
      }>("/alumni/stats/placements", {
        params: unitId ? { unitId } : undefined,
      });
      return res.data.data;
    },
  });
}
