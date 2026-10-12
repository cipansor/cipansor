import { describe, it, expect } from "vitest";
import { dashboardUnitId } from "./use-staff-dashboard";

/**
 * The staff dashboard counts santri, attendance and permits. The pesantren's
 * staff belong to the Pesantren unit, which holds none of the schools' santri:
 * pinned to it, TU Pesantren's dashboard read zero santri.
 */

const as = (code: string, unitId = "unit-home") => ({
  unitId,
  userRoles: [{ isPrimary: true, role: { code } }],
});

describe("dashboardUnitId", () => {
  it("is not pinned for the pesantren's staff and the cross-unit services", () => {
    for (const code of [
      "PESANTREN_TATA_USAHA",
      "PESANTREN_PENGASUH",
      "MUSYRIF",
      "PERAWAT",
      "PUSTAKAWAN",
    ]) {
      expect(dashboardUnitId(as(code, "unit-pesantren"))).toBeUndefined();
    }
  });

  it("stays the home unit for a school's staff", () => {
    expect(dashboardUnitId(as("SMPIT_TATA_USAHA", "unit-smp"))).toBe(
      "unit-smp",
    );
    expect(dashboardUnitId(as("BUSINESS_STAFF", "unit-smp"))).toBe("unit-smp");
  });

  it("is undefined with no user", () => {
    expect(dashboardUnitId(undefined)).toBeUndefined();
  });
});
