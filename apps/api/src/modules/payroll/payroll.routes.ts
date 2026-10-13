import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import { BENDAHARA_ROLE_CODES } from '@cipansor/shared';
import { UserRole } from '@prisma/client';
import { validate } from '../../middleware/validate';
import * as controller from './payroll.controller';
import {
  createSalaryComponentSchema,
  updateSalaryComponentSchema,
  createEmployeeSalarySchema,
  updateEmployeeSalarySchema,
  createPayrollPeriodSchema,
  updatePayrollPeriodSchema,
  generatePayrollSchema,
  approvePayrollPeriodSchema,
  payPayrollPeriodSchema,
  payrollItemAdjustmentSchema,
} from './payroll.schema';

const router = Router();

// Apply authentication to all routes
router.use(authenticate);

// Salaries, slips and the bank accounts on them are for the people who run
// payroll: Super Admin, the unit's operator and the yayasan board, and the
// bendahara who pays. Until 2026-09-24 every read here was open to any
// signed-in account, santri included. Writes keep their stricter guards below.
router.use(authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN, ...BENDAHARA_ROLE_CODES));

// ============================================
// SALARY COMPONENTS
// ============================================
router.get('/components', controller.listComponents);
router.get('/components/:id', controller.getComponent);
router.post(
  '/components',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validate(createSalaryComponentSchema),
  controller.createComponent
);
router.put(
  '/components/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validate(updateSalaryComponentSchema),
  controller.updateComponent
);
router.delete('/components/:id', authorize(UserRole.SUPER_ADMIN), controller.deleteComponent);
router.post('/components/seed', authorize(UserRole.SUPER_ADMIN), controller.seedComponents);

// ============================================
// EMPLOYEE SALARIES
// ============================================
router.get('/salaries', controller.listSalaries);
router.get('/salaries/:staffId', controller.getSalary);
router.post(
  '/salaries',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validate(createEmployeeSalarySchema),
  controller.createSalary
);
router.put(
  '/salaries/:staffId',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validate(updateEmployeeSalarySchema),
  controller.updateSalary
);
router.delete('/salaries/:staffId', authorize(UserRole.SUPER_ADMIN), controller.deleteSalary);

// ============================================
// PAYROLL PERIODS
// ============================================
router.get('/periods', controller.listPeriods);
router.get('/periods/:id', controller.getPeriod);
router.post(
  '/periods',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validate(createPayrollPeriodSchema),
  controller.createPeriod
);
router.put(
  '/periods/:id',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validate(updatePayrollPeriodSchema),
  controller.updatePeriod
);
router.post(
  '/periods/:id/approve',
  authorize(UserRole.SUPER_ADMIN),
  validate(approvePayrollPeriodSchema),
  controller.approvePeriod
);
router.post(
  '/periods/:id/pay',
  authorize(UserRole.SUPER_ADMIN),
  validate(payPayrollPeriodSchema),
  controller.payPeriod
);
router.post('/periods/:id/cancel', authorize(UserRole.SUPER_ADMIN), controller.cancelPeriod);
router.delete('/periods/:id', authorize(UserRole.SUPER_ADMIN), controller.deletePeriod);
router.get('/periods/:id/summary', controller.getPeriodSummary);
router.get('/periods/:id/attendance-deductions', controller.previewAttendanceDeductions);

// ============================================
// PAYROLLS (SLIP GAJI)
// ============================================
router.get('/slips', controller.listSlips);
router.get('/slips/:id', controller.getSlip);
router.post(
  '/generate',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validate(generatePayrollSchema),
  controller.generate
);
router.put(
  '/slips/:id/adjust',
  authorize(UserRole.SUPER_ADMIN, UserRole.UNIT_ADMIN),
  validate(payrollItemAdjustmentSchema),
  controller.adjustSlip
);

export default router;
