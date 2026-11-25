import { z } from "zod";
import { EVENT_TYPES } from "../types/calendar";

const booleanQuery = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

/**
 * The calendar's write contract, read by both the API and the web (#1155).
 *
 * The form used to send `category`, `recurrence` and `recurrenceEnd` while the
 * model has `eventType`, `isRecurring` and `recurrenceRule` — and the route
 * validated nothing, so `eventType` reached Prisma as `undefined` and every
 * save failed with a 500. This schema is the columns the model actually has, so
 * a form that follows it cannot send a field Prisma will reject; the API maps
 * `recurrence`/`recurrenceEnd` onto `isRecurring`/`recurrenceRule` itself.
 *
 * `startDate`/`endDate`/`recurrenceEnd` are **calendar days** ("yyyy-MM-dd"),
 * the form's own shape. An ISO datetime is accepted too — the e2e helpers and
 * older clients send midnight UTC instants — and normalised to its day, so
 * every stored event sits on one canonical value (midnight UTC of a WIB day).
 */

export const EVENT_RECURRENCE_VALUES = [
  "NONE",
  "DAILY",
  "WEEKLY",
  "MONTHLY",
  "YEARLY",
] as const;
export type EventRecurrenceCode = (typeof EVENT_RECURRENCE_VALUES)[number];

/** A calendar day as the form holds it. */
export const calendarDay = z.iso.date("Tanggal tidak valid (yyyy-MM-dd)");

/**
 * A calendar day, or an ISO instant normalised to the WIB day it falls on.
 *
 * The column stores a calendar day, and every school day is a WIB day. Slicing
 * the text of an instant took its *UTC* day, so `2026-11-25T17:00:00Z` (the
 * first minute of 26 November in WIB) was filed under the 25th. Shifting the
 * instant by the fixed UTC+7 offset first derives the day a person in the
 * pesantren means.
 */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

function wibDayOfInstant(value: string): string {
  return new Date(new Date(value).getTime() + WIB_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

const dayOrInstant = z.union([
  calendarDay,
  z.iso.datetime({ offset: true }).transform(wibDayOfInstant),
]);

/** "HH:mm", the value an `<input type="time">` holds. */
const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Waktu harus berformat HH:mm");

const hexColor = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, "Warna harus berformat #RRGGBB");

const dayMs = 86_400_000;
const MAX_SERIES_DAYS = 366;

export const createCalendarEventSchema = z
  .object({
    title: z.string().trim().min(1, "Judul agenda harus diisi").max(200),
    description: z.string().max(2000).nullish(),
    eventType: z.enum(EVENT_TYPES, "Kategori agenda tidak dikenal"),
    startDate: dayOrInstant,
    endDate: dayOrInstant.nullish(),
    isAllDay: z.boolean().default(false),
    startTime: clockTime.nullish(),
    endTime: clockTime.nullish(),
    location: z.string().max(200).nullish(),
    isOnline: z.boolean().default(false),
    onlineUrl: z.string().max(500).nullish(),
    isPublic: z.boolean().default(true),
    color: hexColor.nullish(),
    unitId: z.uuid("Unit tidak valid").nullish(),
    classId: z.uuid("Kelas tidak valid").nullish(),
    recurrence: z.enum(EVENT_RECURRENCE_VALUES).default("NONE"),
    recurrenceEnd: dayOrInstant.nullish(),
  })
  .superRefine((value, ctx) => {
    const start = Date.parse(`${value.startDate}T00:00:00.000Z`);
    if (value.endDate) {
      const end = Date.parse(`${value.endDate}T00:00:00.000Z`);
      if (end < start) {
        ctx.addIssue({
          code: "custom",
          path: ["endDate"],
          message: "Tanggal selesai tidak boleh sebelum tanggal mulai",
        });
      }
    }
    if (!value.isAllDay) {
      if (!value.startTime) {
        ctx.addIssue({
          code: "custom",
          path: ["startTime"],
          message: "Waktu mulai harus diisi bila agenda tidak sepanjang hari",
        });
      }
      // Only a same-day event must end after it starts. An event that names a
      // later end date may cross midnight — 22:00–06:00 is an eight-hour
      // agenda, not a reversed one.
      const sameDay = !value.endDate || value.endDate === value.startDate;
      if (
        sameDay &&
        value.startTime &&
        value.endTime &&
        value.endTime < value.startTime
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["endTime"],
          message: "Waktu selesai tidak boleh sebelum waktu mulai",
        });
      }
    }
    if (value.recurrence === "NONE") return;

    // A series without an end would run forever, and every occurrence is a
    // row: the cap keeps one form submission from writing an unbounded number
    // of them. One year is what a school calendar ever needs.
    if (!value.recurrenceEnd) {
      ctx.addIssue({
        code: "custom",
        path: ["recurrenceEnd"],
        message: "Agenda berulang harus punya tanggal berakhir",
      });
      return;
    }
    const end = Date.parse(`${value.recurrenceEnd}T00:00:00.000Z`);
    if (end < start) {
      ctx.addIssue({
        code: "custom",
        path: ["recurrenceEnd"],
        message: "Tanggal berakhir tidak boleh sebelum tanggal mulai",
      });
    } else if (end - start > MAX_SERIES_DAYS * dayMs) {
      ctx.addIssue({
        code: "custom",
        path: ["recurrenceEnd"],
        message: "Agenda berulang paling lama satu tahun",
      });
    }
  });

