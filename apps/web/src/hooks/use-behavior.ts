import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { ApiResponse } from "@/lib/api";
import { toast } from "sonner";
import type { HomeroomNote, HomeroomNoteInput } from "@cipansor/shared";

/**
 * A class's notes, newest first, as its wali kelas and the unit's kepala
 * sekolah and admin unit read them. Each says whether the caller may change it.
 */
export function useBehaviorRecords(classId?: string) {
  return useQuery({
    queryKey: ["behavior-records", classId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<HomeroomNote[]>>(
        "/homeroom/behavior",
        { params: { classId } },
      );
      return response.data.data;
    },
    enabled: !!classId,
  });
}

/** A note by the wali kelas: positive (a reward) or needing attention. */
export function useCreateBehaviorRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: HomeroomNoteInput) => {
      const response = await api.post("/homeroom/behavior", data);
      return response.data.data;
    },
    onSuccess: () => {
      toast.success("Catatan perilaku berhasil ditambahkan");
      queryClient.invalidateQueries({ queryKey: ["behavior-records"] });
    },
    onError: (error: {
      response?: { data?: { error?: { message?: string } } };
    }) => {
      toast.error(
        error.response?.data?.error?.message || "Gagal menambahkan catatan",
      );
    },
  });
}

/** Remove a note — only its author, while they write for the class. */
export function useDeleteBehaviorRecord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (note: Pick<HomeroomNote, "id" | "kind">) => {
      await api.delete(`/homeroom/notes/${note.id}`, {
        params: { noteType: note.kind },
      });
    },
    onSuccess: () => {
      toast.success("Catatan dihapus");
      queryClient.invalidateQueries({ queryKey: ["behavior-records"] });
    },
    onError: (error: {
      response?: { data?: { error?: { message?: string } } };
    }) => {
      toast.error(
        error.response?.data?.error?.message || "Gagal menghapus catatan",
      );
    },
  });
}
