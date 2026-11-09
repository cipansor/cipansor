import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate, authorize } from '../../middleware/auth';
import { validate, validateQuery } from '../../middleware/validate';
import {
  CreatePricingSchema,
  UpdatePricingSchema,
  CreateTransactionSchema,
  UpdateStatusSchema,
  ProcessPaymentSchema,
  TransactionStatsQuerySchema,
} from './laundry.schema';
import * as controller from './laundry.controller';

const router = Router();

// All routes require authentication.
router.use(authenticate);

// Roles allowed to operate the laundry counter (create/update/pay).
const OPERATE_ROLES = [UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, UserRole.STAFF] as const;
// Pricing is managed by admins only.
const ADMIN_ROLES = [UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN] as const;

// ==================== PRICING ====================
router.get('/pricing', controller.listPricing);
router.get('/pricing/:id', controller.getPricing);
router.post(
  '/pricing',
  authorize(...ADMIN_ROLES),
  validate(CreatePricingSchema),
  controller.createPricing
);
router.put(
  '/pricing/:id',
  authorize(...ADMIN_ROLES),
  validate(UpdatePricingSchema),
  controller.updatePricing
);
router.delete('/pricing/:id', authorize(...ADMIN_ROLES), controller.deletePricing);

// ==================== TRANSACTION ====================
router.get('/transactions', controller.listTransactions);
router.get(
  '/transactions/stats',
  authorize(...OPERATE_ROLES),
  validateQuery(TransactionStatsQuerySchema),
  controller.getStats
);
router.get('/transactions/ready', authorize(...OPERATE_ROLES), controller.getReadyForPickup);
router.get('/transactions/student/:studentId', controller.getByStudent);
router.get('/transactions/:id', controller.getTransaction);
router.post(
  '/transactions',
  authorize(...OPERATE_ROLES),
  validate(CreateTransactionSchema),
  controller.createTransaction
);
router.patch(
  '/transactions/:id/status',
  authorize(...OPERATE_ROLES),
  validate(UpdateStatusSchema),
  controller.updateStatus
);
router.post(
  '/transactions/:id/pay',
  authorize(...OPERATE_ROLES),
  validate(ProcessPaymentSchema),
  controller.processPayment
);

export default router;
