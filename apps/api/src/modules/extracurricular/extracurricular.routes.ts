import { Router } from 'express';
import { extracurricularController } from './extracurricular.controller';
import { authenticate, authorize } from '@/middleware/auth';
import { UserRole } from '@prisma/client';
import { STUDENT_ROLE_CODES } from '@cipansor/shared';

const router = Router();

// What the public site lists on *Kegiatan* — names, categories and units only
// (decisions/fasilitas-dan-kegiatan-situs-publik.md). Mounted before
// `authenticate`, and before `/:id`.
router.get('/public', extracurricularController.publicList.bind(extracurricularController));

// Every other route requires authentication
router.use(authenticate);

// ======================
// EXTRACURRICULAR ROUTES
// ======================

// List extracurriculars
router.get(
  '/',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.STAFF),
  extracurricularController.list.bind(extracurricularController)
);

// Get extracurricular by ID
router.get(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.STAFF),
  extracurricularController.getById.bind(extracurricularController)
);

// Create extracurricular
router.post(
  '/',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  extracurricularController.create.bind(extracurricularController)
);

// Update extracurricular
router.put(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  extracurricularController.update.bind(extracurricularController)
);

// Delete extracurricular
router.delete(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  extracurricularController.delete.bind(extracurricularController)
);

// ======================
// ENROLLMENT ROUTES
// ======================

// List enrollments
router.get(
  '/enrollments/list',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  extracurricularController.listEnrollments.bind(extracurricularController)
);

// Enroll student
router.post(
  '/enrollments',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  extracurricularController.enrollStudent.bind(extracurricularController)
);

// Bulk enroll students
router.post(
  '/enrollments/bulk',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  extracurricularController.bulkEnroll.bind(extracurricularController)
);

// Update enrollment
router.put(
  '/enrollments/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  extracurricularController.updateEnrollment.bind(extracurricularController)
);

// ======================
// ATTENDANCE ROUTES
// ======================

// List attendance
router.get(
  '/attendance/list',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  extracurricularController.listAttendance.bind(extracurricularController)
);

// Record attendance
router.post(
  '/attendance',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  extracurricularController.recordAttendance.bind(extracurricularController)
);

// Get attendance summary
router.get(
  '/:id/attendance/summary',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  extracurricularController.getAttendanceSummary.bind(extracurricularController)
);

// ======================
// ACHIEVEMENT ROUTES
// ======================

// List achievements
router.get(
  '/achievements/list',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.STAFF),
  extracurricularController.listAchievements.bind(extracurricularController)
);

// Create achievement
router.post(
  '/achievements',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  extracurricularController.createAchievement.bind(extracurricularController)
);

// Delete achievement
router.delete(
  '/achievements/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  extracurricularController.deleteAchievement.bind(extracurricularController)
);

// ======================
// STUDENT & STATISTICS
// ======================

// Get student's extracurriculars. A santri reaches their own enrolment (R27.4);
// the service answers 404 for a santri outside the caller's scope (R27.5).
router.get(
  '/students/:studentId',
  authorize(
    UserRole.SUPER_ADMIN,
    UserRole.UNIT_ADMIN,
    UserRole.TEACHER,
    UserRole.PARENT,
    ...STUDENT_ROLE_CODES
  ),
  extracurricularController.getStudentExtracurriculars.bind(extracurricularController)
);

// Get statistics for unit
router.get(
  '/statistics/:unitId',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  extracurricularController.getStatistics.bind(extracurricularController)
);

export default router;
