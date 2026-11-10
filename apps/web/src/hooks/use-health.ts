import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { SharedPaginatedResponse } from "@/lib/api";
import {
  MedicalRecord,
  MedicalRecordType,
  MedicalRecordType as HealthRecordType,
  HealthStatus,
  CreateMedicalRecordInput,
  UpdateMedicalRecordInput,
  HealthStats,
} from "@cipansor/shared";

export type { MedicalRecord };
export { HealthStatus, MedicalRecordType as HealthRecordType };

// Constants
export const HEALTH_RECORD_TYPES: {
  value: MedicalRecordType;
  label: string;
}[] = [
  { value: MedicalRecordType.CHECKUP, label: "Pemeriksaan Rutin" },
  { value: MedicalRecordType.ILLNESS, label: "Sakit" },
  { value: MedicalRecordType.INJURY, label: "Cedera" },
  { value: MedicalRecordType.FIRST_AID, label: "Pertolongan Pertama" },
  { value: MedicalRecordType.REFERRAL, label: "Rujukan" },
  { value: MedicalRecordType.VACCINATION, label: "Vaksinasi" },
];

export const HEALTH_STATUSES: {
  value: string;
  label: string;
  color: string;
}[] = [
  {
    value: HealthStatus.HEALTHY,
    label: "Sehat",
    color: "bg-green-100 text-green-800",
  },
  {
    value: HealthStatus.SICK,
    label: "Sakit",
    color: "bg-red-100 text-red-800",
  },
  {
    value: HealthStatus.RECOVERING,
    label: "Pemulihan",
    color: "bg-yellow-100 text-yellow-800",
  },
  {
    value: HealthStatus.HOSPITALIZED,
    label: "Rawat Inap",
    color: "bg-purple-100 text-purple-800",
  },
];

// Helper to extract status from notes if needed, or use future field
export function getRecordStatus(record: MedicalRecord): string {
  if (record.status) return record.status;
  // Fallback parsing from notes if status not direct field
  if (record.notes?.includes('"status":"SICK"')) return HealthStatus.SICK;
  return HealthStatus.HEALTHY;
}

// Health Records Hooks
export function useHealthRecords(params?: {
  page?: number;
  limit?: number;
  studentId?: string;
  recordType?: MedicalRecordType; // Fixed param name to match usage
  status?: HealthStatus; // Fixed type
  startDate?: string;
  endDate?: string;
}) {
  return useQuery({
    queryKey: ["health-records", params],
    queryFn: async () => {
      const response = await api.get<SharedPaginatedResponse<MedicalRecord>>(
        "/health/records",
        { params },
      );
      return response.data;
    },
  });
}

export function useHealthRecord(id: string) {
  return useQuery({
    queryKey: ["health-records", id],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: MedicalRecord }>(
        `/health/records/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useStudentHealthRecords(studentId: string) {
  return useQuery({
    queryKey: ["health-records", "student", studentId],
    queryFn: async () => {
      const response = await api.get<{
        success: boolean;
        data: MedicalRecord[];
      }>(`/health/students/${studentId}/history`);
      return response.data.data;
    },
    enabled: !!studentId,
  });
}

export function useCreateHealthRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateMedicalRecordInput) => {
      const response = await api.post<{
        success: boolean;
        data: MedicalRecord;
      }>("/health/records", data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-records"] });
    },
  });
}

export function useUpdateHealthRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateMedicalRecordInput;
    }) => {
      const response = await api.put<{ success: boolean; data: MedicalRecord }>(
        `/health/records/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-records"] });
    },
  });
}

export function useDeleteHealthRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/health/records/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["health-records"] });
    },
  });
}

// Health Stats Hook
export function useHealthStats(unitId: string) {
  return useQuery({
    queryKey: ["health-stats", unitId],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: HealthStats }>(
        `/health/stats/${unitId}`,
      );
      return response.data.data;
    },
    enabled: !!unitId,
  });
}

// Added missing useHealthSummary hook
export function useHealthSummary() {
  return useQuery({
    queryKey: ["health-summary"],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: HealthStats }>(
        "/health/summary",
      );
      return response.data.data;
    },
  });
}

// ==================== TUMBUH KEMBANG ====================

/** One weighing as `GET /health/growth` returns it. */
export interface GrowthRecord {
  id: string;
  studentId: string;
  recordDate: string;
  weight: number | null;
  height: number | null;
  headCircumference: number | null;
  notes: string | null;
}

/** A santri's growth records (`GET /health/growth?studentId=`), newest first. */
export function useGrowthRecords(studentId?: string) {
  return useQuery({
    queryKey: ["growth-records", studentId],
    queryFn: async () => {
      const res = await api.get<{ data: GrowthRecord[] }>("/health/growth", {
        params: { studentId, limit: 100 },
      });
      return res.data.data ?? [];
    },
    enabled: !!studentId,
  });
}

/** Record a weighing (`POST /health/growth`). */
export function useCreateGrowthRecord() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: {
      studentId: string;
      /** The santri's unit: the API files the record under it. */
      unitId: string;
      recordDate: Date | string;
      weight?: number;
      height?: number;
      headCircumference?: number;
      notes?: string;
    }) => {
      const res = await api.post("/health/growth", data);
      return res.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["growth-records", variables.studentId],
      });
    },
  });
}

/** Delete a weighing (`DELETE /health/growth/:id`). */
export function useDeleteGrowthRecord(studentId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/health/growth/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["growth-records", studentId],
      });
    },
  });
}
