import { Router } from 'express';
import {
  halaqohController,
  enrollmentController,
  sanadController,
  progressController,
  targetController,
  dashboardController,
  murojaahController,
} from './takhosus.controller';
import { authenticate, authorize } from '@/middleware/auth';
import { UserRole } from '@prisma/client';
import { validate } from '@/middleware/validate';
import {
  createHalaqohSchema,
  updateHalaqohSchema,
  createEnrollmentSchema,
  updateEnrollmentSchema,
  createSanadSchema,
  updateSanadSchema,
  createTargetSchema,
  createMurojaahSchema,
  updateMurojaahSchema,
} from './takhosus.schema';

const router = Router();

// All routes require authentication
router.use(authenticate);

// =====================================
// STATS ROUTES
// =====================================

router.get(
  '/enrollment/stats',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  enrollmentController.getStats
);

router.get(
  '/dashboard-stats',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  dashboardController.getStats
);

// =====================================
// HALAQOH ROUTES
// =====================================

router.get('/halaqoh', halaqohController.list);
router.get('/halaqoh/:id', halaqohController.getById);
router.get(
  '/halaqoh/:id/progress',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  halaqohController.getProgress
);

router.post(
  '/halaqoh',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validate(createHalaqohSchema),
  halaqohController.create
);

router.put(
  '/halaqoh/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validate(updateHalaqohSchema),
  halaqohController.update
);

router.delete(
  '/halaqoh/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  halaqohController.delete
);

// =====================================
// ENROLLMENT ROUTES
// =====================================

router.get(
  '/enrollment',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  enrollmentController.list
);

router.get(
  '/enrollment/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  enrollmentController.getById
);

router.post(
  '/enrollment',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validate(createEnrollmentSchema),
  enrollmentController.create
);

router.put(
  '/enrollment/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validate(updateEnrollmentSchema),
  enrollmentController.update
);

router.delete(
  '/enrollment/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  enrollmentController.delete
);

// =====================================
// SANAD ROUTES
// =====================================

router.get(
  '/sanad',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  sanadController.list
);

router.post(
  '/sanad',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validate(createSanadSchema),
  sanadController.create
);

router.put(
  '/sanad/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validate(updateSanadSchema),
  sanadController.update
);

router.delete(
  '/sanad/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  sanadController.delete
);

// =====================================
// TARGET ROUTES
// =====================================

/**
 * @route POST /api/takhosus/targets
 * @desc Create or update student target
 * @access Private - Admin, Teacher
 */
router.post(
  '/targets',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validate(createTargetSchema),
  targetController.createOrUpdate
);

/**
 * @route GET /api/takhosus/targets/student/:studentId
 * @desc Get target by student ID
 * @access Private - Admin, Teacher
 */
router.get(
  '/targets/student/:studentId',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  targetController.getByStudent
);

/**
 * @route GET /api/takhosus/targets/progress/:studentId
 * @desc Get progress towards target
 * @access Private - Admin, Teacher
 */
router.get(
  '/targets/progress/:studentId',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  targetController.getProgress
);

// =====================================
// PROGRESS ROUTES
// =====================================

router.get(
  '/student/:studentId/progress',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  progressController.getStudentProgress
);

// =====================================
// MUROJAAH ROUTES
// =====================================

router.get(
  '/murojaah',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  murojaahController.list
);

router.post(
  '/murojaah',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validate(createMurojaahSchema),
  murojaahController.create
);

router.put(
  '/murojaah/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validate(updateMurojaahSchema),
  murojaahController.update
);

router.delete(
  '/murojaah/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  murojaahController.delete
);

export default router;
