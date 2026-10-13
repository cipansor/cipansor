import { describe, it, expect } from 'vitest';
import { effectiveItemAmount, isBasicSalaryComponent, reconcileSalary } from '../payroll-tax';

function item(
  overrides: {
    code?: string;
    name?: string;
    type?: string;
    classification?: string;
    isTaxable?: boolean;
    amount?: number;
    isPercentage?: boolean;
    rate?: number;
  } = {}
) {
  const {
    code = 'MEAL_ALLOWANCE',
    name = 'Tunjangan Makan',
    type = 'EARNING',
    classification = 'TIDAK_TETAP',
    isTaxable = true,
    amount = 500_000,
    isPercentage,
    rate,
  } = overrides;
  return {
    amount,
    isPercentage,
    rate,
    component: { code, name, type, classification, isTaxable },
  };
}

describe('isBasicSalaryComponent', () => {
  it('treats a POKOK earning as the base salary', () => {
    expect(isBasicSalaryComponent({ code: 'X', classification: 'POKOK' })).toBe(true);
  });

  it('recognises the legacy names without a classification', () => {
    expect(isBasicSalaryComponent({ code: 'GAJI_POKOK', classification: 'TIDAK_TETAP' })).toBe(
      true
    );
    expect(isBasicSalaryComponent({ code: 'BASIC_SALARY', classification: 'TIDAK_TETAP' })).toBe(
      true
    );
  });

  it('leaves a real allowance alone', () => {
    expect(isBasicSalaryComponent({ code: 'MEAL_ALLOWANCE', classification: 'TETAP' })).toBe(false);
  });
});

describe('effectiveItemAmount', () => {
  it('takes a percentage of the base salary', () => {
    expect(effectiveItemAmount({ amount: 0, isPercentage: true, rate: 0.1 }, 4_000_000)).toBe(
      400_000
    );
  });

  it('reads the stored nominal otherwise', () => {
    expect(effectiveItemAmount({ amount: 500_000 }, 4_000_000)).toBe(500_000);
  });
});

describe('reconcileSalary', () => {
  it('keeps the seeded BASIC_SALARY item out of the allowance side', () => {
    // The bug: the filter excluded only 'GAJI_POKOK', so the seeded
    // 'BASIC_SALARY' item counted as an allowance and a deduction could eat the
    // base salary (PP 36/2021 Ps. 65).
    const split = reconcileSalary(
      [
        item({
          code: 'BASIC_SALARY',
          name: 'Gaji Pokok',
          classification: 'POKOK',
          amount: 3_000_000,
        }),
        item({ code: 'MEAL_ALLOWANCE', amount: 500_000 }),
      ],
      3_500_000
    );

    expect(split.baseSalary).toBe(3_500_000);
    expect(split.allowances.map((a) => a.code)).toEqual(['MEAL_ALLOWANCE']);
    expect(split.gross).toBe(4_000_000);
    // A month's wage is base + real allowances, never the allowance side alone.
    expect(split.monthlyWage).toBe(4_000_000);
  });

  it('sums the other deduction lines and the taxable base', () => {
    const split = reconcileSalary(
      [
        item({ code: 'MEAL_ALLOWANCE', amount: 500_000, isTaxable: true }),
        item({ code: 'BPJS', type: 'DEDUCTION', amount: 200_000, isTaxable: false }),
      ],
      3_500_000
    );

    expect(split.configuredDeductions).toBe(200_000);
    // Base + the taxable allowance; the deduction is not income.
    expect(split.taxableIncome).toBe(4_000_000);
  });

  it('leaves an untaxed base salary out of taxable income', () => {
    // The payslip only taxes the base when its basic component is marked
    // taxable. Counting it here anyway made the engine estimate a PPh 21 the
    // slip never charged, shrinking the allowance a deduction could spend.
    const split = reconcileSalary(
      [
        item({
          code: 'BASIC_SALARY',
          classification: 'POKOK',
          isTaxable: false,
          amount: 10_000_000,
        }),
        item({ code: 'MEAL_ALLOWANCE', amount: 1_000_000, isTaxable: true }),
      ],
      10_000_000,
      false
    );

    expect(split.baseSalary).toBe(10_000_000);
    expect(split.allowances.map((a) => a.code)).toEqual(['MEAL_ALLOWANCE']);
    expect(split.taxableIncome).toBe(1_000_000);
    // The 1/173 basis still includes the untaxed base — it is a wage, taxed or not.
    expect(split.monthlyWage).toBe(11_000_000);
  });

  it('taxes the base by default, for a structure with no basic component', () => {
    const split = reconcileSalary([item({ code: 'MEAL_ALLOWANCE', amount: 500_000 })], 3_500_000);
    expect(split.taxableIncome).toBe(4_000_000);
  });
});
