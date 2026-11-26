import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  OFFERED_DONATION_TYPES,
  type DonationMonthlyReport,
  type OfferedDonationType,
} from "@cipansor/shared";
import api, { ApiResponse, PaginatedResponse } from "@/lib/api";

// =====================================
// Types
// =====================================

export type CampaignStatus = "DRAFT" | "ACTIVE" | "COMPLETED" | "CLOSED";
export type DonationType =
  | "INFAK"
  | "INFAK_BULANAN"
  | "ZAKAT_MAAL"
  | "ZAKAT_FITRAH"
  | "WAKAF"
  | "SEDEKAH_JARIYAH"
  | "PEMBANGUNAN"
  | "BEASISWA"
  | "OTHERS";
export type PaymentMethod =
  "CASH" | "BANK_TRANSFER" | "QRIS" | "EWALLET" | "OTHERS";
export type DonationStatus = "PENDING" | "VERIFIED" | "CANCELLED";

export interface DonationCampaign {
  id: string;
  unitId?: string;
  title: string;
  slug: string;
  description?: string;
  targetAmount: number;
  collectedAmount: number;
  donorCount: number;
  startDate?: string;
  endDate?: string;
  status: CampaignStatus;
  imageUrl?: string;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  unit?: { id: string; name: string };
  createdBy?: { id: string; name: string };
  donations?: Donation[];
  recentDonations?: Donation[];
  progressPercentage?: number;
}

export interface Donation {
  id: string;
  campaignId?: string;
  donorName: string;
  donorPhone?: string;
  donorEmail?: string;
  donorAddress?: string;
  isAnonymous: boolean;
  type: DonationType;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentProof?: string;
  status: DonationStatus;
  verifiedById?: string;
  verifiedAt?: string;
  notes?: string;
  message?: string;
  createdAt: string;
  updatedAt: string;
  campaign?: { id: string; title: string };
  verifiedBy?: { id: string; name: string };
}

export interface DonationStats {
  totalCampaigns: number;
  activeCampaigns: number;
  totalDonations: number;
  totalAmount: number;
  pendingVerification: number;
  thisMonth: number;
}

// =====================================
// Constants
// =====================================

export const CAMPAIGN_STATUSES: {
  value: CampaignStatus;
  label: string;
  color: string;
}[] = [
  { value: "DRAFT", label: "Draft", color: "bg-gray-100 text-gray-800" },
  { value: "ACTIVE", label: "Aktif", color: "bg-green-100 text-green-800" },
  { value: "COMPLETED", label: "Selesai", color: "bg-blue-100 text-blue-800" },
  { value: "CLOSED", label: "Ditutup", color: "bg-red-100 text-red-800" },
];

export const DONATION_TYPES: { value: DonationType; label: string }[] = [
  { value: "INFAK", label: "Infak" },
  { value: "INFAK_BULANAN", label: "Infak Bulanan" },
  { value: "ZAKAT_MAAL", label: "Zakat Maal" },
  { value: "ZAKAT_FITRAH", label: "Zakat Fitrah" },
  { value: "WAKAF", label: "Wakaf" },
  { value: "SEDEKAH_JARIYAH", label: "Sedekah Jariyah" },
  { value: "PEMBANGUNAN", label: "Pembangunan" },
  { value: "BEASISWA", label: "Beasiswa" },
  { value: "OTHERS", label: "Lainnya" },
];

/**
 * The types a new donation may be given as — every type above minus zakat,
 * which the yayasan does not offer (see `OFFERED_DONATION_TYPES` in shared).
 * `DONATION_TYPES` stays whole: it names donations recorded before.
 */
export const OFFERED_DONATION_TYPE_OPTIONS = DONATION_TYPES.filter(
  (t): t is { value: OfferedDonationType; label: string } =>
    (OFFERED_DONATION_TYPES as readonly string[]).includes(t.value),
);

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "CASH", label: "Tunai" },
  { value: "BANK_TRANSFER", label: "Transfer Bank" },
  { value: "QRIS", label: "QRIS" },
  { value: "EWALLET", label: "E-Wallet" },
  { value: "OTHERS", label: "Lainnya" },
];

export const DONATION_STATUSES: {
  value: DonationStatus;
  label: string;
  color: string;
}[] = [
  {
    value: "PENDING",
    label: "Menunggu",
    color: "bg-yellow-100 text-yellow-800",
  },
  {
    value: "VERIFIED",
    label: "Terverifikasi",
    color: "bg-green-100 text-green-800",
  },
  { value: "CANCELLED", label: "Dibatalkan", color: "bg-red-100 text-red-800" },
];

// =====================================
// Campaign Hooks
// =====================================

export interface CampaignParams {
  page?: number;
  limit?: number;
  unitId?: string;
  status?: CampaignStatus;
  search?: string;
}

