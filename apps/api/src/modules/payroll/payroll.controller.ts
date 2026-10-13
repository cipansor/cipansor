import { requireUser } from '../../middleware/auth';
import { Request, Response } from 'express';
import { asyncHandler } from '../../middleware/error';
import {
  salaryComponentService,
  employeeSalaryService,
  payrollPeriodService,
  payrollService,
} from './payroll.service';
import { attendanceDeductionService } from './attendance-deduction.service';
import {
  listSalaryComponentsQuerySchema,
  listEmployeeSalariesQuerySchema,
  listPayrollPeriodsQuerySchema,
  listPayrollsQuerySchema,
} from './payroll.schema';

// ============================================
// SALARY COMPONENTS
// ============================================

/** GET /api/payroll/components */
export const listComponents = asyncHandler(async (req: Request, res: Response) => {
  const query = listSalaryComponentsQuerySchema.parse(req.query);
  const components = await salaryComponentService.list({
    type: query.type as any,
    isActive: query.isActive === 'true' ? true : query.isActive === 'false' ? false : undefined,
    search: query.search,
  });
  res.json({ success: true, data: components });
});

/** GET /api/payroll/components/:id */
export const getComponent = asyncHandler(async (req: Request, res: Response) => {
  const component = await salaryComponentService.getById(req.params.id);
  if (!component) {
    return res.status(404).json({ success: false, message: 'Komponen gaji tidak ditemukan' });
  }
  res.json({ success: true, data: component });
});

/** POST /api/payroll/components */
export const createComponent = asyncHandler(async (req: Request, res: Response) => {
  const component = await salaryComponentService.create(req.body);
  res
    .status(201)
    .json({ success: true, message: 'Komponen gaji berhasil dibuat', data: component });
});

/** PUT /api/payroll/components/:id */
export const updateComponent = asyncHandler(async (req: Request, res: Response) => {
  const component = await salaryComponentService.update(req.params.id, req.body);
  res.json({ success: true, message: 'Komponen gaji berhasil diperbarui', data: component });
});

/** DELETE /api/payroll/components/:id */
export const deleteComponent = asyncHandler(async (req: Request, res: Response) => {
  await salaryComponentService.delete(req.params.id);
  res.json({ success: true, message: 'Komponen gaji berhasil dihapus' });
});

/** POST /api/payroll/components/seed */
export const seedComponents = asyncHandler(async (_req: Request, res: Response) => {
  const result = await salaryComponentService.seedDefaults();
  res.json({ success: true, message: 'Komponen gaji default berhasil dibuat', data: result });
});

// ============================================
// EMPLOYEE SALARIES
// ============================================

/** GET /api/payroll/salaries */
export const listSalaries = asyncHandler(async (req: Request, res: Response) => {
  const query = listEmployeeSalariesQuerySchema.parse(req.query);
  const result = await employeeSalaryService.list({
    unitId: query.unitId,
    search: query.search,
    page: parseInt(query.page),
    limit: parseInt(query.limit),
  });
  res.json({ success: true, data: result.data, meta: result.meta });
});

/** GET /api/payroll/salaries/:staffId */
export const getSalary = asyncHandler(async (req: Request, res: Response) => {
  const salary = await employeeSalaryService.getByStaffId(req.params.staffId);
  if (!salary) {
    return res
      .status(404)
      .json({ success: false, message: 'Pengaturan gaji karyawan tidak ditemukan' });
  }
  res.json({ success: true, data: salary });
});

/** POST /api/payroll/salaries */
export const createSalary = asyncHandler(async (req: Request, res: Response) => {
  const salary = await employeeSalaryService.create(req.body);
  res
    .status(201)
    .json({ success: true, message: 'Pengaturan gaji karyawan berhasil dibuat', data: salary });
});

/** PUT /api/payroll/salaries/:staffId */
export const updateSalary = asyncHandler(async (req: Request, res: Response) => {
  const salary = await employeeSalaryService.update(req.params.staffId, req.body);
  res.json({
    success: true,
    message: 'Pengaturan gaji karyawan berhasil diperbarui',
    data: salary,
  });
});

/** DELETE /api/payroll/salaries/:staffId */
export const deleteSalary = asyncHandler(async (req: Request, res: Response) => {
  await employeeSalaryService.delete(req.params.staffId);
  res.json({ success: true, message: 'Pengaturan gaji karyawan berhasil dihapus' });
});

// ============================================
// PAYROLL PERIODS
// ============================================