/**
 * The partial update contract. `null` is a value, not "leave it alone": the
 * edit form sends it for a field the user cleared, and the API forwards it to
 * Prisma so an old end date, description or time cannot survive the edit.
 */
export const updateCalendarEventSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Judul agenda harus diisi")
      .max(200)
      .optional(),
    description: z.string().max(2000).nullable().optional(),
    eventType: z.enum(EVENT_TYPES, "Kategori agenda tidak dikenal").optional(),
    startDate: dayOrInstant.optional(),
    endDate: dayOrInstant.nullable().optional(),
    isAllDay: z.boolean().optional(),
    startTime: clockTime.nullable().optional(),
    endTime: clockTime.nullable().optional(),
    location: z.string().max(200).nullable().optional(),
    isOnline: z.boolean().optional(),
    onlineUrl: z.string().max(500).nullable().optional(),
    isPublic: z.boolean().optional(),
    color: hexColor.nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.startDate || !value.endDate) return;
    const start = Date.parse(`${value.startDate}T00:00:00.000Z`);
    const end = Date.parse(`${value.endDate}T00:00:00.000Z`);
    if (end < start) {
      ctx.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Tanggal selesai tidak boleh sebelum tanggal mulai",
      });
    }
  });

export type UpdateCalendarEventPayload = z.input<
  typeof updateCalendarEventSchema
>;

export type CreateCalendarEventPayload = z.input<
  typeof createCalendarEventSchema
>;
/** The parsed payload: every default filled in, every day normalised. */
export type ParsedCalendarEventPayload = z.output<
  typeof createCalendarEventSchema
>;

export const bulkCreateCalendarEventsSchema = z.object({
  events: z.array(createCalendarEventSchema).min(1).max(100),
});
export type BulkCreateCalendarEventsPayload = z.input<
  typeof bulkCreateCalendarEventsSchema
>;

/** Which occurrences a delete applies to when the event belongs to a series. */
export const calendarEventDeleteQuerySchema = z.object({
  scope: z.enum(["SINGLE", "SERIES"]).default("SINGLE"),
});
export type CalendarEventDeleteQuery = z.output<
  typeof calendarEventDeleteQuerySchema
>;

/**
 * The most characters the list's `search` accepts. Shared with the search box
 * so the form cannot send a value the API refuses — a 220-character paste used
 * to turn the whole list into "no events" because the query was rejected.
 */
export const CALENDAR_EVENT_SEARCH_MAX_LENGTH = 200;

/**
 * The list's filters. `eventType` is the model's own name: the page used to
 * send `category`, which the controller never read, so the filter silently did
 * nothing (#1155).
 */
export const listCalendarEventsQuerySchema = z.object({
  unitId: z.uuid().optional(),
  classId: z.uuid().optional(),
  eventType: z.enum(EVENT_TYPES).optional(),
  startDate: calendarDay.optional(),
  endDate: calendarDay.optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  search: z.string().max(CALENDAR_EVENT_SEARCH_MAX_LENGTH).optional(),
  isPublic: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
  manage: booleanQuery.default(false),
  page: z.coerce.number().int().min(1).default(1),
  // Keep headroom above the portal's 100-row month request: the route used to
  // accept any page size, and an external reader asking for 101 must not start
  // failing with 400. 500 still bounds a single query.
  limit: z.coerce.number().int().min(1).max(500).default(50),
});
export type ListCalendarEventsQuery = z.output<
  typeof listCalendarEventsQuerySchema
>;

/** The list query's input shape, for the web hook's parameter type. */
export type CalendarEventListParams = z.input<
  typeof listCalendarEventsQuerySchema
>;
