import { describe, expect, it } from 'vitest';
import {
  listPayrollPeriodsQuerySchema,
  updateSalaryComponentSchema,
  updateEmployeeSalarySchema,
} from '../payroll.schema';

describe('payroll update schemas (Zod 4 partial-overwrite regression)', () => {
  describe('updateSalaryComponentSchema', () => {
    it('does not leak isFixed/isPercentage/isTaxable/isActive/sortOrder defaults when only name is sent', () => {
      const parsed = updateSalaryComponentSchema.parse({ name: 'Tunjangan' });
      expect(parsed).toEqual({ name: 'Tunjangan' });
    });

    it('parses an empty object to only the keys actually sent', () => {
      expect(updateSalaryComponentSchema.parse({})).toEqual({});
    });

    it('keeps explicitly provided defaulted fields', () => {
      const parsed = updateSalaryComponentSchema.parse({ isFixed: false, sortOrder: 5 });
      expect(parsed).toEqual({ isFixed: false, sortOrder: 5 });
    });
  });

  describe('updateEmployeeSalarySchema', () => {
    it('does not leak taxStatus default when only baseSalary is sent', () => {
      const parsed = updateEmployeeSalarySchema.parse({ baseSalary: 5000000 });
      expect(parsed).toEqual({ baseSalary: 5000000 });
    });

    it('parses an empty object to only the keys actually sent', () => {
      expect(updateEmployeeSalarySchema.parse({})).toEqual({});
    });

    it('keeps explicitly provided defaulted fields', () => {
      const parsed = updateEmployeeSalarySchema.parse({ taxStatus: 'K/1' });
      expect(parsed).toEqual({ taxStatus: 'K/1' });
    });
  });
});

describe('listPayrollPeriodsQuerySchema', () => {
  it('accepts a string or a bare number from Express', () => {
    expect(listPayrollPeriodsQuerySchema.parse({ year: '2026' }).year).toBe('2026');
    expect(listPayrollPeriodsQuerySchema.parse({ year: 2026 }).year).toBe('2026');
    expect(listPayrollPeriodsQuerySchema.parse({ page: 2, limit: 50 })).toMatchObject({
      page: '2',
      limit: '50',
    });
  });

  it('refuses a repeated year instead of silently using the first value', () => {
    expect(() => listPayrollPeriodsQuerySchema.parse({ year: ['2025', '2026'] })).toThrow();
  });
});
