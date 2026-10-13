/**
 * PPh 21 and salary-item arithmetic shared by the payslip generator and the
 * attendance-deduction engine.
 *
 * Both must agree on what a slip actually deducts. They used to disagree: the
 * generator computed percentage items from the base salary and added PPh 21,
 * while the deduction engine read the stored nominal and ignored tax — so its
 * "allowance left after deductions" was larger than the real one, and an
 * attendance deduction could still push net pay below the basic salary.
 */

// PTKP 2024 (Penghasilan Tidak Kena Pajak)
const PTKP: Record<string, number> = {
  'TK/0': 54000000,
  'TK/1': 58500000,
  'TK/2': 63000000,
  'TK/3': 67500000,
  'K/0': 58500000,
  'K/1': 63000000,
  'K/2': 67500000,
  'K/3': 72000000,
  'K/I/0': 112500000,
  'K/I/1': 117000000,
  'K/I/2': 121500000,
  'K/I/3': 126000000,
};

// Tarif progresif PPh 21 (2024)
const TAX_BRACKETS = [
  { limit: 60000000, rate: 0.05 },
  { limit: 250000000, rate: 0.15 },
  { limit: 500000000, rate: 0.25 },
  { limit: 5000000000, rate: 0.3 },
  { limit: Infinity, rate: 0.35 },
];

function calculateAnnualTax(annualTaxableIncome: number): number {
  if (annualTaxableIncome <= 0) return 0;

  let tax = 0;
  let remaining = annualTaxableIncome;
  let previousLimit = 0;

  for (const bracket of TAX_BRACKETS) {
    const bracketAmount = Math.min(remaining, bracket.limit - previousLimit);
    if (bracketAmount <= 0) break;

    tax += bracketAmount * bracket.rate;
    remaining -= bracketAmount;
    previousLimit = bracket.limit;
  }

  return tax;
}

export function calculateMonthlyPph21(
  monthlyGrossIncome: number,
  taxStatus: string = 'TK/0',
  hasNpwp: boolean = true
): number {
  const ptkp = PTKP[taxStatus] || PTKP['TK/0'];
  const annualGross = monthlyGrossIncome * 12;

  // Biaya jabatan (5% max 6jt/tahun)
  const biayaJabatan = Math.min(annualGross * 0.05, 6000000);
  const annualNet = annualGross - biayaJabatan;
  const pkp = Math.max(0, annualNet - ptkp);

  let annualTax = calculateAnnualTax(pkp);
  if (!hasNpwp) annualTax *= 1.2;

  return Math.round(annualTax / 12);
}

/** A salary item's real rupiah amount: a percentage is taken from the base salary. */
export function effectiveItemAmount(
  item: {
    amount: unknown;
    isPercentage?: boolean | null;
    rate?: unknown;
  },
  baseSalary: number
): number {
  if (item.isPercentage && item.rate !== null && item.rate !== undefined) {
    return baseSalary * Number(item.rate);
  }
  return Number(item.amount);
}

/** The shape of an `EmployeeSalaryItem` the reconciliation reads. */
export interface SalaryItemLike {
  amount: unknown;
  isPercentage?: boolean | null;
  rate?: unknown;
  component: {
    code: string;
    name: string;
    type: string;
    classification: string;
    isTaxable: boolean;
  };
}

export interface ReconciledSalary {
  baseSalary: number;
  allowances: { code: string; name: string; amount: number; classification: string }[];
  /** Base salary + non-basic earning items — the 1/173 overtime basis. */
  monthlyWage: number;
  /** Deduction lines already on the structure (BPJS, loans, …). */
  configuredDeductions: number;
  taxableIncome: number;
  gross: number;
}

/**
 * Basic salary is any earning classified POKOK, or — for rows that predate the
 * classification — the component literally named GAJI_POKOK or BASIC_SALARY.
 * Matching only 'GAJI_POKOK' let the seeded BASIC_SALARY item count as an
 * allowance, so a deduction could eat the base salary.
 */
export function isBasicSalaryComponent(c: { code: string; classification: string }): boolean {
  return c.classification === 'POKOK' || c.code === 'GAJI_POKOK' || c.code === 'BASIC_SALARY';
}

/**
 * Split a salary structure the way the payslip charges it: base salary, the
 * allowance side (the ceiling for attendance deductions), the other deduction
 * lines, and the taxable base. Both the generator and the deduction engine read
 * this, so the cap they agree on describes the same slip.
 *
 * `baseIsTaxable` mirrors the payslip's own rule: the generator only adds the
 * base salary to taxable income when it finds an active basic component marked
 * taxable. Defaulting it to `true` here taxed a base the slip never taxed, so
 * the engine over-estimated PPh 21 and shrank the allowance an attendance
 * deduction could spend.
 */
export function reconcileSalary(
  items: SalaryItemLike[],
  baseSalary: number,
  baseIsTaxable = true
): ReconciledSalary {
  const earningItems = items.filter((i) => i.component.type === 'EARNING');
  const allowances = earningItems
    .filter((i) => !isBasicSalaryComponent(i.component))
    .map((i) => ({
      code: i.component.code,
      name: i.component.name,
      amount: effectiveItemAmount(i, baseSalary),
      classification: i.component.classification,
    }));
  const monthlyWage = allowances.reduce((s, a) => s + a.amount, 0) + baseSalary;
  const configuredDeductions = items
    .filter((i) => i.component.type === 'DEDUCTION')
    .reduce((s, i) => s + effectiveItemAmount(i, baseSalary), 0);
  const taxableIncome =
    (baseIsTaxable ? baseSalary : 0) +
    earningItems
      .filter((i) => !isBasicSalaryComponent(i.component) && i.component.isTaxable)
      .reduce((s, i) => s + effectiveItemAmount(i, baseSalary), 0);

  return {
    baseSalary,
    allowances,
    monthlyWage,
    configuredDeductions,
    taxableIncome,
    gross: baseSalary + allowances.reduce((s, a) => s + a.amount, 0),
  };
}
