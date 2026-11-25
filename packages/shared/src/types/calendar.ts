export enum EventType {
  ACADEMIC = "ACADEMIC",
  RELIGIOUS = "RELIGIOUS",
  EXTRACURRICULAR = "EXTRACURRICULAR",
  MEETING = "MEETING",
  CEREMONY = "CEREMONY",
  HOLIDAY = "HOLIDAY",
  EXAM = "EXAM",
  OTHER = "OTHER",
}

/**
 * The event categories in the order the portal offers them.
 *
 * One list, read by the form, the filter and the badge. The web used to keep
 * its own seven-value list that both offered an `EXAM` the API could not store
 * and lacked the `CEREMONY` the API does store, so a "Ujian" agenda failed to
 * save and an "Upacara" one rendered with an empty badge (#1155). A guard
 * (`apps/api/src/utils/calendar-contract.guard.test.ts`) pins it to the Prisma
 * `EventType` enum in both directions.
 */
export const EVENT_TYPES = [
  "ACADEMIC",
  "RELIGIOUS",
  "EXTRACURRICULAR",
  "MEETING",
  "CEREMONY",
  "HOLIDAY",
  "EXAM",
  "OTHER",
] as const;
export type EventTypeCode = (typeof EVENT_TYPES)[number];

export enum EventScope {
  ALL_UNITS = "ALL_UNITS",
  SPECIFIC_UNIT = "SPECIFIC_UNIT",
  SPECIFIC_CLASS = "SPECIFIC_CLASS",
}

export interface CalendarEvent {
  id: string;
  unitId?: string | null;
  classId?: string | null;
  title: string;
  description?: string | null;
  eventType: EventType;
  scope: EventScope;
  startDate: string; // ISO Date string
  endDate?: string | null; // ISO Date string
  isAllDay: boolean;
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  isOnline: boolean;
  onlineUrl?: string | null;
  isRecurring: boolean;
  recurrenceRule?: string | null;
  /** Set on a materialised occurrence: the id of the series' first row. */
  recurrenceParentId?: string | null;
  isPublic: boolean;
  /** A holiday import awaiting review; never part of the live calendar. */
  isDraft: boolean;
  color?: string | null;
  createdById: string;
  createdAt: string;
  updatedAt: string;
  unit?: { id: string; name: string } | null;
  class?: { id: string; name: string } | null;
  createdBy?: { id: string; name: string } | null;
}

export type CreateCalendarEventInput = Omit<
  CalendarEvent,
  "id" | "createdAt" | "updatedAt" | "createdById" | "isDraft"
> & {
  unitId?: string | null;
  classId?: string | null;
};

export type UpdateCalendarEventInput = Partial<CreateCalendarEventInput>;

/** Which occurrences a delete applies to, when the event belongs to a series. */
export type CalendarEventDeleteScope = "SINGLE" | "SERIES";

/** The page envelope `GET /calendar` answers with. */
export interface CalendarEventListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CalendarEventList {
  data: CalendarEvent[];
  meta: CalendarEventListMeta;
}
