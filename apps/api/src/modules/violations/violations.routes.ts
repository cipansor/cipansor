import { Router } from 'express';
import { UserRole } from '@prisma/client';
import * as controller from './violations.controller';
import { authenticate, authorize } from '../../middleware/auth';
import { validateQuery } from '../../middleware/error';
import { queryViolationSchema } from './violations.schema';

const router = Router();

router.use(authenticate);

/**
 * @swagger
 * /api/violations:
 *   get:
 *     summary: List violations
 *     tags: [Violations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: studentId
 *         schema:
 *           type: string
 *       - in: query
 *         name: categoryId
 *         schema:
 *           type: string
 *       - in: query
 *         name: severity
 *         schema:
 *           type: string
 *           enum: [MINOR, MODERATE, MAJOR, SEVERE]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of violations
 */
router.get(
  '/',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validateQuery(queryViolationSchema),
  controller.getViolations
);

/**
 * @swagger
 * /api/violations/categories:
 *   get:
 *     summary: List violation categories
 *     tags: [Violations]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of violation categories with point deductions
 */
router.get(
  '/categories',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  controller.getViolationCategories
);

router.get(
  '/categories/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  controller.getViolationCategoryById
);

/**
 * @swagger
 * /api/violations:
 *   post:
 *     summary: Record a violation
 *     tags: [Violations]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - studentId
 *               - categoryId
 *             properties:
 *               studentId:
 *                 type: string
 *               categoryId:
 *                 type: string
 *               description:
 *                 type: string
 *               date:
 *                 type: string
 *                 format: date-time
 *               action:
 *                 type: string
 *     responses:
 *       201:
 *         description: Violation recorded
 */
router.post(
  '/',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  controller.createViolation
);

/**
 * @swagger
 * /api/violations/student/{studentId}/summary:
 *   get:
 *     summary: Get student's violation summary
 *     tags: [Violations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: studentId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Student's violation summary (total, by severity, points deducted)
 */
router.get(
  '/student/:studentId/summary',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.PARENT),
  controller.getStudentViolationSummary
);

/**
 * @swagger
 * /api/violations/{id}:
 *   get:
 *     summary: Get violation by ID
 *     tags: [Violations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Violation details
 *       404:
 *         description: Violation not found
 */
router.get(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  controller.getViolationById
);

/**
 * @swagger
 * /api/violations/{id}:
 *   put:
 *     summary: Update violation
 *     tags: [Violations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Violation updated
 */
router.put(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  controller.updateViolation
);

/**
 * @swagger
 * /api/violations/{id}:
 *   delete:
 *     summary: Delete violation
 *     tags: [Violations]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Violation deleted
 */
router.delete(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  controller.deleteViolation
);

export default router;
