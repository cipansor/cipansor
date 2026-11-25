import { describe, it, expect } from "vitest";
import {
  criterionValueLabel,
  formatCriterionScore,
  incomeRangeLabel,
} from "./income-range";

/**
 * What a criterion's value column says (#1003, R11.5).
 *
 * The scorer reports a household income as an enum band, and an unreadable
 * criterion as a reason. Both must reach the screen as Indonesian words: a
 * treasurer cannot act on `RANGE_1JT_2JT`, and a bare `0` would read as a
 * judgement the officer never made.
 */
describe("criterionValueLabel", () => {
  it("prints an income band in rupiah", () => {
    expect(criterionValueLabel("RANGE_1JT_2JT")).toBe(
      "Rp1.000.000–Rp2.000.000",
    );
    expect(criterionValueLabel("KURANG_500K")).toBe("Kurang dari Rp500.000");
  });

  it("says why a criterion could not be read, instead of a zero", () => {
    expect(criterionValueLabel("MANUAL_REQUIRED")).toBe("Perlu dinilai manual");
    expect(criterionValueLabel("UNKNOWN")).toBe("Tidak diketahui");
    expect(criterionValueLabel("NO_DATA")).toBe("Data belum ada");
  });

  it("passes a plain figure through unchanged", () => {
    expect(criterionValueLabel("10")).toBe("10");
    expect(criterionValueLabel("85.5")).toBe("85.5");
  });

  it("shows a dash for a missing value", () => {
    expect(criterionValueLabel(null)).toBe("-");
    expect(criterionValueLabel("")).toBe("-");
  });
});

describe("incomeRangeLabel", () => {
  it("returns null for a value that is not a band", () => {
    expect(incomeRangeLabel("10")).toBeNull();
    expect(incomeRangeLabel(null)).toBeNull();
  });
});

describe("formatCriterionScore", () => {
  it("prints one decimal place", () => {
    expect(formatCriterionScore(95)).toBe("95.0");
    expect(formatCriterionScore(66.666)).toBe("66.7");
  });

  it("prints a dash for an excluded criterion", () => {
    expect(formatCriterionScore(null)).toBe("-");
    expect(formatCriterionScore(Number.NaN)).toBe("-");
  });
});
