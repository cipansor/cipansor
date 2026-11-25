import { z } from "zod";
import { EventType } from "../types/calendar";

const booleanQuery = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

/**
 * GET /calendar — the one contract for the list query, shared by the API's
 * validator and the web hook. `manage` is a screen flag, not a permission:
 * the service still decides whose class events a caller may see.
 */
export const calendarEventsQuerySchema = z.object({
  unitId: z.string().optional(),
  classId: z.string().optional(),
  eventType: z.nativeEnum(EventType).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  search: z.string().optional(),
  isPublic: booleanQuery.optional(),
  manage: booleanQuery.default(false),
  page: z.coerce.number().int().min(1).default(1),
  // Keep headroom above the portal's 100-row month request: the route used to
  // accept any page size, and an external reader asking for 101 must not start
  // failing with 400. 500 still bounds a single query.
  limit: z.coerce.number().int().min(1).max(500).default(50),
});

export type CalendarEventsQuery = z.infer<typeof calendarEventsQuerySchema>;

/** What the web hook may send; defaults and query-string coercions stay in the schema. */
export type CalendarEventListParams = z.input<typeof calendarEventsQuerySchema>;
