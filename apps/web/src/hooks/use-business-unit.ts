import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export type BusinessUnitType =
  "CANTEEN" | "LAUNDRY" | "COOPERATIVE" | "BOOKSTORE" | "OTHER";

export interface BusinessUnit {
  id: string;
  name: string;
  code: string;
  type: BusinessUnitType;
  isActive: boolean;
  unitId: string;
  unit?: { id: string; name: string };
  manager?: { id: string; name: string } | null;
  monthlyRevenue: number;
  monthlyTransactions: number;
  _count?: {
    canteenItems: number;
    canteenTransactions: number;
    laundryTransactions: number;
  };
}

export interface BusinessUnitPerformance {
  revenue: number;
  transactionCount: number;
}

export interface BusinessUnitEfficiencyItem {
  id: string;
  name: string;
  stock: number;
  turnover: number;
  efficiencyScore: number;
}

export interface BusinessUnitEfficiency {
  unitId: string;
  type: BusinessUnitType;
  overallEfficiency: number;
  topItems?: BusinessUnitEfficiencyItem[];
  lowItems?: BusinessUnitEfficiencyItem[];
  message?: string;
}

/** List business units with current-month revenue (GET /business-units). */
export function useBusinessUnits(
  params?: {
    type?: BusinessUnitType;
    isActive?: boolean;
  },
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: ["business-units", params],
    queryFn: async () => {
      const response = await api.get<{ data: BusinessUnit[] }>(
        "/business-units",
        { params },
      );
      return response.data.data;
    },
    enabled: options?.enabled ?? true,
  });
}

export function useBusinessUnit(id: string) {
  return useQuery({
    queryKey: ["business-units", id],
    queryFn: async () => {
      const response = await api.get<{ data: BusinessUnit }>(
        `/business-units/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useBusinessUnitPerformance(
  id: string,
  range?: { startDate?: string; endDate?: string },
) {
  return useQuery({
    queryKey: ["business-units", id, "performance", range],
    queryFn: async () => {
      const response = await api.get<{ data: BusinessUnitPerformance }>(
        `/business-units/${id}/performance`,
        { params: range },
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useBusinessUnitEfficiency(id: string) {
  return useQuery({
    queryKey: ["business-units", id, "efficiency"],
    queryFn: async () => {
      const response = await api.get<{ data: BusinessUnitEfficiency }>(
        `/business-units/${id}/efficiency`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}
