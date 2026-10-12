import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  UnitHead,
  UnitOfficialIdentity,
  UnitSummary,
} from "@cipansor/shared";
import api, { ApiResponse } from "@/lib/api";

/**
 * The single source of truth for unit types on the web side; mirrors the
 * Prisma `UnitType` enum.
 *
 * This list used to stop at SMA_QURAN and was copy-pasted into five places
 * (here, both unit forms, and three times in the API's Zod schema). The
 * database already had UNIT_USAHA and OTHER, so such a unit rendered its type
 * as the raw string — no label matched — and neither form could create or even
 * re-save one, because the value the row already held was not in the form's
 * own enum.
 *
 * Everything below is derived from this array, so adding a type is one edit.
 */
export const UNIT_TYPES = [
  { value: "PESANTREN", label: "Pesantren" },
  { value: "TK_QURAN", label: "TK Qur'an" },
  { value: "SD_IT", label: "SD Islam Terpadu" },
  { value: "SMP_IT", label: "SMP Islam Terpadu" },
  { value: "SMA_QURAN", label: "SMA Qur'an" },
  { value: "UNIT_USAHA", label: "Unit Usaha" },
  { value: "OTHER", label: "Lainnya" },
] as const;

export type UnitType = (typeof UNIT_TYPES)[number]["value"];

/** Tuple form for `z.enum()`, which needs at least one literal. */
export const UNIT_TYPE_VALUES = UNIT_TYPES.map((t) => t.value) as unknown as [
  UnitType,
  ...UnitType[],
];

/** The official identity is absent from the public SPMB projection. */
export interface Unit extends Partial<UnitOfficialIdentity> {
  id: string;
  name: string;
  type: UnitType;
  address?: string;
  phone?: string | null;
  email?: string | null;
  /** Nomor Pokok Sekolah Nasional; the pesantren itself has none. */
  npsn?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on `GET /units`. */
  _count?: { users: number; students: number; classes: number };
}

/**
 * The unit a per-unit board (a leaderboard, say) opens on: the reader's own
 * when it has santri, else the first unit that does, else the first unit.
 *
 * The pesantren's ustadz, musyrif and muhafidz belong to the pesantren unit,
 * which holds none of the schools' santri; opening their board on it would
 * show an empty ranking.
 */
export function defaultSantriUnitId(
  units: Unit[] | undefined,
  ownUnitId?: string | null,
): string | undefined {
  if (!units?.length) return undefined;
  const hasSantri = (u: Unit) => (u._count?.students ?? 0) > 0;
  const own = units.find((u) => u.id === ownUnitId);
  if (own && hasSantri(own)) return own.id;
  return (units.find(hasSantri) ?? own ?? units[0]).id;
}

interface UseUnitsParams {
  page?: number;
  limit?: number;
}

export function useUnits(params?: UseUnitsParams) {
  return useQuery({
    queryKey: ["units", params],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Unit[]>>("/units", { params });
      return response.data.data;
    },
    staleTime: 60 * 60 * 1000, // 1 hour
  });
}

// Hook to get current user's unit based on stored unitId
export function useCurrentUnit() {
  const unitId =
    typeof window !== "undefined" ? localStorage.getItem("unitId") : null;

  return useQuery({
    queryKey: ["units", unitId],
    queryFn: async () => {
      if (!unitId) return null;
      const response = await api.get<ApiResponse<Unit>>(`/units/${unitId}`);
      return response.data.data;
    },
    enabled: !!unitId,
    staleTime: 60 * 60 * 1000, // 1 hour
  });
}

export function useUnit(id: string) {
  return useQuery({
    queryKey: ["units", id],
    queryFn: async () => {
      const response = await api.get<ApiResponse<Unit>>(`/units/${id}`);
      return response.data.data;
    },
    enabled: !!id,
  });
}

/** What the unit's profile counts (GET /units/:id/summary). */
export function useUnitSummary(id: string) {
  return useQuery({
    queryKey: ["units", id, "summary"],
    queryFn: async () => {
      const response = await api.get<ApiResponse<UnitSummary>>(
        `/units/${id}/summary`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

/**
 * Who signs for the unit (GET /units/:id/head): its kepala sekolah or the
 * Pimpinan Pesantren. Null when nobody, or more than one, holds the role — a
 * document then leaves the line to sign by hand.
 */
export function useUnitHead(id: string | undefined) {
  return useQuery({
    queryKey: ["units", id, "head"],
    queryFn: async () => {
      const response = await api.get<ApiResponse<UnitHead | null>>(
        `/units/${id}/head`,
      );
      return response.data.data;
    },
    enabled: !!id,
  });
}

export interface CreateUnitData {
  name: string;
  type: UnitType;
  address?: string;
  phone?: string;
  email?: string;
}

/** PATCH /units/:id — `null` clears an optional field. */
export interface UpdateUnitData {
  name?: string;
  type?: UnitType;
  address?: string;
  phone?: string | null;
  email?: string | null;
  npsn?: string | null;
  officialName?: string | null;
  operatingPermitNumber?: string | null;
  /** YYYY-MM-DD. */
  operatingPermitDate?: string | null;
}

export function useCreateUnit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateUnitData) => {
      const response = await api.post<ApiResponse<Unit>>("/units", data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["units"] });
    },
  });
}

export function useUpdateUnit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateUnitData }) => {
      const response = await api.patch<ApiResponse<Unit>>(`/units/${id}`, data);
      return response.data.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["units"] });
      queryClient.invalidateQueries({ queryKey: ["units", variables.id] });
    },
  });
}

export function useDeleteUnit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/units/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["units"] });
    },
  });
}
