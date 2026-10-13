import { describe, it, expect } from 'vitest';
import {
  evaluateRule,
  evaluateFormula,
  applyDeductionCap,
  allowanceCapFor,
  deductionCapFor,
  guardCapFor,
  pickGuard,
  effectiveRules,
  hasLegalBasis,
  DEFAULT_GUARD,
} from '../attendance-deduction.service';

const ctx = {
  baseSalary: 3_000_000,
  allowances: [
    { code: 'TUNJ_JABATAN', name: 'Tunjangan Jabatan', amount: 500_000, classification: 'TETAP' },
    {
      code: 'TUNJ_TRANSPORT',
      name: 'Tunjangan Transport',
      amount: 300_000,
      classification: 'TIDAK_TETAP',
    },
  ],
  workDays: 22,
  hoursPerDay: 7,
  // Base + allowances; the 1/173 overtime rate reads this, not the allowance
  // side alone (PP 35/2021 Ps. 32).
  monthlyWage: 3_800_000,
};

const zeroCounts = {
  lateMinutes: 0,
  lateDays: 0,
  absentDays: 0,
  presentDays: 0,
  earlyLeaveDays: 0,
  overtimeMinutes: 0,
};

function rule(overrides: Record<string, unknown> = {}) {
  return {
    code: 'POTONGAN_TELAT',
    kind: 'DEDUCTION',
    trigger: 'LATE',
    basis: 'TUNJ_JABATAN',
    mode: 'PENGALI',
    rate: 0.01,
    unit: 'PER_KEJADIAN',
    tiersJson: null,
    formulaExpr: null,
    capPerDay: null,
    capPerMonth: null,
    rounding: 'NONE',
    legalBasisDoc: null,
    isActive: true,
    ...overrides,
  } as never;
}

describe('evaluateFormula', () => {
  it('evaluates arithmetic with the supplied variables', () => {
    expect(
      evaluateFormula('count * basis / workDays', { count: 3, basis: 1000, workDays: 22 })
    ).toBeCloseTo(136.36, 1);
  });

  it('honours parentheses and precedence', () => {
    expect(evaluateFormula('(2 + 3) * 4', {})).toBe(20);
  });

  it('refuses an unknown variable rather than guessing', () => {
    expect(() => evaluateFormula('count * missing', { count: 1 })).toThrow(/tidak dikenal/i);
  });

  it('does not execute arbitrary code', () => {
    expect(() => evaluateFormula('process.exit(1)', {})).toThrow(/tidak dikenal/i);
  });
});

describe('evaluateRule', () => {
  it('produces nothing when the trigger never happened', () => {
    expect(evaluateRule(rule(), ctx, zeroCounts)).toBeNull();
  });

  it('refuses to use the basic salary as a deduction basis', () => {
    expect(() =>
      evaluateRule(rule({ basis: 'GAPOK' }), ctx, { ...zeroCounts, lateDays: 1 })
    ).toThrow(/gaji pokok/i);
  });

  it('deducts a percentage of the named allowance', () => {
    const line = evaluateRule(rule(), ctx, { ...zeroCounts, lateDays: 4 });
    expect(line?.amount).toBeCloseTo(500_000 * 0.01 * 4, 5);
  });

  it('computes pro-rata against the allowance total, never the pokok', () => {
    const line = evaluateRule(
      rule({ mode: 'PRORATA', trigger: 'ABSENT', basis: 'TUNJANGAN' }),
      ctx,
      { ...zeroCounts, absentDays: 2 }
    );
    // 800,000 allowances × 2/22 — the 3,000,000 pokok is not in the base.
    expect(line?.amount).toBeCloseTo((800_000 * 2) / 22, 5);
  });

  it('applies the tier that matches the count', () => {
    const tiers = {
      1: { from: 1, to: 3, rate: 20_000 },
      2: { from: 4, to: null, rate: 50_000 },
    };
    const line = evaluateRule(rule({ mode: 'BERTINGKAT', tiersJson: Object.values(tiers) }), ctx, {
      ...zeroCounts,
      lateDays: 5,
    });
    expect(line?.amount).toBe(5 * 50_000);
  });

  it('caps a per-day deduction at capPerMonth', () => {
    const line = evaluateRule(rule({ rate: 100_000, capPerMonth: 150_000 }), ctx, {
      ...zeroCounts,
      lateDays: 5,
    });
    expect(line?.amount).toBe(150_000);
  });

  it('evaluates a formula rule', () => {
    const line = evaluateRule(rule({ mode: 'FORMULA', formulaExpr: 'basis * 0.05 * count' }), ctx, {
      ...zeroCounts,
      lateDays: 2,
    });
    expect(line?.amount).toBeCloseTo(500_000 * 0.05 * 2, 5);
  });

  it('prices an overtime hour at 1/173 of a month’s wage, not of the allowances', () => {
    // PP 35/2021 Ps. 32: the base salary is part of "upah sebulan". Using only
    // the allowance side (800k) paid 800000/173 instead of 3800000/173.
    const line = evaluateRule(
      rule({ kind: 'EARNING', trigger: 'OVERTIME', basis: 'UPAH_SEJAM', mode: 'PENGALI', rate: 1 }),
      ctx,
      { ...zeroCounts, overtimeMinutes: 1 }
    );
    expect(line?.amount).toBeCloseTo(3_800_000 / 173, 2);
    expect(line?.amount).not.toBeCloseTo(800_000 / 173, 2);
  });

  it('returns an EARNING line for an overtime bonus', () => {
    const line = evaluateRule(
      rule({
        kind: 'EARNING',
        trigger: 'OVERTIME',
        mode: 'NOMINAL',
        rate: 10_000,
        unit: 'PER_MENIT',
      }),
      ctx,
      { ...zeroCounts, overtimeMinutes: 90 }
    );
    expect(line?.kind).toBe('EARNING');
    expect(line?.amount).toBe(900_000);
  });
});

