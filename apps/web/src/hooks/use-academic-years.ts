import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { ApiResponse, PaginatedResponse } from "@/lib/api";

export interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isActive: boolean;
  /** Not in the backend model — academic years are global (kept optional for
   * backward compatibility with older callers). */
  unitId?: string;
  unit?: {
    id: string;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface AcademicYearParams {
  page?: number;
  limit?: number;
  unitId?: string;
  isActive?: boolean;
}

export function useAcademicYears(params: AcademicYearParams = {}) {
  return useQuery({
    queryKey: ["academic-years", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<AcademicYear>>(
        "/academic-years",
        { params },
      );
      return response.data;
    },
    staleTime: 60 * 60 * 1000, // 1 hour
  });
}

export function useAcademicYear(id: string) {
  return useQuery({
    queryKey: ["academic-years", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<AcademicYear>>(
        `/academic-years/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useActiveAcademicYear(unitId?: string) {
  return useQuery({
    queryKey: ["academic-years", "active", unitId],
    queryFn: async () => {
      const params = unitId ? { unitId, isActive: true } : { isActive: true };
      const response = await api.get<ApiResponse<AcademicYear[]>>(
        "/academic-years",
        { params },
      );
      return response.data.data?.[0] || null;
    },
  });
}

export interface CreateAcademicYearData {
  name: string;
  startDate: string;
  endDate: string;
  isActive?: boolean;
  unitId: string;
}

export function useCreateAcademicYear() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateAcademicYearData) => {
      const response = await api.post<ApiResponse<AcademicYear>>(
        "/academic-years",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
    },
  });
}

export function useUpdateAcademicYear() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateAcademicYearData>;
    }) => {
      const response = await api.put<ApiResponse<AcademicYear>>(
        `/academic-years/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
      queryClient.invalidateQueries({
        queryKey: ["academic-years", variables.id],
      });
    },
  });
}

export function useDeleteAcademicYear() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/academic-years/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
    },
  });
}

export function useActivateAcademicYear() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // The API has no activate route: setting `isActive` on the update makes
      // this year the active one and deactivates the others in one write.
      const response = await api.put<ApiResponse<AcademicYear>>(
        `/academic-years/${id}`,
        { isActive: true },
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["academic-years"] });
    },
  });
}
