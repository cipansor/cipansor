import { Router } from 'express';
import muhasabahController from './muhasabah.controller';
import { authenticate, authorize } from '@/middleware/auth';
import { validate, validateQuery } from '@/middleware/validate';
import { UserRole } from '@prisma/client';
import {
  createMuhasabahSchema,
  createMineMuhasabahSchema,
  dailyReportQuerySchema,
  updateMuhasabahSchema,
} from './muhasabah.schema';

const router = Router();

// All routes require authentication
router.use(authenticate);

// =====================================
// STUDENT SELF-SERVICE ROUTES
// =====================================

/**
 * @route GET /api/muhasabah/me
 * @desc Get my muhasabah records
 * @access Private - Student
 */
router.get('/me', authorize(UserRole.STUDENT), muhasabahController.getMyRecords);

/**
 * @route GET /api/muhasabah/me/today
 * @desc Get my muhasabah for today
 * @access Private - Student
 */
router.get('/me/today', authorize(UserRole.STUDENT), muhasabahController.getMyToday);

/**
 * @route GET /api/muhasabah/me/stats
 * @desc Get my muhasabah statistics
 * @access Private - Student
 */
router.get('/me/stats', authorize(UserRole.STUDENT), muhasabahController.getMyStats);

/**
 * @route POST /api/muhasabah/me
 * @desc Create my muhasabah record
 * @access Private - Student
 */
router.post(
  '/me',
  authorize(UserRole.STUDENT),
  validate(createMineMuhasabahSchema),
  muhasabahController.createMine
);

// =====================================
// ADMIN/TEACHER ROUTES
// =====================================

/**
 * @route GET /api/muhasabah/daily-report
 * @desc Get daily muhasabah report
 * @access Private - Admin, Teacher
 */
router.get(
  '/daily-report',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validateQuery(dailyReportQuerySchema),
  muhasabahController.getDailyReport
);

/**
 * @route GET /api/muhasabah/group/stats
 * @desc Get group muhasabah statistics
 * @access Private - Admin, Teacher
 */
router.get(
  '/group/stats',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  muhasabahController.getGroupStats
);

/**
 * @route GET /api/muhasabah/student/:studentId/stats
 * @desc Get specific student's statistics
 * @access Private - Admin, Teacher
 */
router.get(
  '/student/:studentId/stats',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  muhasabahController.getStudentStats
);

/**
 * @route GET /api/muhasabah/student/:studentId/history
 * @desc Get specific student's history
 * @access Private - Admin, Teacher
 */
router.get(
  '/student/:studentId/history',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  muhasabahController.getStudentHistory
);

/**
 * @route GET /api/muhasabah
 * @desc Get all muhasabah records
 * @access Private - Admin, Teacher
 */
router.get(
  '/',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  muhasabahController.list
);

/**
 * @route GET /api/muhasabah/:id
 * @desc Get muhasabah by ID
 * @access Private - Admin, Teacher, Student
 */
router.get(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.STUDENT),
  muhasabahController.getById
);

/**
 * @route POST /api/muhasabah
 * @desc Create muhasabah (admin creates for student)
 * @access Private - Admin, Teacher
 */
router.post(
  '/',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validate(createMuhasabahSchema),
  muhasabahController.create
);

/**
 * @route PUT /api/muhasabah/:id
 * @desc Update muhasabah
 * @access Private - Admin, Teacher
 */
router.put(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validate(updateMuhasabahSchema),
  muhasabahController.update
);

/**
 * @route DELETE /api/muhasabah/:id
 * @desc Delete muhasabah
 * @access Private - Admin only
 */
router.delete(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  muhasabahController.delete
);

export default router;
