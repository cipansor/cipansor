"use client";

import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";

// ============================================
// TYPES
// ============================================

export interface WhatsAppMessage {
  to: string;
  message: string;
  type: "text" | "template";
  templateName?: string;
  templateParams?: string[];
}

/** The shape the WhatsApp page's "Kirim Pesan" form posts. */
export interface WhatsAppSendInput {
  phone: string;
  message: string;
}

export interface WhatsAppStatus {
  provider: string;
  configured: boolean;
  testResult?: {
    success: boolean;
    messageId?: string;
    error?: string;
  };
}

export interface WhatsAppSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ============================================
// QUERY KEYS
// ============================================

export const whatsappKeys = {
  all: ["whatsapp"] as const,
  status: () => [...whatsappKeys.all, "status"] as const,
};

// ============================================
// HOOKS
// ============================================

// Get WhatsApp provider status
export function useWhatsAppStatus() {
  return useQuery({
    queryKey: whatsappKeys.status(),
    queryFn: async () => {
      // The page shows its own toast on a failed check; opt out of the
      // interceptor's so one failure is one toast, not two (#804).
      const response = await api.get("/notifications/whatsapp/status", {
        skipErrorToast: true,
      });
      return response.data as WhatsAppStatus;
    },
  });
}

/**
 * The "Cek Status" button: a one-shot status read the page keeps in state.
 * A mutation, not the query above, so it stays an explicit user action.
 */
export function useCheckWhatsAppStatus() {
  return useMutation({
    mutationFn: async () => {
      const response = await api.get("/notifications/whatsapp/status", {
        skipErrorToast: true,
      });
      return response.data as { success: boolean; data: WhatsAppStatus };
    },
  });
}

/**
 * Send one ad-hoc WhatsApp message from the page's form. `skipErrorToast`
 * leaves error reporting to the page, which knows the right wording.
 */
export function useSendWhatsAppMessage() {
  return useMutation({
    mutationFn: async (data: WhatsAppSendInput) => {
      const response = await api.post("/notifications/whatsapp/send", data, {
        skipErrorToast: true,
      });
      return response.data as { success: boolean; data: WhatsAppSendResult };
    },
  });
}

// Send single WhatsApp message
export function useSendWhatsApp() {
  return useMutation({
    mutationFn: async (data: WhatsAppMessage) => {
      const response = await api.post("/notifications/whatsapp/send", data);
      return response.data;
    },
  });
}

// Send daily report via WhatsApp
export function useSendDailyReportWhatsApp() {
  return useMutation({
    mutationFn: async (reportId: string) => {
      const response = await api.post(
        `/daily-report/${reportId}/send-whatsapp`,
      );
      return response.data;
    },
  });
}

// Send tahfidz progress via WhatsApp
export function useSendTahfidzWhatsApp() {
  return useMutation({
    mutationFn: async (progressId: string) => {
      const response = await api.post(`/tahfidz/${progressId}/send-whatsapp`);
      return response.data;
    },
  });
}
