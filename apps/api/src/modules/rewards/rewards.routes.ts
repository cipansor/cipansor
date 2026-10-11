import { Router } from 'express';
import { UserRole } from '@prisma/client';
import * as controller from './rewards.controller';
import { authenticate, authorize } from '../../middleware/auth';
import { validateQuery } from '../../middleware/error';
import { queryRewardSchema } from './rewards.schema';

const router = Router();

router.use(authenticate);

/**
 * @swagger
 * /api/rewards:
 *   get:
 *     summary: List rewards
 *     tags: [Rewards]
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
 *         name: page
 *         schema:
 *           type: integer
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of rewards
 */
router.get(
  '/',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  validateQuery(queryRewardSchema),
  controller.getRewards
);

/**
 * @swagger
 * /api/rewards/categories:
 *   get:
 *     summary: List reward categories
 *     tags: [Rewards]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of reward categories with points
 */
router.get(
  '/categories',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  controller.getRewardCategories
);

router.get(
  '/categories/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  controller.getRewardCategoryById
);

/**
 * @swagger
 * /api/rewards/top-students:
 *   get:
 *     summary: Get top students by points
 *     tags: [Rewards]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: unitId
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: List of top students by reward points
 */
router.get(
  '/top-students',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  controller.getTopStudentsByPoints
);

/**
 * @swagger
 * /api/rewards:
 *   post:
 *     summary: Give a reward to student
 *     tags: [Rewards]
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
 *     responses:
 *       201:
 *         description: Reward given
 */
router.post(
  '/',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  controller.createReward
);

/**
 * @swagger
 * /api/rewards/student/{studentId}/summary:
 *   get:
 *     summary: Get student's reward summary
 *     tags: [Rewards]
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
 *         description: Student's reward summary (total rewards, points earned)
 */
router.get(
  '/student/:studentId/summary',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.PARENT),
  controller.getStudentRewardSummary
);

/**
 * @swagger
 * /api/rewards/student/{studentId}/balance:
 *   get:
 *     summary: Get student's point balance
 *     tags: [Rewards]
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
 *         description: Student's current point balance
 */
router.get(
  '/student/:studentId/balance',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER, UserRole.PARENT),
  controller.getStudentPointBalance
);

/**
 * @swagger
 * /api/rewards/{id}:
 *   get:
 *     summary: Get reward by ID
 *     tags: [Rewards]
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
 *         description: Reward details
 *       404:
 *         description: Reward not found
 */
router.get(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.TEACHER),
  controller.getRewardById
);

/**
 * @swagger
 * /api/rewards/{id}:
 *   put:
 *     summary: Update reward
 *     tags: [Rewards]
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
 *         description: Reward updated
 */
router.put('/:id', authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN), controller.updateReward);

/**
 * @swagger
 * /api/rewards/{id}:
 *   delete:
 *     summary: Delete reward
 *     tags: [Rewards]
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
 *         description: Reward deleted
 */
router.delete(
  '/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  controller.deleteReward
);

export default router;
