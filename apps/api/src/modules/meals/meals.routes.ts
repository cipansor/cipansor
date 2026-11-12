import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { MEALS_ATTENDANCE_WRITER_ROLE_CODES, MEALS_MANAGER_ROLE_CODES } from '@cipansor/shared';
import { mealsController } from './meals.controller';
import { authenticate, authorize } from '@/middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Who may change menus and record attendance. The routes used to admit the
// legacy `UserRole.UNIT_ADMIN` bucket, which expands to the yayasan organs as
// well — the Pengawas, whose permission list is read-only, could create a menu
// for any unit and edit or delete another unit's (CWE-863). These lists name
// the writers directly; a role is added here, never inherited from a bucket.
const menuWriters = authorize(...MEALS_MANAGER_ROLE_CODES);
const attendanceWriters = authorize(...MEALS_ATTENDANCE_WRITER_ROLE_CODES);

// ======================
// MEAL SCHEDULE ROUTES
// ======================

// GET /meals/schedules - List all meal schedules
router.get(
  '/schedules',
  authorize(
    UserRole.SUPER_ADMIN,
    UserRole.UNIT_ADMIN,
    UserRole.TEACHER,
    UserRole.STUDENT,
    UserRole.PARENT
  ),
  mealsController.listSchedules.bind(mealsController)
);

// GET /meals/schedules/:id - Get meal schedule by ID
router.get(
  '/schedules/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  mealsController.getScheduleById.bind(mealsController)
);

// POST /meals/schedules - Create meal schedule
router.post('/schedules', menuWriters, mealsController.createSchedule.bind(mealsController));

// PUT /meals/schedules/:id - Update meal schedule
router.put('/schedules/:id', menuWriters, mealsController.updateSchedule.bind(mealsController));

// DELETE /meals/schedules/:id - Delete meal schedule
router.delete('/schedules/:id', menuWriters, mealsController.deleteSchedule.bind(mealsController));

// ======================
// MENU ROUTES
// ======================

// GET /meals/menus - List all menus
router.get(
  '/menus',
  authorize(
    UserRole.SUPER_ADMIN,
    UserRole.UNIT_ADMIN,
    UserRole.TEACHER,
    UserRole.STUDENT,
    UserRole.PARENT
  ),
  mealsController.listMenus.bind(mealsController)
);

// GET /meals/menus/today/:unitId - Get today's menu for a unit
router.get(
  '/menus/today/:unitId',
  authorize(
    UserRole.SUPER_ADMIN,
    UserRole.UNIT_ADMIN,
    UserRole.TEACHER,
    UserRole.STUDENT,
    UserRole.PARENT
  ),
  mealsController.getTodayMenu.bind(mealsController)
);

// GET /meals/menus/:id - Get menu by ID
router.get(
  '/menus/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  mealsController.getMenuById.bind(mealsController)
);

// POST /meals/menus - Create menu
router.post('/menus', menuWriters, mealsController.createMenu.bind(mealsController));

// POST /meals/menus/bulk - Bulk create menus
router.post('/menus/bulk', menuWriters, mealsController.bulkCreateMenus.bind(mealsController));

// PUT /meals/menus/:id - Update menu
router.put('/menus/:id', menuWriters, mealsController.updateMenu.bind(mealsController));

// DELETE /meals/menus/:id - Delete menu
router.delete('/menus/:id', menuWriters, mealsController.deleteMenu.bind(mealsController));

// ======================
// ATTENDANCE ROUTES
// ======================

// GET /meals/attendance - List all attendance records
router.get(
  '/attendance',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  mealsController.listAttendances.bind(mealsController)
);

// POST /meals/attendance - Record single attendance
router.post(
  '/attendance',
  attendanceWriters,
  mealsController.recordAttendance.bind(mealsController)
);

// POST /meals/attendance/bulk - Bulk record attendance
router.post(
  '/attendance/bulk',
  attendanceWriters,
  mealsController.bulkRecordAttendance.bind(mealsController)
);

// PUT /meals/attendance/:id - Update attendance record
router.put(
  '/attendance/:id',
  attendanceWriters,
  mealsController.updateAttendance.bind(mealsController)
);

// ======================
// STUDENT & STATISTICS ROUTES
// ======================

// GET /meals/student/:studentId - Get student meal history
router.get(
  '/student/:studentId',
  authorize(
    UserRole.SUPER_ADMIN,
    UserRole.UNIT_ADMIN,
    UserRole.TEACHER,
    UserRole.STUDENT,
    UserRole.PARENT
  ),
  mealsController.getStudentHistory.bind(mealsController)
);

// GET /meals/statistics - Get meal statistics
router.get(
  '/statistics',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  mealsController.getStatistics.bind(mealsController)
);

export default router;
