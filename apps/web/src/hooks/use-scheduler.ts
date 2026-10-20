"use client";

import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";

/**
 * Run one registered notification-scheduler task by hand (the Scheduler tab's
 * "Jalankan" button, #802).
 *
 * `skipErrorToast` leaves error reporting to the page: it knows whether to say
 * "Gagal menjalankan tugas" or show the server's message, and without the flag
 * the interceptor would toast first and the page's catch would toast again.
 */
export function useTriggerScheduledTask() {
  return useMutation({
    mutationFn: async (task: string) => {
      const response = await api.post(
        "/notifications/scheduler/trigger",
        { task },
        { skipErrorToast: true },
      );
      return response.data as { success: boolean; message: string };
    },
  });
}
