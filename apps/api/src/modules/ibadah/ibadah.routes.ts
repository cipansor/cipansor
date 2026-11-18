import { Router } from 'express';
import { authenticate, authorize, isTeacherOrAbove } from '@/middleware/auth';
import { validate } from '@/middleware/validate';
import * as controller from './ibadah.controller';
import {
  createTargetSchema,
  updateTargetSchema,
  createRecordSchema,
  updateRecordSchema,
  bulkCreateRecordsSchema,
  verifyRecordSchema,
  dailyCheckInSchema,
  createIslamicEventSchema,
  updateIslamicEventSchema,
} from './ibadah.schema';

const router = Router();

// All routes require authentication.
router.use(authenticate);

// ==================== TARGETS ====================
router.get('/targets', controller.listTargets);
router.get('/targets/:id', controller.getTarget);
router.post('/targets', isTeacherOrAbove, validate(createTargetSchema), controller.createTarget);
router.put('/targets/:id', isTeacherOrAbove, validate(updateTargetSchema), controller.updateTarget);
router.delete('/targets/:id', authorize('SUPER_ADMIN', 'UNIT_ADMIN'), controller.deleteTarget);
router.post(
  '/targets/seed/:unitId',
  authorize('SUPER_ADMIN', 'UNIT_ADMIN'),
  controller.seedTargets
);

// ==================== RECORDS ====================
// The three writes are gated `isTeacherOrAbove` (403 before any id lookup);
// the service then narrows to the santri the caller may write (R27.1).
router.get('/records', controller.listRecords);
router.get('/records/:id', controller.getRecord);
router.post('/records', isTeacherOrAbove, validate(createRecordSchema), controller.createRecord);
router.put('/records/:id', isTeacherOrAbove, validate(updateRecordSchema), controller.updateRecord);
router.delete('/records/:id', isTeacherOrAbove, controller.deleteRecord);
router.post(
  '/records/bulk',
  isTeacherOrAbove,
  validate(bulkCreateRecordsSchema),
  controller.bulkCreateRecords
);
router.post(
  '/records/verify',
  isTeacherOrAbove,
  validate(verifyRecordSchema),
  controller.verifyRecords
);

// ==================== DAILY CHECK-IN ====================
// The fourth ibadah write: gated `isTeacherOrAbove` like the three above, and
// the service narrows to the santri the caller may write (R27.1–R27.2).
router.post('/check-in', isTeacherOrAbove, validate(dailyCheckInSchema), controller.dailyCheckIn);

// ==================== LEADERBOARD ====================
router.get('/leaderboard', controller.getLeaderboard);

// ==================== ACHIEVEMENTS ====================
router.get('/achievements/me', controller.getMyAchievements);
router.get('/achievements/:studentId', isTeacherOrAbove, controller.getStudentAchievements);

// ==================== STATISTICS ====================
router.get('/stats/student', controller.getStudentStats);
router.get('/stats/unit', controller.getUnitStats);
router.get('/stats/class', controller.getClassStats);

// ==================== ISLAMIC EVENTS ====================
router.get('/events', controller.listEvents);
router.get('/events/:id', controller.getEvent);
router.post(
  '/events',
  isTeacherOrAbove,
  validate(createIslamicEventSchema),
  controller.createEvent
);
router.put(
  '/events/:id',
  isTeacherOrAbove,
  validate(updateIslamicEventSchema),
  controller.updateEvent
);
router.delete('/events/:id', authorize('SUPER_ADMIN', 'UNIT_ADMIN'), controller.deleteEvent);

export default router;
