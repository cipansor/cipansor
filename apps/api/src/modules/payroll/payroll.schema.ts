import { z } from 'zod';
import { partialUpdateSchema } from '@/lib/partial';

// Salary Component Schemas
export const salaryComponentSchema = z.object({
  code: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  type: z.enum(['EARNING', 'DEDUCTION']),
  description: z.string().optional(),
  isFixed: z.boolean().default(true),
  isPercentage: z.boolean().default(false),
  percentageOf: z.string().optional(),
  defaultAmount: z.number().min(0).optional(),
  defaultRate: z.number().min(0).max(1).optional(),
  isTaxable: z.boolean().default(true),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
});

export const createSalaryComponentSchema = salaryComponentSchema;
export const updateSalaryComponentSchema = partialUpdateSchema(salaryComponentSchema);

// Employee Salary Schemas
export const employeeSalaryItemSchema = z.object({
  componentId: z.string().uuid(),
  amount: z.number().min(0),
  isPercentage: z.boolean().default(false),
  rate: z.number().min(0).max(1).optional(),
  notes: z.string().optional(),
});

export const employeeSalarySchema = z.object({
  staffId: z.string().uuid(),
  baseSalary: z.number().min(0),
  bankName: z.string().optional(),
  bankAccount: z.string().optional(),
  bankHolder: z.string().optional(),
  taxStatus: z.string().default('TK/0'),
  npwp: z.string().optional(),
  effectiveAt: z.string().datetime(),
  notes: z.string().optional(),
  items: z.array(employeeSalaryItemSchema).optional(),
});

export const createEmployeeSalarySchema = employeeSalarySchema;
export const updateEmployeeSalarySchema = partialUpdateSchema(employeeSalarySchema).omit({
  staffId: true,
});

// Payroll Period Schemas
export const payrollPeriodSchema = z.object({
  unitId: z.string().uuid(),
  name: z.string().min(1).max(100),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  payDate: z.string().datetime().optional(),
  notes: z.string().optional(),
});

export const createPayrollPeriodSchema = payrollPeriodSchema;
export const updatePayrollPeriodSchema = payrollPeriodSchema.partial().omit({ unitId: true });

// Payroll Item Schema (for manual adjustment)
export const payrollItemAdjustmentSchema = z.object({
  componentId: z.string().uuid(),
  amount: z.number(),
  notes: z.string().optional(),
});

// Generate Payroll Schema
export const generatePayrollSchema = z.object({
  periodId: z.string().uuid(),
  staffIds: z.array(z.string().uuid()).optional(), // If empty, generate for all staff
  overwrite: z.boolean().default(false),
  /**
   * A written reason for generating a slip whose deduction crosses the guard
   * (PP 36/2021 art. 32). Absent, a breaching slip is refused rather than
   * silently produced.
   */
  overrideGuardReason: z.string().min(10).max(500).optional(),
});

// Approve Payroll Period Schema
export const approvePayrollPeriodSchema = z.object({
  notes: z.string().optional(),
});

// Pay Payroll Period Schema
export const payPayrollPeriodSchema = z.object({
  payDate: z.string().datetime(),
  notes: z.string().optional(),
});

// Query Schemas
export const listSalaryComponentsQuerySchema = z.object({
  type: z.enum(['EARNING', 'DEDUCTION']).optional(),
  isActive: z.enum(['true', 'false']).optional(),
  search: z.string().optional(),
});

export const listEmployeeSalariesQuerySchema = z.object({
  unitId: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.string().default('1'),
  limit: z.string().default('20'),
});

export const listPayrollPeriodsQuerySchema = z.object({
  unitId: z.string().uuid().optional(),
  year: z.string().optional(),
  status: z.enum(['DRAFT', 'APPROVED', 'PAID', 'CANCELLED']).optional(),
  page: z.string().default('1'),
  limit: z.string().default('20'),
});

export const listPayrollsQuerySchema = z.object({
  periodId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  search: z.string().optional(),
  page: z.string().default('1'),
  limit: z.string().default('20'),
});

// Types
export type CreateSalaryComponentInput = z.infer<typeof createSalaryComponentSchema>;
export type UpdateSalaryComponentInput = z.infer<typeof updateSalaryComponentSchema>;
export type CreateEmployeeSalaryInput = z.infer<typeof createEmployeeSalarySchema>;
export type UpdateEmployeeSalaryInput = z.infer<typeof updateEmployeeSalarySchema>;
export type CreatePayrollPeriodInput = z.infer<typeof createPayrollPeriodSchema>;
export type UpdatePayrollPeriodInput = z.infer<typeof updatePayrollPeriodSchema>;
export type GeneratePayrollInput = z.infer<typeof generatePayrollSchema>;
export type ApprovePayrollPeriodInput = z.infer<typeof approvePayrollPeriodSchema>;
export type PayPayrollPeriodInput = z.infer<typeof payPayrollPeriodSchema>;
export type PayrollItemAdjustmentInput = z.infer<typeof payrollItemAdjustmentSchema>;
