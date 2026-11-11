/**
 * Murojaah Analytics Hooks
 * Custom React hooks for fetching murojaah analytics data
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ============================================
// Types
// ============================================

export interface QualityDistribution {
  distribution: {
    excellent: { count: number; percentage: number };
    good: { count: number; percentage: number };
    fair: { count: number; percentage: number };
    poor: { count: number; percentage: number };
  };
  total: number;
  averageQuality: number;
}

export interface MistakePatterns {
  patterns: Record<string, { count: number; trend: number }>;
  totalMistakes: number;
}

export interface ConsistencyScore {
  consistencyPercentage: number;
  activeDays: number;
  totalDays: number;
  dailyRecords: Array<{
    date: string;
    count: number;
    avgQuality: number;
  }>;
}

export interface TopPerformer {
  rank: number;
  studentId: string;
  studentName: string;
  recordCount: number;
  totalPages: number;
  avgQuality: number;
}

export interface TopPerformersResponse {
  performers: TopPerformer[];
}

interface AnalyticsQuery {
  dateFrom?: string;
  dateTo?: string;
  halaqohId?: string;
  murojaahType?: string;
  limit?: number;
}

// ============================================
// API Functions
// ============================================

async function fetchQualityDistribution(
  params: AnalyticsQuery,
): Promise<QualityDistribution> {
  const searchParams = new URLSearchParams();
  if (params.dateFrom) searchParams.append("dateFrom", params.dateFrom);
  if (params.dateTo) searchParams.append("dateTo", params.dateTo);
  if (params.halaqohId) searchParams.append("halaqohId", params.halaqohId);
  if (params.murojaahType)
    searchParams.append("murojaahType", params.murojaahType);

  const response = await api.get(
    `/murojaah/analytics/quality-distribution?${searchParams}`,
  );
  return response.data.data;
}

async function fetchMistakePatterns(
  params: AnalyticsQuery,
): Promise<MistakePatterns> {
  const searchParams = new URLSearchParams();
  if (params.dateFrom) searchParams.append("dateFrom", params.dateFrom);
  if (params.dateTo) searchParams.append("dateTo", params.dateTo);
  if (params.halaqohId) searchParams.append("halaqohId", params.halaqohId);

  const response = await api.get(
    `/murojaah/analytics/mistake-patterns?${searchParams}`,
  );
  return response.data.data;
}

async function fetchConsistencyScore(
  params: AnalyticsQuery,
): Promise<ConsistencyScore> {
  const searchParams = new URLSearchParams();
  if (params.dateFrom) searchParams.append("dateFrom", params.dateFrom);
  if (params.dateTo) searchParams.append("dateTo", params.dateTo);
  if (params.halaqohId) searchParams.append("halaqohId", params.halaqohId);

  const response = await api.get(
    `/murojaah/analytics/consistency-score?${searchParams}`,
  );
  return response.data.data;
}

async function fetchTopPerformers(
  params: AnalyticsQuery,
): Promise<TopPerformersResponse> {
  const searchParams = new URLSearchParams();
  if (params.dateFrom) searchParams.append("dateFrom", params.dateFrom);
  if (params.dateTo) searchParams.append("dateTo", params.dateTo);
  if (params.halaqohId) searchParams.append("halaqohId", params.halaqohId);
  if (params.limit) searchParams.append("limit", params.limit.toString());

  const response = await api.get(
    `/murojaah/analytics/top-performers?${searchParams}`,
  );
  return response.data.data;
}

// ============================================
// React Query Hooks
// ============================================

// Retry configuration for all analytics queries
const retryConfig = {
  retry: 3,
  retryDelay: (attemptIndex: number) =>
    Math.min(1000 * 2 ** attemptIndex, 30000), // Exponential backoff
};

/**
 * Hook to fetch quality distribution analytics
 */
export function useQualityDistribution(params: AnalyticsQuery = {}) {
  return useQuery({
    queryKey: ["murojaah", "analytics", "quality-distribution", params],
    queryFn: () => fetchQualityDistribution(params),
    staleTime: 5 * 60 * 1000, // 5 minutes
    ...retryConfig,
  });
}

/**
 * Hook to fetch mistake patterns analytics
 */
export function useMistakePatterns(params: AnalyticsQuery = {}) {
  return useQuery({
    queryKey: ["murojaah", "analytics", "mistake-patterns", params],
    queryFn: () => fetchMistakePatterns(params),
    staleTime: 5 * 60 * 1000,
    ...retryConfig,
  });
}

/**
 * Hook to fetch consistency score analytics
 */
export function useConsistencyScore(params: AnalyticsQuery = {}) {
  return useQuery({
    queryKey: ["murojaah", "analytics", "consistency-score", params],
    queryFn: () => fetchConsistencyScore(params),
    staleTime: 5 * 60 * 1000,
    ...retryConfig,
  });
}

/**
 * Hook to fetch top performers
 */
export function useTopPerformers(params: AnalyticsQuery = {}) {
  return useQuery({
    queryKey: ["murojaah", "analytics", "top-performers", params],
    queryFn: () => fetchTopPerformers(params),
    staleTime: 5 * 60 * 1000,
    ...retryConfig,
  });
}

/**
 * Hook to prefetch all analytics data
 */
export function useMurojaahAnalytics(params: AnalyticsQuery = {}) {
  const qualityDist = useQualityDistribution(params);
  const mistakes = useMistakePatterns(params);
  const consistency = useConsistencyScore(params);
  const topPerformers = useTopPerformers(params);

  return {
    qualityDistribution: qualityDist,
    mistakePatterns: mistakes,
    consistencyScore: consistency,
    topPerformers,
    isLoading:
      qualityDist.isLoading ||
      mistakes.isLoading ||
      consistency.isLoading ||
      topPerformers.isLoading,
    isError:
      qualityDist.isError ||
      mistakes.isError ||
      consistency.isError ||
      topPerformers.isError,
  };
}
