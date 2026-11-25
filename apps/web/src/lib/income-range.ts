/**
 * Indonesian labels for the `IncomeRange` bands a scholarship score reports.
 *
 * The API answers a household income as the enum code (`RANGE_1JT_2JT`), which
 * means nothing to a treasurer reading a score. The codes are repeated here as
 * plain strings because the web app must not import `@prisma/client`; they match
 * `enum IncomeRange` in `apps/api/prisma/schema.prisma` exactly.
 */
export const INCOME_RANGE_LABELS: Readonly<Record<string, string>> = {
  KURANG_500K: "Kurang dari Rp500.000",
  RANGE_500K_1JT: "Rp500.000–Rp1.000.000",
  RANGE_1JT_2JT: "Rp1.000.000–Rp2.000.000",
  RANGE_2JT_5JT: "Rp2.000.000–Rp5.000.000",
  RANGE_5JT_10JT: "Rp5.000.000–Rp10.000.000",
  RANGE_10JT_20JT: "Rp10.000.000–Rp20.000.000",
  LEBIH_20JT: "Lebih dari Rp20.000.000",
  TIDAK_BERPENGHASILAN: "Tidak berpenghasilan",
};

/** The band's Indonesian label, or `null` when the value is not a band. */
export function incomeRangeLabel(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  return INCOME_RANGE_LABELS[value] ?? null;
}

/**
 * What the value column says for one criterion.
 *
 * A criterion the machine cannot read carries the reason rather than a number:
 * an interview is `MANUAL_REQUIRED`, an unrecorded household is `UNKNOWN`, and a
 * santri with no tahfidz record or no grades is `NO_DATA`. Saying so is the
 * point — a `0` would read as a judgement the officer never made (R11.5).
 */
export function criterionValueLabel(value: string | null | undefined): string {
  if (!value) return "-";
  if (value === "MANUAL_REQUIRED") return "Perlu dinilai manual";
  if (value === "UNKNOWN") return "Tidak diketahui";
  if (value === "NO_DATA") return "Data belum ada";
  return incomeRangeLabel(value) ?? value;
}

/** A score to one decimal place, or "-" when the criterion was excluded. */
export function formatCriterionScore(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score)) return "-";
  return score.toFixed(1);
}
