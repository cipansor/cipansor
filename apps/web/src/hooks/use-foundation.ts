import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  BoardMember,
  FoundationFinancialOverview,
} from "@cipansor/shared";
import api from "@/lib/api";

// Types
/** The yayasan's record, as `foundations` stores it. */
export interface Foundation {
  id: string;
  name: string;
  legalName: string;
  foundingDate?: string | null;
  taxId?: string | null;
  address: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  logoUrl?: string | null;
  vision?: string | null;
  mission?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The fields the profile form edits (`PUT /foundation/:id`). */
export type FoundationProfileInput = Partial<
  Pick<
    Foundation,
    | "name"
    | "legalName"
    | "taxId"
    | "address"
    | "phone"
    | "email"
    | "website"
    | "vision"
    | "mission"
  >
> & { foundingDate?: string };

export interface FoundationDocument {
  id: string;
  foundationId: string;
  name: string;
  type: DocumentType;
  description?: string;
  documentNumber?: string;
  fileUrl: string;
  issuedDate?: string;
  expiryDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export type DocumentType =
  | "AKTA_PENDIRIAN"
  | "SK_KEMENKUMHAM"
  | "NPWP"
  | "IZIN_OPERASIONAL"
  | "AKREDITASI"
  | "SERTIFIKAT_TANAH"
  | "IMB"
  | "OTHER";

export const DOCUMENT_TYPES: DocumentType[] = [
  "AKTA_PENDIRIAN",
  "SK_KEMENKUMHAM",
  "NPWP",
  "IZIN_OPERASIONAL",
  "AKREDITASI",
  "SERTIFIKAT_TANAH",
  "IMB",
  "OTHER",
];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  AKTA_PENDIRIAN: "Akta Pendirian",
  SK_KEMENKUMHAM: "SK Kemenkumham",
  NPWP: "NPWP",
  IZIN_OPERASIONAL: "Izin Operasional",
  AKREDITASI: "Akreditasi",
  SERTIFIKAT_TANAH: "Sertifikat Tanah",
  IMB: "IMB",
  OTHER: "Lainnya",
};

/** The API's board member — a member of the Pembina, Pengawas or Pengurus. */
export type FoundationBoardMember = BoardMember;

/** POST/PUT body of /foundation/board-members, as the portal's form sends it. */
export interface FoundationBoardMemberInput {
  name: string;
  position: string;
  phone: string | null;
  email: string | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
}

// Foundation queries
/**
 * The yayasan's own record. `GET /foundation` lists foundations; the yayasan
 * has exactly one, so the first row is it.
 */
export function useFoundation() {
  return useQuery({
    queryKey: ["foundation"],
    queryFn: async () => {
      const response = await api.get<{ data: Foundation[] }>("/foundation");
      return (response.data.data?.[0] ?? null) as Foundation | null;
    },
  });
}

export function useUpdateFoundation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: FoundationProfileInput;
    }) => {
      const response = await api.put(`/foundation/${id}`, data);
      return response.data.data as Foundation;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["foundation"] });
    },
  });
}

export function useFoundationFinancialOverview() {
  return useQuery({
    queryKey: ["foundation", "financial-overview"],
    queryFn: async () => {
      const response = await api.get("/foundation/stats/financial");
      return response.data.data as FoundationFinancialOverview;
    },
  });
}

// Document queries
export function useFoundationDocuments() {
  return useQuery({
    queryKey: ["foundation-documents"],
    queryFn: async () => {
      const response = await api.get("/foundation/documents");
      return response.data.data as FoundationDocument[];
    },
  });
}

export function useFoundationDocument(id: string) {
  return useQuery({
    queryKey: ["foundation-document", id],
    queryFn: async () => {
      const response = await api.get(`/foundation/documents/${id}`);
      return response.data.data as FoundationDocument;
    },
    enabled: !!id,
  });
}

export function useCreateFoundationDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: FormData) => {
      const response = await api.post("/foundation/documents", data, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["foundation-documents"] });
    },
  });
}

export function useUpdateFoundationDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormData }) => {
      const response = await api.put(`/foundation/documents/${id}`, data, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["foundation-documents"] });
    },
  });
}

export function useDeleteFoundationDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/foundation/documents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["foundation-documents"] });
    },
  });
}

// Board member queries
export function useFoundationBoardMembers(params?: { isActive?: boolean }) {
  return useQuery({
    queryKey: ["foundation-board-members", params],
    queryFn: async () => {
      const response = await api.get("/foundation/board-members", { params });
      return response.data.data as FoundationBoardMember[];
    },
  });
}

export function useFoundationBoardMember(id: string) {
  return useQuery({
    queryKey: ["foundation-board-member", id],
    queryFn: async () => {
      const response = await api.get(`/foundation/board-members/${id}`);
      return response.data.data as FoundationBoardMember;
    },
    enabled: !!id,
  });
}

export function useCreateFoundationBoardMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: FoundationBoardMemberInput) => {
      const response = await api.post("/foundation/board-members", data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["foundation-board-members"] });
    },
  });
}

export function useUpdateFoundationBoardMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<FoundationBoardMemberInput>;
    }) => {
      const response = await api.put(`/foundation/board-members/${id}`, data);
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["foundation-board-members"] });
    },
  });
}

export function useDeleteFoundationBoardMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/foundation/board-members/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["foundation-board-members"] });
    },
  });
}