/**
 * The invariant the whole engine exists to keep: attendance deductions are
 * taken from the allowance side, so a payslip's net never falls below the
 * basic salary. A multiplier or a stack of rules could produce a total larger
 * than the allowances — `applyDeductionCap` is what stops it.
 */
describe('deduction cap keeps the basic salary intact', () => {
  it('caps a multiplier that would exceed the allowances', () => {
    // 800k allowances, rate 2 → 1.6M raw, more than the allowance side.
    const raw = evaluateRule(rule({ basis: 'TETAP', mode: 'PENGALI', rate: 2 }), ctx, {
      ...zeroCounts,
      lateDays: 1,
    });
    expect(raw?.amount).toBe(1_600_000);

    const allowanceCap = ctx.allowances.reduce((s, a) => s + a.amount, 0);
    const gross = ctx.baseSalary + allowanceCap;
    const cap = deductionCapFor(gross, allowanceCap, null);
    const capped = applyDeductionCap([raw!], cap);

    expect(capped.total).toBe(allowanceCap);
    expect(capped.capped).toBe(800_000);
    // Net can never dip below the basic salary.
    expect(gross - capped.total).toBeGreaterThanOrEqual(ctx.baseSalary);
  });

  it('trims the last line when several stack past the cap', () => {
    const first = evaluateRule(
      rule({ code: 'A', basis: 'TUNJ_JABATAN', mode: 'NOMINAL', rate: 400_000 }),
      ctx,
      { ...zeroCounts, lateDays: 1 }
    )!;
    const second = evaluateRule(
      rule({ code: 'B', basis: 'TUNJ_TRANSPORT', mode: 'NOMINAL', rate: 400_000 }),
      ctx,
      { ...zeroCounts, lateDays: 1 }
    )!;
    const capped = applyDeductionCap([first, second], 500_000);
    expect(capped.total).toBe(500_000);
    expect(capped.lines.map((l) => l.code)).toEqual(['A', 'B']);
    expect(capped.lines[0].amount).toBe(400_000);
    // The last line was trimmed to what the cap still allowed.
    expect(capped.lines[1].amount).toBe(100_000);
  });

  it('leaves the deduction untouched when it fits under the cap', () => {
    const line = evaluateRule(
      rule({ basis: 'TUNJ_JABATAN', mode: 'NOMINAL', rate: 100_000 }),
      ctx,
      { ...zeroCounts, lateDays: 1 }
    )!;
    const capped = applyDeductionCap([line], 500_000);
    expect(capped.capped).toBe(0);
    expect(capped.total).toBe(100_000);
  });

  it('refuses a rule whose basis resolves to the basic salary', () => {
    expect(() =>
      evaluateRule(rule({ basis: 'GAPOK' }), ctx, { ...zeroCounts, lateDays: 1 })
    ).toThrow(/gaji pokok/i);
  });

  it('spends only what the slip’s other deductions and PPh 21 leave of the allowance', () => {
    // 800k allowances, 200k BPJS, 50k PPh 21 → 550k is all the engine may use.
    expect(allowanceCapFor(800_000, 200_000, 50_000)).toBe(550_000);
    // Never negative, even when the other deductions already exceed the side.
    expect(allowanceCapFor(800_000, 900_000, 0)).toBe(0);
  });
});

