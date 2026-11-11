import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";
import {
  ReportType,
  TimeRange,
  ReportFilter,
  StudentStatistics,
  AnalyticsAttendanceSummary,
  FinanceReport,
  AcademicPerformance,
  TahfidzProgress,
  HealthSummary,
  ViolationSummary,
  DashboardSummary,
  GRCStats,
  ParentEngagementStats,
} from "@cipansor/shared";

export type {
  ReportType,
  TimeRange,
  ReportFilter,
  StudentStatistics,
  AnalyticsAttendanceSummary,
  FinanceReport,
  AcademicPerformance,
  TahfidzProgress,
  HealthSummary,
  ViolationSummary,
  DashboardSummary,
  GRCStats,
  ParentEngagementStats,
};

// Constants
export const REPORT_TYPES: ReportType[] = [
  "STUDENT_STATISTICS",
  "ATTENDANCE_SUMMARY",
  "FINANCE_REPORT",
  "ACADEMIC_PERFORMANCE",
  "TAHFIDZ_PROGRESS",
  "HEALTH_SUMMARY",
  "VIOLATION_SUMMARY",
  "LIBRARY_STATISTICS",
  "SPMB_STATISTICS",
  "PSB_STATISTICS",
];

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  STUDENT_STATISTICS: "Statistik Santri",
  ATTENDANCE_SUMMARY: "Ringkasan Kehadiran",
  FINANCE_REPORT: "Laporan Keuangan",
  ACADEMIC_PERFORMANCE: "Performa Akademik",
  TAHFIDZ_PROGRESS: "Progres Tahfidz",
  HEALTH_SUMMARY: "Ringkasan Kesehatan",
  VIOLATION_SUMMARY: "Ringkasan Pelanggaran",
  LIBRARY_STATISTICS: "Statistik Perpustakaan",
  SPMB_STATISTICS: "Statistik SPMB",
  PSB_STATISTICS: "Statistik PSB",
};

export const TIME_RANGES: TimeRange[] = [
  "WEEKLY",
  "MONTHLY",
  "QUARTERLY",
  "YEARLY",
  "CUSTOM",
];

export const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  WEEKLY: "Mingguan",
  MONTHLY: "Bulanan",
  QUARTERLY: "Triwulan",
  YEARLY: "Tahunan",
  CUSTOM: "Kustom",
};

// Hooks
export function useDashboardSummary() {
  return useQuery({
    queryKey: ["analytics", "dashboard-summary"],
    queryFn: async () => {
      const { data } = await api.get<{ data: DashboardSummary }>(
        "/analytics/dashboard",
      );
      return data;
    },
  });
}

export function useStudentStatistics(filter?: ReportFilter) {
  return useQuery({
    queryKey: ["analytics", "student-statistics", filter],
    queryFn: async () => {
      const { data } = await api.get<{ data: StudentStatistics }>(
        "/analytics/students",
        {
          params: filter,
        },
      );
      return data;
    },
  });
}

export function useAttendanceSummaryAnalytics(filter?: ReportFilter) {
  return useQuery({
    queryKey: ["analytics", "attendance-summary", filter],
    queryFn: async () => {
      const { data } = await api.get<{ data: AnalyticsAttendanceSummary }>(
        "/analytics/attendance",
        {
          params: filter,
        },
      );
      return data;
    },
  });
}

export function useFinanceReport(filter?: ReportFilter) {
  return useQuery({
    queryKey: ["analytics", "finance-report", filter],
    queryFn: async () => {
      const { data } = await api.get<{ data: FinanceReport }>(
        "/analytics/finance",
        {
          params: filter,
        },
      );
      return data;
    },
  });
}

export function useAcademicPerformance(filter?: ReportFilter) {
  return useQuery({
    queryKey: ["analytics", "academic-performance", filter],
    queryFn: async () => {
      const { data } = await api.get<{ data: AcademicPerformance }>(
        "/analytics/academic",
        {
          params: filter,
        },
      );
      return data;
    },
  });
}

export function useTahfidzProgress(filter?: ReportFilter) {
  return useQuery({
    queryKey: ["analytics", "tahfidz-progress", filter],
    queryFn: async () => {
      const { data } = await api.get<{ data: TahfidzProgress }>(
        "/analytics/tahfidz",
        {
          params: filter,
        },
      );
      return data;
    },
  });
}

export function useGRCStats(unitId?: string) {
  return useQuery({
    queryKey: ["analytics", "grc", unitId],
    queryFn: async () => {
      const { data } = await api.get<{ data: GRCStats }>("/analytics/grc", {
        params: { unitId },
      });
      return data;
    },
  });
}

export function useExportReport(reportType: ReportType, filter?: ReportFilter) {
  return useQuery({
    queryKey: ["analytics", "export", reportType, filter],
    queryFn: async () => {
      const { data } = await api.get(`/analytics/export/${reportType}`, {
        params: filter,
        responseType: "blob",
      });
      return data;
    },
    enabled: false, // Only run when explicitly called
  });
}

export function useMarketingROI() {
  return useQuery({
    queryKey: ["marketing-roi"],
    queryFn: async () => {
      const response = await api.get("/marketing/roi");
      return response.data;
    },
  });
}

export interface UnitBenchmarkMetric {
  unitId: string;
  unitName: string;
  unitType: string;
  studentCount: number;
  attendanceRate: number;
  paymentCollectionRate: number;
  tahfidzProgress: number;
  academicAverage: number;
}

export interface BenchmarkComparison {
  units: UnitBenchmarkMetric[];
  averages: {
    attendanceRate: number;
    paymentCollectionRate: number;
    tahfidzProgress: number;
    academicAverage: number;
  };
}

/** Cross-unit performance comparison (GET /analytics/benchmark/compare). */
export function useBenchmarkComparison() {
  return useQuery({
    queryKey: ["analytics", "benchmark-comparison"],
    queryFn: async () => {
      const res = await api.get<{ data: BenchmarkComparison }>(
        "/analytics/benchmark/compare",
      );
      return res.data.data;
    },
  });
}

/** Parent engagement analytics (GET /analytics/parent-engagement, admin only). */
export function useParentEngagement(unitId?: string) {
  return useQuery({
    queryKey: ["analytics", "parent-engagement", unitId],
    queryFn: async () => {
      const res = await api.get<{ data: ParentEngagementStats }>(
        "/analytics/parent-engagement",
        { params: unitId ? { unitId } : undefined },
      );
      return res.data.data;
    },
  });
}

export interface RiskMatrixData {
  likelihoodLabels: string[];
  impactLabels: string[];
  inherent: number[][];
  residual: number[][];
}

/** Inherent vs residual 5x5 risk matrix (GET /analytics/grc/risk-matrix). */
export function useRiskMatrix(unitId?: string) {
  return useQuery({
    queryKey: ["analytics", "grc-risk-matrix", unitId],
    queryFn: async () => {
      const res = await api.get<{ data: RiskMatrixData }>(
        "/analytics/grc/risk-matrix",
        { params: unitId ? { unitId } : undefined },
      );
      return res.data.data;
    },
  });
}
