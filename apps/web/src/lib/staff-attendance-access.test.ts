import { describe, expect, it } from "vitest";
import { canManageStaffAttendance } from "./staff-attendance-access";

const as = (code: string) => ({
  userRoles: [{ isPrimary: true, role: { code } }],
});

describe("canManageStaffAttendance", () => {
  it("lets the super admin and every unit admin run it", () => {
    for (const code of [
      "SUPER_ADMIN",
      "TKQ_ADMIN",
      "SMPIT_ADMIN",
      "SMAQ_ADMIN",
    ])
      expect(canManageStaffAttendance(as(code)), code).toBe(true);
  });

  it("refuses the yayasan organs, though they share the admin pages' bucket", () => {
    for (const code of [
      "YAYASAN_PENGAWAS",
      "YAYASAN_BENDAHARA",
      "YAYASAN_KETUA",
    ])
      expect(canManageStaffAttendance(as(code)), code).toBe(false);
  });

  it("refuses a head of school and an employee, and a user not loaded yet", () => {
    expect(canManageStaffAttendance(as("SMPIT_KEPALA_SEKOLAH"))).toBe(false);
    expect(canManageStaffAttendance(as("SMPIT_TATA_USAHA"))).toBe(false);
    expect(canManageStaffAttendance(null)).toBe(false);
  });
});
