import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { ApiResponse, PaginatedResponse, User } from "@/lib/api";

// ==================== TYPES ====================

export interface Teacher {
  id: string;
  userId: string;
  user?: {
    id: string;
    name: string;
    email: string;
    phone?: string;
    avatarUrl?: string;
  };
  nip?: string;
  nuptk?: string;
  unitId: string;
  unit?: {
    id: string;
    name: string;
  };
  status: "ACTIVE" | "INACTIVE" | "ON_LEAVE";
  specialization?: string;
  bio?: string;
  createdAt: string;
  updatedAt: string;
}

// ==================== QUERY PARAMS ====================

interface UseTeachersParams {
  unitId?: string;
  status?: "ACTIVE" | "INACTIVE" | "ON_LEAVE";
  isActive?: boolean;
  search?: string;
  page?: number;
  limit?: number;
}

// ==================== HOOKS ====================

/**
 * Get list of teachers (from hr/teachers endpoint)
 */
export function useTeachers(params?: UseTeachersParams) {
  return useQuery({
    queryKey: ["teachers", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<Teacher>>(
        "/hr/teachers",
        { params },
      );
      return response.data;
    },
  });
}