export function useCampaigns(params: CampaignParams = {}) {
  return useQuery({
    queryKey: ["donation", "campaigns", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<DonationCampaign>>(
        "/donation/campaigns",
        { params },
      );
      return response.data;
    },
  });
}

export function useCampaign(id: string) {
  return useQuery({
    queryKey: ["donation", "campaigns", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<DonationCampaign>>(
        `/donation/campaigns/${id}`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function usePublicCampaigns() {
  return useQuery({
    queryKey: ["donation", "campaigns", "public"],
    queryFn: async () => {
      const response = await api.get<ApiResponse<DonationCampaign[]>>(
        "/donation/campaigns/public",
      );
      // The API returns { success: true, data: [...] } so we just need to return the data array
      // However, to match PaginatedResponse interface expected by consumers, we wrap it
      return { data: response.data.data || [] };
    },
  });
}

export function usePublicCampaignBySlug(slug: string) {
  return useQuery({
    queryKey: ["donation", "campaigns", "slug", slug],
    queryFn: async () => {
      const response = await api.get<ApiResponse<DonationCampaign>>(
        `/donation/campaigns/slug/${slug}`,
      );
      return response.data.data;
    },
    enabled: !!slug,
  });
}

export interface CreateCampaignData {
  unitId?: string;
  title: string;
  description?: string;
  targetAmount: number;
  startDate?: string;
  endDate?: string;
  status?: CampaignStatus;
  imageUrl?: string;
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateCampaignData) => {
      const response = await api.post<ApiResponse<DonationCampaign>>(
        "/donation/campaigns",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["donation", "campaigns"] });
    },
  });
}

export function useUpdateCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateCampaignData>;
    }) => {
      const response = await api.put<ApiResponse<DonationCampaign>>(
        `/donation/campaigns/${id}`,
        data,
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["donation", "campaigns"] });
      queryClient.invalidateQueries({
        queryKey: ["donation", "campaigns", variables.id],
      });
    },
  });
}

export function useDeleteCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/donation/campaigns/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["donation", "campaigns"] });
    },
  });
}

// =====================================
// Donation Hooks
// =====================================

export interface DonationParams {
  page?: number;
  limit?: number;
  campaignId?: string;
  status?: DonationStatus;
  type?: DonationType;
  startDate?: string;
  endDate?: string;
}

export function useDonations(params: DonationParams = {}) {
  return useQuery({
    queryKey: ["donation", "donations", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<Donation>>("/donation", {
        params,
      });
      return response.data;
    },
  });
}

export function useDonation(id: string) {
  return useQuery({
    queryKey: ["donation", "donations", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Donation>>(`/donation/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

export function useDonationStats() {
  return useQuery({
    queryKey: ["donation", "stats"],
    queryFn: async () => {
      const response =
        await api.get<ApiResponse<DonationStats>>("/donation/stats");
      return response.data.data;
    },
  });
}

export function useDonationMonthlyReport(year: number) {
  return useQuery({
    queryKey: ["donation", "monthly-report", year],
    queryFn: async () => {
      const response = await api.get<ApiResponse<DonationMonthlyReport>>(
        "/donation/monthly-report",
        { params: { year } },
      );
      return response.data.data;
    },
  });
}

export function useRecentDonations(limit = 5) {
  return useQuery({
    queryKey: ["donation", "recent", limit],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Donation[]>>(
        "/donation/recent",
        {
          params: { limit },
        },
      );
      return response.data.data;
    },
  });
}

export interface CreateDonationData {
  campaignId?: string;
  donorName: string;
  donorPhone?: string;
  donorEmail?: string;
  donorAddress?: string;
  isAnonymous?: boolean;
  type: OfferedDonationType;
  amount: number;
  paymentMethod: PaymentMethod;
  paymentProof?: string;
  notes?: string;
  /** Token Turnstile; hanya dipakai jalur publik, diabaikan jalur terautentikasi. */
  turnstileToken?: string;
}

export function useCreateDonation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateDonationData) => {
      const response = await api.post<ApiResponse<Donation>>("/donation", data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["donation"] });
    },
  });
}

export function useCreatePublicDonation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateDonationData) => {
      const response = await api.post<ApiResponse<Donation>>(
        "/donation/public",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["donation", "campaigns", "public"],
      });
      queryClient.invalidateQueries({
        queryKey: ["donation", "campaigns", "slug"],
      });
    },
  });
}

export function useVerifyDonation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      status,
    }: {
      id: string;
      status: DonationStatus;
    }) => {
      const response = await api.put<ApiResponse<Donation>>(
        `/donation/${id}/verify`,
        { status },
      );
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["donation"] });
      queryClient.invalidateQueries({
        queryKey: ["donation", "donations", variables.id],
      });
    },
  });
}

export function useDeleteDonation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/donation/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["donation"] });
    },
  });
}

// Utility functions
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function calculateProgress(collected: number, target: number): number {
  if (target <= 0) return 0;
  return Math.min(Math.round((collected / target) * 100), 100);
}
