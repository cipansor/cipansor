import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { PaginatedResponse } from "@/lib/api";

// Types
export type RewardCategory =
  "ACADEMIC" | "RELIGIOUS" | "EXTRACURRICULAR" | "SOCIAL" | "OTHER";

export interface RewardType {
  id: string;
  name: string;
  description?: string;
  category: RewardCategory;
  points: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Reward {
  id: string;
  studentId: string;
  rewardTypeId: string;
  date: string;
  description?: string;
  givenById: string;
  createdAt: string;
  updatedAt: string;
  student?: {
    id: string;
    name: string;
    nis: string;
    class?: { name: string };
    unit?: { name: string };
    totalRewardPoints?: number;
  };
  rewardType?: RewardType;
  givenBy?: { name: string };
}

/**
 * The Reward model stores what the UI calls a "reward type" as a free-text
 * `category` string plus `points`, and the date in `givenAt` — there is no
 * RewardType table and no `date` column. The list/detail/edit pages were built
 * against that richer shape, so normalize the API row into the UI shape here:
 * the pages keep working and every field they read is defined.
 */
export function normalizeReward(raw: any): Reward {
  const category = (raw.category ?? "OTHER") as string;
  const givenAt = raw.givenAt ?? raw.createdAt ?? new Date().toISOString();
  const label = category.charAt(0).toUpperCase() + category.slice(1);
  const points = raw.points ?? 0;
  return {
    ...raw,
    rewardTypeId: raw.rewardTypeId ?? category,
    date: givenAt,
    rewardType: raw.rewardType ?? {
      id: category,
      name: label,
      description: raw.description ?? undefined,
      category: category as RewardCategory,
      points,
      isActive: true,
      createdAt: raw.createdAt,
      updatedAt: raw.updatedAt,
    },
  };
}

// Constants
export const REWARD_CATEGORIES: {
  value: RewardCategory;
  label: string;
  color: string;
}[] = [
  { value: "ACADEMIC", label: "Akademik", color: "bg-blue-100 text-blue-800" },
  {
    value: "RELIGIOUS",
    label: "Keagamaan",
    color: "bg-green-100 text-green-800",
  },
  {
    value: "EXTRACURRICULAR",
    label: "Ekstrakurikuler",
    color: "bg-purple-100 text-purple-800",
  },
  { value: "SOCIAL", label: "Sosial", color: "bg-orange-100 text-orange-800" },
  { value: "OTHER", label: "Lainnya", color: "bg-gray-100 text-gray-800" },
];

// Reward Types Hooks
//
// `/rewards/categories` now returns one `{id, name, category, points}` per
// category, with the points its existing rows carry — the shape the picker and
// the create form need. Fall back to a zero-point entry only for a row the API
// somehow sends without one, so the select still renders a label.
function categoryToRewardType(raw: any): RewardType {
  const name = String(raw?.id ?? raw);
  const label = raw?.name ?? name.charAt(0).toUpperCase() + name.slice(1);
  return {
    id: name,
    name: label,
    category: (raw?.category ?? name.toUpperCase()) as RewardCategory,
    points: typeof raw?.points === "number" ? raw.points : 0,
    isActive: raw?.isActive ?? true,
    createdAt: raw?.createdAt ?? new Date().toISOString(),
    updatedAt: raw?.updatedAt ?? new Date().toISOString(),
  };
}

export function useRewardTypes(params?: {
  category?: RewardCategory;
  isActive?: boolean;
}) {
  return useQuery({
    queryKey: ["reward-types", params],
    queryFn: async () => {
      const response = await api.get<{ data: unknown[] }>(
        "/rewards/categories",
        { params },
      );
      return (response.data.data ?? []).map(categoryToRewardType);
    },
  });
}

export function useRewardType(id: string) {
  return useQuery({
    queryKey: ["reward-types", id],
    queryFn: async () => {
      // The API wraps the row in `{success, data}`; returning `response.data`
      // handed the caller the envelope, so every field read off it was
      // `undefined` and the edit form rendered blank.
      const response = await api.get<{ data: RewardType }>(
        `/rewards/categories/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useCreateRewardType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name: string;
      description?: string;
      category: RewardCategory;
      points: number;
      isActive?: boolean;
    }) => {
      const response = await api.post<RewardType>("/rewards/categories", data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reward-types"] });
    },
  });
}

export function useUpdateRewardType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: {
        name?: string;
        description?: string;
        category?: RewardCategory;
        points?: number;
        isActive?: boolean;
      };
    }) => {
      const response = await api.put<RewardType>(
        `/rewards/categories/${id}`,
        data,
      );
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reward-types"] });
    },
  });
}

export function useDeleteRewardType() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/rewards/categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reward-types"] });
    },
  });
}

// Rewards Hooks
export function useRewards(params?: {
  page?: number;
  limit?: number;
  studentId?: string;
  rewardTypeId?: string;
  category?: RewardCategory;
  startDate?: string;
  endDate?: string;
}) {
  return useQuery({
    queryKey: ["rewards", params],
    queryFn: async () => {
      // The API filters the free-text `category` exactly via `categoryId`; the
      // UI names it `rewardTypeId`. Translate so the filter reaches the API
      // instead of being dropped as an unknown param.
      const { rewardTypeId, ...rest } = params ?? {};
      const response = await api.get<PaginatedResponse<Reward>>("/rewards", {
        params: { ...rest, ...(rewardTypeId && { categoryId: rewardTypeId }) },
      });
      return {
        ...response.data,
        data: (response.data.data ?? []).map(normalizeReward),
      };
    },
  });
}

export function useReward(id: string) {
  return useQuery({
    queryKey: ["rewards", id],
    queryFn: async () => {
      const response = await api.get<any>(`/rewards/${id}`);
      return normalizeReward(response.data.data ?? response.data);
    },
    enabled: !!id,
  });
}

export function useStudentRewards(studentId: string) {
  return useQuery({
    queryKey: ["rewards", "student", studentId],
    queryFn: async () => {
      const response = await api.get<any>(`/rewards/student/${studentId}`);
      return (response.data.data ?? []).map(normalizeReward);
    },
    enabled: !!studentId,
  });
}

export function useCreateReward() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      studentId: string;
      category: string;
      description: string;
      points?: number;
      givenAt?: string;
    }) => {
      const response = await api.post<Reward>("/rewards", data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rewards"] });
    },
  });
}

export function useUpdateReward() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: {
        category?: string;
        description?: string;
        points?: number;
        givenAt?: string;
      };
    }) => {
      const response = await api.put<Reward>(`/rewards/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rewards"] });
    },
  });
}

export function useDeleteReward() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/rewards/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rewards"] });
    },
  });
}

// Reward Summary Hooks
export function useRewardSummary(params?: {
  startDate?: string;
  endDate?: string;
}) {
  return useQuery({
    queryKey: ["rewards", "summary", params],
    queryFn: async () => {
      const response = await api.get<{
        totalRewards: number;
        byCategory: { category: RewardCategory; count: number }[];
        topRewardTypes: { rewardTypeId: string; name: string; count: number }[];
        topStudents: {
          studentId: string;
          name: string;
          count: number;
          points: number;
        }[];
      }>("/rewards/summary", { params });
      return response.data;
    },
  });
}

export function useStudentRewardPoints(studentId: string) {
  return useQuery({
    queryKey: ["rewards", "points", studentId],
    queryFn: async () => {
      const response = await api.get<{
        totalPoints: number;
        rewards: Reward[];
      }>(`/rewards/student/${studentId}/points`);
      return response.data;
    },
    enabled: !!studentId,
  });
}
