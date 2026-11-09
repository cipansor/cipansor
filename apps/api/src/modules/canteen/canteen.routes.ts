import { Router } from 'express';
import { RoleCode } from '@prisma/client';
import { authenticate, authorize } from '../../middleware/auth';
import { validate, validateQuery } from '../../middleware/validate';
import {
  CreateCategorySchema,
  UpdateCategorySchema,
  CreateItemSchema,
  UpdateItemSchema,
  CreateTransactionSchema,
  UpdateTransactionStatusSchema,
  CreateStockMovementSchema,
  TransactionStatsQuerySchema,
} from './canteen.schema';
import * as controller from './canteen.controller';

const router = Router();

// All routes require authentication.
router.use(authenticate);

// Roles allowed to manage canteen data. Unit admins + tata usaha + super admin,
// plus the legacy pre-migration token values still present on older sessions.
const MANAGE_ROLES = [
  RoleCode.SUPER_ADMIN,
  RoleCode.TKQ_ADMIN,
  RoleCode.SDIT_ADMIN,
  RoleCode.SMPIT_ADMIN,
  RoleCode.SMAQ_ADMIN,
  RoleCode.TKQ_TATA_USAHA,
  RoleCode.SDIT_TATA_USAHA,
  RoleCode.SMPIT_TATA_USAHA,
  RoleCode.SMAQ_TATA_USAHA,
  'UNIT_ADMIN',
  'STAFF',
] as const;

// Destructive actions (delete) are limited to admins — no tata usaha / staff.
const ADMIN_ROLES = [
  RoleCode.SUPER_ADMIN,
  RoleCode.TKQ_ADMIN,
  RoleCode.SDIT_ADMIN,
  RoleCode.SMPIT_ADMIN,
  RoleCode.SMAQ_ADMIN,
  'UNIT_ADMIN',
] as const;

// ==================== CATEGORY ====================
router.get('/categories', controller.listCategories);
router.get('/categories/:id', controller.getCategory);
router.get('/efficiency', authorize(...MANAGE_ROLES), controller.getEfficiency);
router.post(
  '/categories',
  authorize(...MANAGE_ROLES),
  validate(CreateCategorySchema),
  controller.createCategory
);
router.put(
  '/categories/:id',
  authorize(...MANAGE_ROLES),
  validate(UpdateCategorySchema),
  controller.updateCategory
);
router.delete('/categories/:id', authorize(...ADMIN_ROLES), controller.deleteCategory);

// ==================== ITEM ====================
router.get('/items', controller.listItems);
router.get('/items/low-stock', authorize(...MANAGE_ROLES), controller.listLowStockItems);
router.get('/items/:id', controller.getItem);
router.post(
  '/items',
  authorize(...MANAGE_ROLES),
  validate(CreateItemSchema),
  controller.createItem
);
router.put(
  '/items/:id',
  authorize(...MANAGE_ROLES),
  validate(UpdateItemSchema),
  controller.updateItem
);
router.delete('/items/:id', authorize(...ADMIN_ROLES), controller.deleteItem);

// ==================== TRANSACTION ====================
router.get('/transactions', controller.listTransactions);
router.get(
  '/transactions/stats',
  authorize(...MANAGE_ROLES),
  validateQuery(TransactionStatsQuerySchema),
  controller.getTransactionStats
);
router.get('/transactions/:id', controller.getTransaction);
router.post(
  '/transactions',
  authorize(...MANAGE_ROLES),
  validate(CreateTransactionSchema),
  controller.createTransaction
);
router.patch(
  '/transactions/:id/status',
  authorize(...MANAGE_ROLES),
  validate(UpdateTransactionStatusSchema),
  controller.updateTransactionStatus
);

// ==================== STOCK MOVEMENT ====================
router.get('/stock-movements', authorize(...MANAGE_ROLES), controller.listStockMovements);
router.post(
  '/stock-movements',
  authorize(...MANAGE_ROLES),
  validate(CreateStockMovementSchema),
  controller.createStockMovement
);

export default router;
