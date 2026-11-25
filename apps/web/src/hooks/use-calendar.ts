import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api, { ApiResponse } from "@/lib/api";
import {
  EventType,
  EVENT_TYPES,
  type CalendarEvent as SharedCalendarEvent,
  type CalendarEventDeleteScope,
  type CalendarEventList,
  type CreateCalendarEventPayload,
  type EventRecurrenceCode,
} from "@cipansor/shared";

/**
 * The academic calendar's data layer.
 *
 * The types are the shared contract (`@cipansor/shared`), not a local copy:
 * the page used to declare its own `CalendarEvent` with `category`,
 * `recurrence`, `recurrenceEnd` and a required `endDate`, none of which the API
 * returns. A badge therefore looked up a field that never arrived and rendered
 * blank on every row, for every role (#1155).
 */
export type EventCategory = EventType;
export type EventRecurrence = EventRecurrenceCode;
export type CalendarEvent = SharedCalendarEvent;

export interface EventCategoryConfig {
  value: EventCategory;
  label: string;
  color: string;
  bgColor: string;
  icon: string;
}

/**
 * The label, colour and icon of each category, in the order the form offers
 * them. `EVENT_TYPES` comes from shared, so this list cannot drift from the
 * Prisma enum: a value the API stores always has an entry here, and a value
 * offered here is always one the API accepts.
 */
const CATEGORY_STYLES: Record<
  EventCategory,
  Omit<EventCategoryConfig, "value">
> = {
  ACADEMIC: {
    label: "Akademik",
    color: "#2563eb",
    bgColor: "bg-blue-100 text-blue-800",
    icon: "GraduationCap",
  },
  RELIGIOUS: {
    label: "Keagamaan",
    color: "#059669",
    bgColor: "bg-emerald-100 text-emerald-800",
    icon: "BookOpen",
  },
  EXTRACURRICULAR: {
    label: "Ekstrakurikuler",
    color: "#7c3aed",
    bgColor: "bg-purple-100 text-purple-800",
    icon: "Trophy",
  },
  MEETING: {
    label: "Rapat",
    color: "#ea580c",
    bgColor: "bg-orange-100 text-orange-800",
    icon: "Users",
  },
  CEREMONY: {
    label: "Upacara",
    color: "#b45309",
    bgColor: "bg-amber-100 text-amber-800",
    icon: "Flag",
  },
  HOLIDAY: {
    label: "Hari Libur",
    color: "#dc2626",
    bgColor: "bg-red-100 text-red-800",
    icon: "Calendar",
  },
  EXAM: {
    label: "Ujian/Asesmen",
    color: "#0891b2",
    bgColor: "bg-cyan-100 text-cyan-800",
    icon: "FileText",
  },
  OTHER: {
    label: "Lainnya",
    color: "#6b7280",
    bgColor: "bg-gray-100 text-gray-800",
    icon: "MoreHorizontal",
  },
};

// `EVENT_TYPES` is a const tuple of string literals (so Zod can build an enum
// from it); its members are the enum's values, hence the cast.
export const EVENT_CATEGORIES: EventCategoryConfig[] = (
  EVENT_TYPES as readonly EventCategory[]
).map((value) => ({ value, ...CATEGORY_STYLES[value] }));

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
  eventType?: EventCategory;
  unitId?: string;
  classId?: string;
  isPublic?: boolean;
  month?: number;
  year?: number;
  search?: string;
  /** The management list: a unit admin also sees its unit's class events. */
  manage?: boolean;
}

export function useCalendarEvents(params: CalendarEventParams = {}) {
  return useQuery({
    queryKey: ["calendar-events", params],
    queryFn: async () => {
      const response = await api.get<CalendarEventList>("/calendar", {
        params,
        // The list renders the failure itself; the interceptor's toast would
        // report the same error a second time.
        skipErrorToast: true,
      });
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

      // Read every page: a daily agenda fills the first 100 rows on its own,
      // and stopping there hid the rest of the month from the grid.
      const events: CalendarEvent[] = [];
      for (let page = 1; ; page += 1) {
        const response = await api.get<CalendarEventList>("/calendar", {
          params: { startDate, endDate, unitId, page, limit: 100 },
        });
        events.push(...response.data.data);
        if (page >= (response.data.meta?.totalPages ?? 1)) break;
      }

      return events;
    },
  });
}

/** What the form sends: the shared contract, with days as the form holds them. */
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

export type CreateCalendarEventData = CreateCalendarEventPayload;

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
    mutationFn: async ({
      id,
      scope = "SINGLE",
    }: {
      id: string;
      scope?: CalendarEventDeleteScope;
    }) => {
      await api.delete(`/calendar/${id}`, { params: { scope } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
    },
  });
}

// Helper function to get event color
export function getEventCategoryColor(category: EventCategory): string {
  return CATEGORY_STYLES[category]?.color ?? "#6b7280";
}

export function getEventCategoryConfig(
  category: EventCategory | string | null | undefined,
): EventCategoryConfig | undefined {
  if (!category) return undefined;
  const style = CATEGORY_STYLES[category as EventCategory];
  return style ? { value: category as EventCategory, ...style } : undefined;
}
