import { Router } from 'express';
import { extracurricularController } from './extracurricular.controller';
import { authenticate, authorize } from '@/middleware/auth';
import {
  ADMIN_ROLE_CODES,
  BENDAHARA_ROLE_CODES,
  BUSINESS_ROLE_CODES,
  GOVERNANCE_ROLE_CODES,
  PARENT_ROLE_CODES,
  PESANTREN_EDUCATOR_ROLE_CODES,
  PESANTREN_LEADER_ROLE_CODES,
  PRINCIPAL_ROLE_CODES,
  SCHOOL_TEACHER_ROLE_CODES,
  STUDENT_ROLE_CODES,
  SUPPORT_ROLE_CODES,
  TATA_USAHA_ROLE_CODES,
} from '@cipansor/shared';

const router = Router();

// These guards used the legacy `UserRole` buckets (`UNIT_ADMIN`, `TEACHER`,
// `STAFF`), whose meaning lives in a compatibility expansion scheduled for
// removal. The sets below name the same RoleCodes directly (#989, golden rule
// 3): a role is listed here, never inherited from a bucket, so removing the
// legacy expansion cannot silently close a route. The membership is the
// faithful equivalent of the buckets these routes carried before, so no
// account gains or loses access by the conversion.
const ADMIN = [...ADMIN_ROLE_CODES, ...GOVERNANCE_ROLE_CODES];
const EDUCATOR = [
  ...SCHOOL_TEACHER_ROLE_CODES,
  ...PRINCIPAL_ROLE_CODES,
  ...PESANTREN_LEADER_ROLE_CODES,
  ...PESANTREN_EDUCATOR_ROLE_CODES,
];
const STAFF = [
  ...TATA_USAHA_ROLE_CODES,
  ...BENDAHARA_ROLE_CODES,
  ...SUPPORT_ROLE_CODES,
  ...BUSINESS_ROLE_CODES,
];

/** Who reads the catalogue and the unit's own records. */
const READERS = [...ADMIN, ...EDUCATOR, ...STAFF];
/** Who manages extracurriculars, enrolments and attendance. */
const WRITERS = [...ADMIN, ...EDUCATOR];
/** Who may create or delete an extracurricular and see unit-wide statistics. */
const MANAGERS = ADMIN;
/** Who may read one santri's own enrolments: staff, the santri, their wali. */
const SANTRI_READERS = [...READERS, ...PARENT_ROLE_CODES, ...STUDENT_ROLE_CODES];

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
  authorize(...READERS),
  extracurricularController.list.bind(extracurricularController)
);

// Get extracurricular by ID
router.get(
  '/:id',
  authorize(...READERS),
  extracurricularController.getById.bind(extracurricularController)
);

// Create extracurricular
router.post(
  '/',
  authorize(...MANAGERS),
  extracurricularController.create.bind(extracurricularController)
);

// Update extracurricular
router.put(
  '/:id',
  authorize(...WRITERS),
  extracurricularController.update.bind(extracurricularController)
);

// Delete extracurricular
router.delete(
  '/:id',
  authorize(...MANAGERS),
  extracurricularController.delete.bind(extracurricularController)
);

// ======================
// ENROLLMENT ROUTES
// ======================

// List enrollments
router.get(
  '/enrollments/list',
  authorize(...WRITERS),
  extracurricularController.listEnrollments.bind(extracurricularController)
);

// Enroll student
router.post(
  '/enrollments',
  authorize(...WRITERS),
  extracurricularController.enrollStudent.bind(extracurricularController)
);

// Bulk enroll students
router.post(
  '/enrollments/bulk',
  authorize(...WRITERS),
  extracurricularController.bulkEnroll.bind(extracurricularController)
);

// Update enrollment
router.put(
  '/enrollments/:id',
  authorize(...WRITERS),
  extracurricularController.updateEnrollment.bind(extracurricularController)
);

// ======================
// ATTENDANCE ROUTES
// ======================

// List attendance
router.get(
  '/attendance/list',
  authorize(...WRITERS),
  extracurricularController.listAttendance.bind(extracurricularController)
);

// Record attendance
router.post(
  '/attendance',
  authorize(...WRITERS),
  extracurricularController.recordAttendance.bind(extracurricularController)
);

// Get attendance summary
router.get(
  '/:id/attendance/summary',
  authorize(...WRITERS),
  extracurricularController.getAttendanceSummary.bind(extracurricularController)
);

// ======================
// ACHIEVEMENT ROUTES
// ======================

// List achievements
router.get(
  '/achievements/list',
  authorize(...READERS),
  extracurricularController.listAchievements.bind(extracurricularController)
);

// Create achievement
router.post(
  '/achievements',
  authorize(...WRITERS),
  extracurricularController.createAchievement.bind(extracurricularController)
);

// Delete achievement
router.delete(
  '/achievements/:id',
  authorize(...MANAGERS),
  extracurricularController.deleteAchievement.bind(extracurricularController)
);

// ======================
// STUDENT & STATISTICS
// ======================

// Get student's extracurriculars. A santri reaches their own enrolment (R27.4);
// the service answers 404 for a santri outside the caller's scope (R27.5).
router.get(
  '/students/:studentId',
  authorize(...SANTRI_READERS),
  extracurricularController.getStudentExtracurriculars.bind(extracurricularController)
);

// Get statistics for unit
router.get(
  '/statistics/:unitId',
  authorize(...MANAGERS),
  extracurricularController.getStatistics.bind(extracurricularController)
);

export default router;
