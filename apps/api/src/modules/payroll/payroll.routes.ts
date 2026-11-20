import { Router } from 'express';
import { authenticate, authorize } from '../../middleware/auth';
import {
  BENDAHARA_ROLE_CODES,
  PAYROLL_APPROVER_ROLE_CODES,
  PAYROLL_COMPONENT_MANAGER_ROLE_CODES,
  PAYROLL_READER_ROLE_CODES,
} from '@cipansor/shared';
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
  cancelPayrollPeriodSchema,
  payrollItemAdjustmentSchema,
} from './payroll.schema';

const router = Router();

// Apply authentication to all routes
router.use(authenticate);

// Salary is an employee's personal data, and paying it is a financial act:
// readers are Super Admin, the yayasan organs and the unit treasurers (#990,
// R1.14). Admin_Unit, Kepala_Unit, TU_Unit and Guru are not among them, and
// the guards below separate who drafts a period (the unit treasurer), who
// approves it (Bendahara Yayasan or Ketua Pengurus, never its creator) and who
// pays it (the unit treasurer again). The decisions themselves live in
// `decidePayroll` (@cipansor/shared) — these guards only keep the role out
// before the record is read.
router.use(authorize(...PAYROLL_READER_ROLE_CODES));

// ============================================
// SALARY COMPONENTS
// ============================================
// Yayasan-level components carry no unit and feed every unit's payroll, so
// only Bendahara Yayasan writes them (R1.21, R1.23); the yayasan is the
// employer (PP 36/2021).
router.get('/components', controller.listComponents);
router.get('/components/:id', controller.getComponent);
router.post(
  '/components',
  authorize(...PAYROLL_COMPONENT_MANAGER_ROLE_CODES),
  validate(createSalaryComponentSchema),
  controller.createComponent
);
router.put(
  '/components/:id',
  authorize(...PAYROLL_COMPONENT_MANAGER_ROLE_CODES),
  validate(updateSalaryComponentSchema),
  controller.updateComponent
);
router.delete(
  '/components/:id',
  authorize(...PAYROLL_COMPONENT_MANAGER_ROLE_CODES),
  controller.deleteComponent
);
router.post(
  '/components/seed',
  authorize(...PAYROLL_COMPONENT_MANAGER_ROLE_CODES),
  controller.seedComponents
);

// ============================================
// EMPLOYEE SALARIES
// ============================================
router.get('/salaries', controller.listSalaries);
router.get('/salaries/:staffId', controller.getSalary);
router.post(
  '/salaries',
  authorize(...BENDAHARA_ROLE_CODES),
  validate(createEmployeeSalarySchema),
  controller.createSalary
);
router.put(
  '/salaries/:staffId',
  authorize(...BENDAHARA_ROLE_CODES),
  validate(updateEmployeeSalarySchema),
  controller.updateSalary
);
router.delete('/salaries/:staffId', authorize(...BENDAHARA_ROLE_CODES), controller.deleteSalary);

// ============================================
// PAYROLL PERIODS
// ============================================
router.get('/periods', controller.listPeriods);
router.get('/periods/:id', controller.getPeriod);
router.post(
  '/periods',
  authorize(...BENDAHARA_ROLE_CODES),
  validate(createPayrollPeriodSchema),
  controller.createPeriod
);
router.put(
  '/periods/:id',
  authorize(...BENDAHARA_ROLE_CODES),
  validate(updatePayrollPeriodSchema),
  controller.updatePeriod
);
router.post(
  '/periods/:id/approve',
  authorize(...PAYROLL_APPROVER_ROLE_CODES),
  validate(approvePayrollPeriodSchema),
  controller.approvePeriod
);
router.post(
  '/periods/:id/pay',
  authorize(...BENDAHARA_ROLE_CODES),
  validate(payPayrollPeriodSchema),
  controller.payPeriod
);
router.post(
  '/periods/:id/cancel',
  authorize(...BENDAHARA_ROLE_CODES, ...PAYROLL_APPROVER_ROLE_CODES),
  validate(cancelPayrollPeriodSchema),
  controller.cancelPeriod
);
router.delete('/periods/:id', authorize(...BENDAHARA_ROLE_CODES), controller.deletePeriod);
router.get('/periods/:id/summary', controller.getPeriodSummary);
router.get('/periods/:id/attendance-deductions', controller.previewAttendanceDeductions);

// ============================================
// PAYROLLS (SLIP GAJI)
// ============================================
router.get('/slips', controller.listSlips);
router.get('/slips/:id', controller.getSlip);
router.post(
  '/generate',
  authorize(...BENDAHARA_ROLE_CODES),
  validate(generatePayrollSchema),
  controller.generate
);
router.put(
  '/slips/:id/adjust',
  authorize(...BENDAHARA_ROLE_CODES),
  validate(payrollItemAdjustmentSchema),
  controller.adjustSlip
);

export default router;