/** GET /api/payroll/periods */
export const listPeriods = asyncHandler(async (req: Request, res: Response) => {
  const query = listPayrollPeriodsQuerySchema.parse(req.query);
  const result = await payrollPeriodService.list({
    unitId: query.unitId,
    year: query.year ? parseInt(query.year) : undefined,
    status: query.status as any,
    page: parseInt(query.page),
    limit: parseInt(query.limit),
  });
  res.json({ success: true, data: result.data, meta: result.meta });
});

/** GET /api/payroll/periods/:id */
export const getPeriod = asyncHandler(async (req: Request, res: Response) => {
  const period = await payrollPeriodService.getById(req.params.id);
  if (!period) {
    return res.status(404).json({ success: false, message: 'Periode penggajian tidak ditemukan' });
  }
  res.json({ success: true, data: period });
});

/** POST /api/payroll/periods */
export const createPeriod = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUser(req).id;
  const period = await payrollPeriodService.create(req.body, userId);
  res
    .status(201)
    .json({ success: true, message: 'Periode penggajian berhasil dibuat', data: period });
});

/** PUT /api/payroll/periods/:id */
export const updatePeriod = asyncHandler(async (req: Request, res: Response) => {
  const period = await payrollPeriodService.update(req.params.id, req.body);
  res.json({ success: true, message: 'Periode penggajian berhasil diperbarui', data: period });
});

/** POST /api/payroll/periods/:id/approve */
export const approvePeriod = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUser(req).id;
  const period = await payrollPeriodService.approve(req.params.id, userId, req.body.notes);
  res.json({ success: true, message: 'Periode penggajian berhasil disetujui', data: period });
});

/** POST /api/payroll/periods/:id/pay */
export const payPeriod = asyncHandler(async (req: Request, res: Response) => {
  const userId = requireUser(req).id;
  const period = await payrollPeriodService.markAsPaid(
    req.params.id,
    new Date(req.body.payDate),
    req.body.notes,
    userId
  );
  res.json({
    success: true,
    message: 'Periode penggajian berhasil ditandai sebagai dibayar',
    data: period,
  });
});

/** POST /api/payroll/periods/:id/cancel */
export const cancelPeriod = asyncHandler(async (req: Request, res: Response) => {
  const period = await payrollPeriodService.cancel(req.params.id, req.body.notes);
  res.json({ success: true, message: 'Periode penggajian berhasil dibatalkan', data: period });
});

/** DELETE /api/payroll/periods/:id */
export const deletePeriod = asyncHandler(async (req: Request, res: Response) => {
  await payrollPeriodService.delete(req.params.id);
  res.json({ success: true, message: 'Periode penggajian berhasil dihapus' });
});

/** GET /api/payroll/periods/:id/summary */
export const getPeriodSummary = asyncHandler(async (req: Request, res: Response) => {
  const summary = await payrollService.getSummary(req.params.id);
  res.json({ success: true, data: summary });
});

// ============================================
// PAYROLLS (SLIP GAJI)
// ============================================

/** GET /api/payroll/slips */
export const listSlips = asyncHandler(async (req: Request, res: Response) => {
  const query = listPayrollsQuerySchema.parse(req.query);
  const result = await payrollService.list({
    periodId: query.periodId,
    staffId: query.staffId,
    search: query.search,
    page: parseInt(query.page),
    limit: parseInt(query.limit),
  });
  res.json({ success: true, data: result.data, meta: result.meta });
});

/** GET /api/payroll/slips/:id */
export const getSlip = asyncHandler(async (req: Request, res: Response) => {
  const payroll = await payrollService.getById(req.params.id);
  if (!payroll) {
    return res.status(404).json({ success: false, message: 'Slip gaji tidak ditemukan' });
  }
  res.json({ success: true, data: payroll });
});

/** POST /api/payroll/generate */
export const generate = asyncHandler(async (req: Request, res: Response) => {
  const result = await payrollService.generate(req.body);
  res.json({
    success: true,
    message: `${result.created} slip gaji dibuat, ${result.updated} diperbarui`,
    data: result,
  });
});

/** PUT /api/payroll/slips/:id/adjust */
export const adjustSlip = asyncHandler(async (req: Request, res: Response) => {
  const payroll = await payrollService.adjustItem(req.params.id, req.body);
  res.json({ success: true, message: 'Slip gaji berhasil disesuaikan', data: payroll });
});

/**
 * GET /api/payroll/periods/:id/attendance-deductions
 * A dry run: what the configured rules would deduct from each slip in the
 * period, before anything is generated. This is what lets an admin see the
 * effect of a policy change without touching a single payslip.
 */
export const previewAttendanceDeductions = asyncHandler(async (req: Request, res: Response) => {
  const result = await attendanceDeductionService.computeForPeriod(req.params.id);
  res.json({ success: true, data: result });
});
