import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { ApiResponse, PaginatedResponse } from "@/lib/api";

export type EventCategory =
  | "ACADEMIC"
  | "RELIGIOUS"
  | "EXTRACURRICULAR"
  | "HOLIDAY"
  | "MEETING"
  | "EXAM"
  | "OTHER";
export type EventRecurrence =
  "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface CalendarEvent {
  id: string;
  title: string;
  description?: string;
  category: EventCategory;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  isAllDay: boolean;
  location?: string;
  unitId?: string;
  classId?: string;
  recurrence: EventRecurrence;
  recurrenceEnd?: string;
  color?: string;
  isPublic: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  unit?: {
    id: string;
    name: string;
  };
  class?: {
    id: string;
    name: string;
  };
  creator?: {
    id: string;
    name: string;
  };
}

export interface EventCategoryConfig {
  value: EventCategory;
  label: string;
  labelEn: string;
  color: string;
  bgColor: string;
  icon: string;
}

export const EVENT_CATEGORIES: EventCategoryConfig[] = [
  {
    value: "ACADEMIC",
    label: "Akademik",
    labelEn: "Academic",
    color: "#2563eb",
    bgColor: "bg-blue-100 text-blue-800",
    icon: "GraduationCap",
  },
  {
    value: "RELIGIOUS",
    label: "Keagamaan",
    labelEn: "Religious",
    color: "#059669",
    bgColor: "bg-emerald-100 text-emerald-800",
    icon: "BookOpen",
  },
  {
    value: "EXTRACURRICULAR",
    label: "Ekstrakurikuler",
    labelEn: "Extracurricular",
    color: "#7c3aed",
    bgColor: "bg-purple-100 text-purple-800",
    icon: "Trophy",
  },
  {
    value: "HOLIDAY",
    label: "Hari Libur",
    labelEn: "Holiday",
    color: "#dc2626",
    bgColor: "bg-red-100 text-red-800",
    icon: "Calendar",
  },
  {
    value: "MEETING",
    label: "Rapat",
    labelEn: "Meeting",
    color: "#ea580c",
    bgColor: "bg-orange-100 text-orange-800",
    icon: "Users",
  },
  {
    value: "EXAM",
    label: "Ujian",
    labelEn: "Exam",
    color: "#0891b2",
    bgColor: "bg-cyan-100 text-cyan-800",
    icon: "FileText",
  },
  {
    value: "OTHER",
    label: "Lainnya",
    labelEn: "Other",
    color: "#6b7280",
    bgColor: "bg-gray-100 text-gray-800",
    icon: "MoreHorizontal",
  },
];

export const EVENT_RECURRENCES: { value: EventRecurrence; label: string }[] = [
  { value: "NONE", label: "Tidak Berulang" },
  { value: "DAILY", label: "Setiap Hari" },
  { value: "WEEKLY", label: "Setiap Minggu" },
  { value: "MONTHLY", label: "Setiap Bulan" },
  { value: "YEARLY", label: "Setiap Tahun" },
];

export interface CalendarEventParams {
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
  category?: EventCategory;
  unitId?: string;
  classId?: string;
  isPublic?: boolean;
  month?: number;
  year?: number;
}

export function useCalendarEvents(params: CalendarEventParams = {}) {
  return useQuery({
    queryKey: ["calendar-events", params],
    queryFn: async () => {
      const response = await api.get<PaginatedResponse<CalendarEvent>>(
        "/calendar",
        { params },
      );
      return response.data;
    },
  });
}

export function useMonthEvents(year: number, month: number, unitId?: string) {
  return useQuery({
    queryKey: ["calendar-events", "month", year, month, unitId],
    queryFn: async () => {
      const startDate = new Date(year, month, 1).toISOString().split("T")[0];
      const endDate = new Date(year, month + 1, 0).toISOString().split("T")[0];
      const response = await api.get<ApiResponse<CalendarEvent[]>>(
        "/calendar",
        {
          params: { startDate, endDate, unitId, limit: 100 },
        },
      );
      return response.data.data;
    },
  });
}

export interface CreateCalendarEventData {
  title: string;
  description?: string;
  category: EventCategory;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  isAllDay: boolean;
  location?: string;
  unitId?: string;
  classId?: string;
  recurrence: EventRecurrence;
  recurrenceEnd?: string;
  color?: string;
  isPublic: boolean;
}

export function useCreateCalendarEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateCalendarEventData) => {
      const response = await api.post<ApiResponse<CalendarEvent>>(
        "/calendar",
        data,
      );
      return response.data.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
    },
  });
}

export function useDeleteCalendarEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/calendar/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
    },
  });
}

// Helper function to get event color
export function getEventCategoryColor(category: EventCategory): string {
  return EVENT_CATEGORIES.find((c) => c.value === category)?.color || "#6b7280";
}

export function getEventCategoryConfig(
  category: EventCategory,
): EventCategoryConfig | undefined {
  return EVENT_CATEGORIES.find((c) => c.value === category);
}