describe('guard limits', () => {
  it('keeps the basic share at or above the configured minimum', () => {
    const gross = 4_000_000; // 3M basic + 1M allowances
    const cap = guardCapFor(gross, {
      maxDeductionPercent: 100,
      minBasicSharePercent: 75,
      mustStayAboveUmk: false,
      umkNominal: null,
    });
    // 75% of gross must remain, so at most 1M may be deducted.
    expect(cap).toBe(1_000_000);
  });

  it('honours maxDeductionPercent when it is the tighter bound', () => {
    const cap = guardCapFor(4_000_000, {
      maxDeductionPercent: 20,
      minBasicSharePercent: 75,
      mustStayAboveUmk: false,
      umkNominal: null,
    });
    expect(cap).toBe(800_000);
  });

  it('keeps the net above UMK when configured', () => {
    const cap = guardCapFor(3_000_000, {
      maxDeductionPercent: 100,
      minBasicSharePercent: 0,
      mustStayAboveUmk: true,
      umkNominal: 2_500_000,
    });
    expect(cap).toBe(500_000);
  });
});

describe('the legal ceiling (PP 36/2021 Ps. 65)', () => {
  it('holds deductions to 50% of the payment even when a row says 100%', () => {
    // A row saved before the schema refused it. 4M gross: 50% is 2M, not 4M.
    const cap = guardCapFor(4_000_000, {
      maxDeductionPercent: 100,
      minBasicSharePercent: 0,
      mustStayAboveUmk: false,
      umkNominal: null,
    });
    expect(cap).toBe(2_000_000);
  });

  it('gives a unit with no guard row the legal ceiling, not no ceiling', () => {
    expect(pickGuard([], 'unit-1')).toEqual(DEFAULT_GUARD);
    expect(guardCapFor(4_000_000, pickGuard([], 'unit-1'))).toBe(2_000_000);
  });
});

describe('pickGuard', () => {
  const row = (unitId: string | null, maxDeductionPercent: number) => ({
    unitId,
    maxDeductionPercent,
    minBasicSharePercent: 0,
    mustStayAboveUmk: false,
    umkNominal: null,
  });

  it("prefers the unit's own row over the yayasan-wide one, in either order", () => {
    // One unordered query used to return whichever row the database found first.
    expect(pickGuard([row(null, 40), row('unit-1', 20)], 'unit-1').maxDeductionPercent).toBe(20);
    expect(pickGuard([row('unit-1', 20), row(null, 40)], 'unit-1').maxDeductionPercent).toBe(20);
  });

  it('falls back to the yayasan-wide row', () => {
    expect(pickGuard([row(null, 40)], 'unit-1').maxDeductionPercent).toBe(40);
  });
});

describe('effectiveRules', () => {
  it('lets a unit rule replace the yayasan rule with the same code', () => {
    // Before, both applied and a late arrival was fined twice.
    const rules = [
      { unitId: null, code: 'TELAT' },
      { unitId: 'unit-1', code: 'TELAT' },
      { unitId: null, code: 'ALPA' },
    ];
    expect(effectiveRules(rules)).toEqual([
      { unitId: 'unit-1', code: 'TELAT' },
      { unitId: null, code: 'ALPA' },
    ]);
  });
});

describe('hasLegalBasis', () => {
  it('requires a named document, not whitespace', () => {
    expect(hasLegalBasis({ legalBasisDoc: 'Peraturan Kepegawaian Yayasan Ps. 12' })).toBe(true);
    expect(hasLegalBasis({ legalBasisDoc: '   ' })).toBe(false);
    expect(hasLegalBasis({ legalBasisDoc: null })).toBe(false);
  });
});
