import { Router } from 'express';
import { authenticate, authorize } from '@/middleware/auth';
import { validate, validateQuery } from '@/middleware/validate';
import {
  listSimaanQuerySchema,
  createSimaanSchema,
  updateSimaanSchema,
  createExaminerSchema,
  updateExaminerSchema,
  submitScoresSchema,
} from './simaan.schema';
import * as controller from './simaan.controller';
import { UserRole } from '@prisma/client';

const router: Router = Router();

/**
 * @openapi
 * /api/simaan:
 *   get:
 *     tags:
 *       - Simaan
 *     summary: List simaan exams
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: studentId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: halaqohId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: simaanType
 *         schema:
 *           type: string
 *           enum: [BIN_NAZHR, BIL_GHAIB, TAHDIR, TASMI, KHATAM]
 *       - in: query
 *         name: passed
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: List of simaan exams
 */
router.get('/', authenticate, validateQuery(listSimaanQuerySchema), controller.listSimaan);

/**
 * @openapi
 * /api/simaan/upcoming:
 *   get:
 *     tags:
 *       - Simaan
 *     summary: Get upcoming exams
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: halaqohId
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 7
 *     responses:
 *       200:
 *         description: List of upcoming exams
 */
// Above `/:id`, which would otherwise answer `/upcoming` as an exam lookup
// (the Jadwal Simaan page calls it; utils/route-shadowing.guard.test.ts).
router.get('/upcoming', authenticate, controller.getUpcomingExams);

/**
 * @openapi
 * /api/simaan/{id}:
 *   get:
 *     tags:
 *       - Simaan
 *     summary: Get simaan exam by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Simaan exam details
 */
router.get('/:id', authenticate, controller.getSimaanById);

/**
 * @openapi
 * /api/simaan:
 *   post:
 *     tags:
 *       - Simaan
 *     summary: Create simaan exam
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Simaan exam created
 */
router.post(
  '/',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validate(createSimaanSchema),
  controller.createSimaan
);

/**
 * @openapi
 * /api/simaan/{id}:
 *   patch:
 *     tags:
 *       - Simaan
 *     summary: Update simaan exam
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Simaan exam updated
 */
router.patch(
  '/:id',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validate(updateSimaanSchema),
  controller.updateSimaan
);

/**
 * @openapi
 * /api/simaan/{id}:
 *   delete:
 *     tags:
 *       - Simaan
 *     summary: Delete simaan exam
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Simaan exam deleted
 */
router.delete(
  '/:id',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  controller.deleteSimaan
);

/**
 * @openapi
 * /api/simaan/examiners:
 *   post:
 *     tags:
 *       - Simaan
 *     summary: Add examiner to simaan
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Examiner added
 */
router.post(
  '/examiners',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validate(createExaminerSchema),
  controller.addExaminer
);

/**
 * @openapi
 * /api/simaan/examiners/{id}:
 *   patch:
 *     tags:
 *       - Simaan
 *     summary: Update examiner
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Examiner updated
 */
router.patch(
  '/examiners/:id',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validate(updateExaminerSchema),
  controller.updateExaminer
);

/**
 * @openapi
 * /api/simaan/examiners/{id}:
 *   delete:
 *     tags:
 *       - Simaan
 *     summary: Delete examiner
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Examiner deleted
 */
router.delete(
  '/examiners/:id',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  controller.deleteExaminer
);

/**
 * @openapi
 * /api/simaan/scores:
 *   post:
 *     tags:
 *       - Simaan
 *     summary: Submit scores for simaan
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Scores submitted
 */
router.post(
  '/scores',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validate(submitScoresSchema),
  controller.submitScores
);

/**
 * @openapi
 * /api/simaan/students/{studentId}/summary:
 *   get:
 *     tags:
 *       - Simaan
 *     summary: Get student simaan summary
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Student simaan summary
 */
router.get('/students/:studentId/summary', authenticate, controller.getStudentSummary);

/**
 * @openapi
 * /api/simaan/halaqoh/{halaqohId}:
 *   get:
 *     tags:
 *       - Simaan
 *     summary: Get halaqoh simaan records
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Halaqoh simaan records
 */
router.get(
  '/halaqoh/:halaqohId',
  authenticate,
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  controller.getHalaqohRecords
);

export default router;
