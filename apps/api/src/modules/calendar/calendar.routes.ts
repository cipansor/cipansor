import { Router } from 'express';
import { UserRole } from '@prisma/client';
import {
  bulkCreateCalendarEventsSchema,
  calendarEventDeleteQuerySchema,
  createCalendarEventSchema,
  listCalendarEventsQuerySchema,
} from '@cipansor/shared';
import { calendarController } from './calendar.controller';
import { authenticate, authorize } from '@/middleware/auth';
import { validate, validateQuery } from '@/middleware/validate';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ======================
// EVENT CRUD ROUTES
// ======================

// GET /calendar - List all events
router.get(
  '/',
  validateQuery(listCalendarEventsQuerySchema),
  authorize(
    UserRole.SUPER_ADMIN,
    UserRole.UNIT_ADMIN,
    UserRole.TEACHER,
    UserRole.STUDENT,
    UserRole.PARENT
  ),
  calendarController.listEvents.bind(calendarController)
);

// GET /calendar/statistics - Get calendar statistics
router.get(
  '/statistics',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  calendarController.getStatistics.bind(calendarController)
);

// GET /calendar/upcoming/:unitId - Get upcoming events for a unit
router.get(
  '/upcoming/:unitId',
  authorize(
    UserRole.SUPER_ADMIN,
    UserRole.UNIT_ADMIN,
    UserRole.TEACHER,
    UserRole.STUDENT,
    UserRole.PARENT
  ),
  calendarController.getUpcomingEvents.bind(calendarController)
);

// GET /calendar/today/:unitId - Get today's events for a unit
router.get(
  '/today/:unitId',
  authorize(
    UserRole.SUPER_ADMIN,
    UserRole.UNIT_ADMIN,
    UserRole.TEACHER,
    UserRole.STUDENT,
    UserRole.PARENT
  ),
  calendarController.getTodayEvents.bind(calendarController)
);

// GET /calendar/holidays/:unitId/:academicYearId - Get holidays for academic year
router.get(
  '/holidays/:unitId/:academicYearId',
  authorize(
    UserRole.SUPER_ADMIN,
    UserRole.UNIT_ADMIN,
    UserRole.TEACHER,
    UserRole.STUDENT,
    UserRole.PARENT
  ),
  calendarController.getHolidays.bind(calendarController)
);

// POST /calendar - Create single event (and, when it repeats, its whole series)
router.post(
  '/',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validate(createCalendarEventSchema),
  calendarController.createEvent.bind(calendarController)
);

// POST /calendar/bulk - Bulk create events
router.post(
  '/bulk',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validate(bulkCreateCalendarEventsSchema),
  calendarController.bulkCreateEvents.bind(calendarController)
);

// POST /calendar/import - Import academic calendar
router.post(
  '/import',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  calendarController.importAcademicCalendar.bind(calendarController)
);

// GET /calendar/holidays/config - Holiday-source settings
router.get(
  '/holidays/config',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  calendarController.getHolidaySyncConfig.bind(calendarController)
);

// PUT /calendar/holidays/config - Change the holiday source / years. The source
// is yayasan-wide: every unit's scheduled sync reads it, so only the super admin
// may change it. A unit admin editing it would silently retarget every unit.
router.put(
  '/holidays/config',
  authorize(UserRole.SUPER_ADMIN),
  calendarController.updateHolidaySyncConfig.bind(calendarController)
);

// POST /calendar/holidays/sync - Fetch a year's national holidays into the calendar
router.post(
  '/holidays/sync',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  calendarController.syncHolidays.bind(calendarController)
);

// GET /calendar/holidays/drafts - Imported holidays awaiting review
router.get(
  '/holidays/drafts',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  calendarController.listHolidayDrafts.bind(calendarController)
);

// POST /calendar/holidays/drafts/:id/approve - Adopt a draft into the live calendar
router.post(
  '/holidays/drafts/:id/approve',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  calendarController.approveHolidayDraft.bind(calendarController)
);

// POST /calendar/holidays/drafts/:id/reject - Drop a draft so it never affects work days
router.post(
  '/holidays/drafts/:id/reject',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  calendarController.rejectHolidayDraft.bind(calendarController)
);

// GET /calendar/:id - Get event by ID
router.get(
  '/:id',
  authorize(
    UserRole.SUPER_ADMIN,
    UserRole.UNIT_ADMIN,
    UserRole.TEACHER,
    UserRole.STUDENT,
    UserRole.PARENT
  ),
  calendarController.getEventById.bind(calendarController)
);

// PUT /calendar/:id - Update event
router.put(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  calendarController.updateEvent.bind(calendarController)
);

// DELETE /calendar/:id?scope=SINGLE|SERIES - Delete one occurrence or a whole series
router.delete(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validateQuery(calendarEventDeleteQuerySchema),
  calendarController.deleteEvent.bind(calendarController)
);

export default router;
