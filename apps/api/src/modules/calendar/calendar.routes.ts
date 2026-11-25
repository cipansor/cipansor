import { Router } from 'express';
import { RoleCode } from '@prisma/client';
import {
  ADMIN_ROLE_CODES,
  CALENDAR_READ_ROLE_CODES,
  CALENDAR_STATS_ROLE_CODES,
  CALENDAR_WRITE_ROLE_CODES,
  bulkCreateCalendarEventsSchema,
  calendarEventDeleteQuerySchema,
  createCalendarEventSchema,
  listCalendarEventsQuerySchema,
  updateCalendarEventSchema,
} from '@cipansor/shared';
import { calendarController } from './calendar.controller';
import { authenticate, authorize } from '@/middleware/auth';
import { validate, validateQuery } from '@/middleware/validate';

const router = Router();

// Writing the calendar is academic work. The legacy `authorize(SUPER_ADMIN,
// UNIT_ADMIN)` buckets every yayasan code into UNIT_ADMIN, so the auditor role
// (Pengawas) could publish unit holidays even though its permission set is
// read-only. Gate the writes on the permission the operational academic roles
// actually hold.
const manageCalendar = authorize(...CALENDAR_WRITE_ROLE_CODES);

// Reviewing an imported holiday is admin work, not teaching work. A kepala
// sekolah may create ordinary agenda, but approving a draft changes a unit's
// work days for attendance and payroll. `ADMIN_ROLE_CODES` is exactly
// SUPER_ADMIN and the four per-unit admins: the legacy UNIT_ADMIN bucket also
// contains the read-only yayasan roles, and TEACHER contains the kepala sekolah.
const reviewHolidayDraft = authorize(...ADMIN_ROLE_CODES);

// All routes require authentication
router.use(authenticate);

// ======================
// EVENT CRUD ROUTES
// ======================

// GET /calendar - List all events
router.get(
  '/',
  validateQuery(listCalendarEventsQuerySchema),
  authorize(...CALENDAR_READ_ROLE_CODES),
  calendarController.listEvents.bind(calendarController)
);

// GET /calendar/statistics - Get calendar statistics
router.get(
  '/statistics',
  authorize(...CALENDAR_STATS_ROLE_CODES),
  calendarController.getStatistics.bind(calendarController)
);

// GET /calendar/upcoming/:unitId - Get upcoming events for a unit
router.get(
  '/upcoming/:unitId',
  authorize(...CALENDAR_READ_ROLE_CODES),
  calendarController.getUpcomingEvents.bind(calendarController)
);

// GET /calendar/today/:unitId - Get today's events for a unit
router.get(
  '/today/:unitId',
  authorize(...CALENDAR_READ_ROLE_CODES),
  calendarController.getTodayEvents.bind(calendarController)
);

// GET /calendar/holidays/:unitId/:academicYearId - Get holidays for academic year
router.get(
  '/holidays/:unitId/:academicYearId',
  authorize(...CALENDAR_READ_ROLE_CODES),
  calendarController.getHolidays.bind(calendarController)
);

// POST /calendar - Create single event (and, when it repeats, its whole series)
router.post(
  '/',
  manageCalendar,
  validate(createCalendarEventSchema),
  calendarController.createEvent.bind(calendarController)
);

// POST /calendar/bulk - Bulk create events
router.post(
  '/bulk',
  manageCalendar,
  validate(bulkCreateCalendarEventsSchema),
  calendarController.bulkCreateEvents.bind(calendarController)
);

// POST /calendar/import - Import academic calendar
router.post(
  '/import',
  manageCalendar,
  calendarController.importAcademicCalendar.bind(calendarController)
);

// GET /calendar/holidays/config - Holiday-source settings
router.get(
  '/holidays/config',
  authorize(...CALENDAR_STATS_ROLE_CODES),
  calendarController.getHolidaySyncConfig.bind(calendarController)
);

// PUT /calendar/holidays/config - Change the holiday source / years. The source
// is yayasan-wide: every unit's scheduled sync reads it, so only the super admin
// may change it. A unit admin editing it would silently retarget every unit.
router.put(
  '/holidays/config',
  authorize(RoleCode.SUPER_ADMIN),
  calendarController.updateHolidaySyncConfig.bind(calendarController)
);

// POST /calendar/holidays/sync - Fetch a year's national holidays into the calendar
router.post(
  '/holidays/sync',
  manageCalendar,
  calendarController.syncHolidays.bind(calendarController)
);

// GET /calendar/holidays/drafts - Imported holidays awaiting review
router.get(
  '/holidays/drafts',
  authorize(...CALENDAR_WRITE_ROLE_CODES),
  calendarController.listHolidayDrafts.bind(calendarController)
);

// POST /calendar/holidays/drafts/:id/approve - Adopt a draft into the live calendar
router.post(
  '/holidays/drafts/:id/approve',
  reviewHolidayDraft,
  calendarController.approveHolidayDraft.bind(calendarController)
);

// POST /calendar/holidays/drafts/:id/reject - Drop a draft so it never affects work days
router.post(
  '/holidays/drafts/:id/reject',
  reviewHolidayDraft,
  calendarController.rejectHolidayDraft.bind(calendarController)
);

// GET /calendar/:id - Get event by ID
router.get(
  '/:id',
  authorize(...CALENDAR_READ_ROLE_CODES),
  calendarController.getEventById.bind(calendarController)
);

// PUT /calendar/:id - Update event
router.put(
  '/:id',
  manageCalendar,
  validate(updateCalendarEventSchema),
  calendarController.updateEvent.bind(calendarController)
);

// DELETE /calendar/:id?scope=SINGLE|SERIES - Delete one occurrence or a whole series
router.delete(
  '/:id',
  manageCalendar,
  validateQuery(calendarEventDeleteQuerySchema),
  calendarController.deleteEvent.bind(calendarController)
);

export default router;
