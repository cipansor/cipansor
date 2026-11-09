"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  NotificationPreferencesDTO,
  UpdateNotificationPreferencesInput,
} from "@cipansor/shared";
import { notificationsApi } from "@/lib/notifications-api";

const KEY = ["notification-preferences"] as const;

/** The signed-in person's notification preferences, as stored on the server. */
export function useNotificationPreferences() {
  return useQuery<NotificationPreferencesDTO>({
    queryKey: KEY,
    queryFn: () => notificationsApi.getPreferences(),
  });
}

/**
 * Save a change. The server answers with what it stored, which becomes the
 * cached value — the page then shows the saved state, not the one it sent.
 */
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: UpdateNotificationPreferencesInput) =>
      notificationsApi.updatePreferences(changes),
    onSuccess: (saved) => queryClient.setQueryData(KEY, saved),
  });
}

/**
 * The mail transport the server is configured with. Only an administrator
 * may ask, so the caller passes whether to ask at all.
 */
export function useEmailTransport(enabled: boolean) {
  return useQuery({
    queryKey: ["email-transport"],
    queryFn: () => notificationsApi.getEmailTransport(),
    enabled,
  });
}
