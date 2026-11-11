/**
 * The notification settings calls: preferences, Web Push and the mail
 * transport. Consumed by `hooks/use-notification-preferences.ts` and
 * `hooks/use-web-push.ts`; pages use those hooks, not this file.
 */

import { api } from "@/lib/api";
import type {
  ApiResponse,
  EmailTransportStatus,
  NotificationPreferencesDTO,
  UpdateNotificationPreferencesInput,
  WebPushConfigDTO,
  WebPushSubscriptionPayload,
} from "@cipansor/shared";

/** `kind: "log"` means nothing is configured and no mail leaves the building. */
export type { EmailTransportStatus };

export const notificationsApi = {
  /**
   * Which mail transport the server is actually using, and the identity it
   * sends under — asked rather than assumed, so the settings page cannot
   * describe a working setup the server does not have.
   */
  async getEmailTransport(): Promise<EmailTransportStatus> {
    const response = await api.get<ApiResponse<EmailTransportStatus>>(
      "/notifications/settings/email-transport",
    );
    return response.data.data as EmailTransportStatus;
  },

  /** The caller's notification preferences (the defaults until first saved). */
  async getPreferences(): Promise<NotificationPreferencesDTO> {
    const response = await api.get<ApiResponse<NotificationPreferencesDTO>>(
      "/notifications/preferences",
    );
    return response.data.data as NotificationPreferencesDTO;
  },

  /** Change any subset of the caller's preferences; returns what was stored. */
  async updatePreferences(
    preferences: UpdateNotificationPreferencesInput,
  ): Promise<NotificationPreferencesDTO> {
    const response = await api.patch<ApiResponse<NotificationPreferencesDTO>>(
      "/notifications/preferences",
      preferences,
    );
    return response.data.data as NotificationPreferencesDTO;
  },

  /** The server's VAPID public key, or null when it does not send push. */
  async pushConfig(): Promise<WebPushConfigDTO> {
    const response = await api.get<ApiResponse<WebPushConfigDTO>>(
      "/notifications/push/config",
      { skipErrorToast: true },
    );
    return response.data.data as WebPushConfigDTO;
  },

  /**
   * Subscribe this browser. Takes the raw endpoint + keys the caller read off
   * the live subscription, exactly what the API stores.
   */
  async subscribePush(subscription: WebPushSubscriptionPayload): Promise<void> {
    await api.post("/notifications/push/subscribe", { subscription });
  },

  /** Drop one device: a user may have several. */
  async unsubscribePush(endpoint: string): Promise<void> {
    await api.post("/notifications/push/unsubscribe", { endpoint });
  },

  /**
   * Whether the API has a stored row for this browser endpoint — the server's
   * view, which can disagree with the browser after a failed registration or
   * a logout-time purge.
   */
  async pushStatus(endpoint: string): Promise<boolean> {
    const response = await api.get<ApiResponse<{ registered: boolean }>>(
      "/notifications/push/status",
      {
        params: { endpoint },
        // A failed probe reads as "not registered"; the card explains itself.
        skipErrorToast: true,
      },
    );
    return Boolean(response.data.data?.registered);
  },
};
