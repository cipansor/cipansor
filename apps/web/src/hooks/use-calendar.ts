import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  EventScope,
  EventType,
  type CalendarEvent as SharedCalendarEvent,
  type CalendarEventListParams,
} from "@cipansor/shared";
import api, { ApiResponse, PaginatedResponse } from "@/lib/api";

/** The API's event enum, shared with the backend (`@cipansor/shared`). */
export type EventCategory = EventType;
export type EventRecurrence =
  "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

/** The shared response shape, plus the relations the list endpoints include. */
export type CalendarEvent = SharedCalendarEvent & {
  unit?: {
    id: string;
    name: string;
  } | null;
  class?: {
    id: string;
    name: string;
  } | null;
};

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
    value: EventType.ACADEMIC,
    label: "Akademik",
    labelEn: "Academic",
    color: "#2563eb",
    bgColor: "bg-blue-100 text-blue-800",
    icon: "GraduationCap",
  },
  {
    value: EventType.RELIGIOUS,
    label: "Keagamaan",
    labelEn: "Religious",
    color: "#059669",
    bgColor: "bg-emerald-100 text-emerald-800",
    icon: "BookOpen",
  },
  {
    value: EventType.EXTRACURRICULAR,
    label: "Ekstrakurikuler",
    labelEn: "Extracurricular",
    color: "#7c3aed",
    bgColor: "bg-purple-100 text-purple-800",
    icon: "Trophy",
  },
  {
    value: EventType.HOLIDAY,
    label: "Hari Libur",
    labelEn: "Holiday",
    color: "#dc2626",
    bgColor: "bg-red-100 text-red-800",
    icon: "Calendar",
  },
  {
    value: EventType.MEETING,
    label: "Rapat",
    labelEn: "Meeting",
    color: "#ea580c",
    bgColor: "bg-orange-100 text-orange-800",
    icon: "Users",
  },
  {
    value: EventType.CEREMONY,
    label: "Upacara",
    labelEn: "Ceremony",
    color: "#0891b2",
    bgColor: "bg-cyan-100 text-cyan-800",
    icon: "FileText",
  },
  {
    value: EventType.OTHER,
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

export type CalendarEventParams = CalendarEventListParams;

/**
 * The instant a non-all-day event really starts. The create form sends a
 * date-only `startDate` plus a WIB `startTime`; the API stores that date at
 * midnight UTC (07:00 WIB) and keeps the time separately. Reading `startDate`
 * alone hides an afternoon event from "Event Mendatang" all morning.
 */
export function eventStartInstant(
  event: Pick<CalendarEvent, "startDate" | "startTime" | "isAllDay">,
): Date {
  const start = new Date(event.startDate);
  if (event.isAllDay || !event.startTime) return start;
  if (start.getUTCHours() || start.getUTCMinutes() || start.getUTCSeconds()) {
    return start;
  }

  const [hours, minutes] = event.startTime.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return start;

  const day = event.startDate.slice(0, 10);
  return new Date(
    `${day}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00+07:00`,
  );
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
      // Build the window in UTC so it names the viewed month exactly. A local
      // `new Date(year, month, 1)` read back with `toISOString()` (always UTC)
      // is a day earlier in WIB (UTC+7), sliding the window at both ends and
      // dropping the month's last day.
      const startDate = new Date(Date.UTC(year, month, 1))
        .toISOString()
        .slice(0, 10);
      const endDate = new Date(Date.UTC(year, month + 1, 0))
        .toISOString()
        .slice(0, 10);
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

/**
 * The unit whose agenda the page asks for: an explicit filter, else the
 * session's active-role unit. The profile's home unit (`user.unit`) is not it —
 * a person whose role covers another unit would read that other unit's private
 * agenda under their own name.
 */
export function agendaUnitIdFor(
  selectedUnitId: string,
  user:
    { unitId?: string | null; unit?: { id: string } | null } | null | undefined,
): string {
  return selectedUnitId || user?.unitId || "";
}

/**
 * Today's agenda for a unit (`GET /calendar/today/:unitId`). The API bounds
 * "today" by the WIB calendar day, so the portal asks it rather than filtering
 * the month window on the browser clock. Nothing is asked until a unit is known.
 */
export function useTodayEvents(unitId?: string) {
  return useQuery({
    queryKey: ["calendar-events", "today", unitId],
    queryFn: async () => {
      const response = await api.get<ApiResponse<CalendarEvent[]>>(
        `/calendar/today/${unitId}`,
      );
      return response.data.data;
    },
    enabled: !!unitId,
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
    mutationFn: async ({
      category,
      recurrence,
      recurrenceEnd,
      ...data
    }: CreateCalendarEventData) => {
      // The form keeps the portal's friendly name and recurrence; the API
      // stores `eventType`, a scope and an iCal rule.
      const response = await api.post<ApiResponse<CalendarEvent>>("/calendar", {
        ...data,
        eventType: category,
        scope: data.classId
          ? EventScope.SPECIFIC_CLASS
          : data.unitId
            ? EventScope.SPECIFIC_UNIT
            : EventScope.ALL_UNITS,
        isRecurring: recurrence !== "NONE",
        recurrenceRule:
          recurrence === "NONE"
            ? undefined
            : `FREQ=${recurrence}${
                recurrenceEnd
                  ? `;UNTIL=${recurrenceEnd.replace(/-/g, "")}T235959Z`
                  : ""
              }`,
      });
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
  category: EventCategory | string,
): EventCategoryConfig | undefined {
  return EVENT_CATEGORIES.find((c) => c.value === category);
}
