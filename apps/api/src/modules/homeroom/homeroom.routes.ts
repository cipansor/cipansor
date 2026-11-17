import { Router } from 'express';
import { UserRole } from '@prisma/client';
import {
  HOMEROOM_ROUTE_ROLE_CODES,
  homeroomNoteSchema,
  updateHomeroomNoteSchema,
} from '@cipansor/shared';
import { validate } from '@/middleware/error';
import { homeroomController } from './homeroom.controller';
import { authenticate, authorize } from '@/middleware/auth';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Teachers, and the unit's kepala sekolah and admin unit. Which classes each
// reaches is the class's wali kelas relation, in the service
// (homeroom.access.ts): the wali kelas reads and writes, the overseers read.
const homeroomRoles = authorize(...HOMEROOM_ROUTE_ROLE_CODES);

// ======================
// MY CLASSES ROUTES
// ======================

// GET /homeroom/my-classes - Classes the caller is wali kelas of, the current year's first
router.get('/my-classes', homeroomRoles, homeroomController.getMyClasses.bind(homeroomController));

// GET /homeroom/performance-overview - Cross-class wali kelas performance
// (teacher evaluation data — admins only)
router.get(
  '/performance-overview',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  homeroomController.getPerformanceOverview.bind(homeroomController)
);

// ======================
// CLASS ROUTES
// ======================

// GET /homeroom/:classId/dashboard - Get class dashboard (Simplified route for frontend)
router.get(
  '/:classId/dashboard',
  homeroomRoles,
  homeroomController.getClassDashboard.bind(homeroomController)
);

// GET /homeroom/class/:classId/dashboard - Get class dashboard (Legacy/Alternative)
router.get(
  '/class/:classId/dashboard',
  homeroomRoles,
  homeroomController.getClassDashboard.bind(homeroomController)
);

// GET /homeroom/class/:classId/students - Get students in class
router.get(
  '/class/:classId/students',
  homeroomRoles,
  homeroomController.getHomeroomStudents.bind(homeroomController)
);

// GET /homeroom/class/:classId/attendance - Get attendance summary
router.get(
  '/class/:classId/attendance',
  homeroomRoles,
  homeroomController.getAttendanceSummary.bind(homeroomController)
);

// GET /homeroom/class/:classId/academic - Get academic monitoring
router.get(
  '/class/:classId/academic',
  homeroomRoles,
  homeroomController.getAcademicMonitoring.bind(homeroomController)
);

// ======================
// STUDENT ROUTES
// ======================

// GET /homeroom/student/:studentId - Get student detail
router.get(
  '/student/:studentId',
  homeroomRoles,
  homeroomController.getStudentDetail.bind(homeroomController)
);

// GET /homeroom/student/:studentId/notes - Get student notes
router.get(
  '/student/:studentId/notes',
  homeroomRoles,
  homeroomController.getStudentNotes.bind(homeroomController)
);

// ======================
// NOTES ROUTES
// ======================

// POST /homeroom/notes - Create student note
router.post(
  '/notes',
  homeroomRoles,
  validate(homeroomNoteSchema),
  homeroomController.createStudentNote.bind(homeroomController)
);

// PUT /homeroom/notes/:noteId - Update student note
router.put(
  '/notes/:noteId',
  homeroomRoles,
  validate(updateHomeroomNoteSchema),
  homeroomController.updateStudentNote.bind(homeroomController)
);

// DELETE /homeroom/notes/:noteId - Delete student note
router.delete(
  '/notes/:noteId',
  homeroomRoles,
  homeroomController.deleteStudentNote.bind(homeroomController)
);

// ======================
// BEHAVIOR ROUTES
// ======================

// GET /homeroom/behavior - Get behavior records
router.get(
  '/behavior',
  homeroomRoles,
  homeroomController.getBehaviorRecords.bind(homeroomController)
);

// POST /homeroom/behavior - Record behavior
router.post(
  '/behavior',
  homeroomRoles,
  validate(homeroomNoteSchema),
  homeroomController.recordBehavior.bind(homeroomController)
);

export default router;
