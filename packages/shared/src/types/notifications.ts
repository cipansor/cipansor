import type { WebPushSubscription } from "../schemas/notifications";

export type NotificationType =
  | "ANNOUNCEMENT"
  | "ATTENDANCE"
  | "FINANCE"
  | "ACADEMIC"
  | "PERMIT"
  | "HEALTH"
  | "VIOLATION"
  | "REWARD"
  | "SYSTEM";

export type NotificationPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export type NotificationChannel =
  "IN_APP" | "EMAIL" | "SMS" | "PUSH" | "WHATSAPP";
export type RecipientType = "ALL" | "UNIT" | "CLASS" | "ROLE" | "INDIVIDUAL";

/** The mail transport the API runs with (`GET /notifications/settings/email-transport`). */
export type EmailTransportKind = "gmail_api" | "smtp" | "log";

export interface EmailTransportStatus {
  kind: EmailTransportKind;
  /** False only for `log`: nothing will be delivered. */
  configured: boolean;
  /** The From header recipients will see. */
  from: string;
  /** Where a reply goes. Deliberately not the From mailbox. */
  replyTo: string;
  /** Gmail API only: the impersonated mailbox. */
  sender?: string;
  /** SMTP only: host:port. */
  host?: string;
}

/**
 * One notification in the caller's own inbox (GET /notifications), as the API
 * sends it: a `Notification` row. `type` is the type it was sent as — the
 * API stores ATTENDANCE as ACADEMIC and hands the original back. (The type
 * this replaced described a per-recipient link row that does not exist.)
 */
export interface MyNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  status: "UNREAD" | "READ" | "ARCHIVED";
  readAt: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface MyNotificationsPage {
  data: MyNotification[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    unreadCount: number;
  };
}

export interface DashboardNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  data?: Record<string, unknown>;
  createdAt: string | Date;
}

/**
 * A browser Web Push subscription as the client sends it to the API.
 *
 * Inferred from `webPushSubscriptionSchema` in `schemas/notifications.ts` —
 * that schema is the one home for the shape; the API validates with it and the
 * web builds the payload from this type, so the two cannot drift. `expirationTime`
 * is null for the common non-expiring subscription.
 */
export type WebPushSubscriptionPayload = WebPushSubscription;
