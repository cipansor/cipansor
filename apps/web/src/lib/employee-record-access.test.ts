import { describe, expect, it } from "vitest";
import {
  managesEmployees,
  readsEmployeeRecord,
} from "./employee-record-access";

const sebagai = (code: string, role: string, id = "viewer-1") => ({
  id,
  role,
  userRoles: [{ isPrimary: true, role: { code } }],
});

describe("readsEmployeeRecord", () => {
  it("pegawai membaca catatannya sendiri", () => {
    expect(
      readsEmployeeRecord(sebagai("SMPIT_GURU", "TEACHER", "guru-1"), "guru-1"),
    ).toBe(true);
  });

  it("rekan kerja, termasuk kepala sekolah, tidak membaca catatan rekan", () => {
    expect(
      readsEmployeeRecord(sebagai("SMPIT_GURU", "TEACHER"), "guru-7"),
    ).toBe(false);
    expect(
      readsEmployeeRecord(sebagai("SMPIT_KEPALA_SEKOLAH", "TEACHER"), "guru-7"),
    ).toBe(false);
  });

  it("admin unit, TU unit, organ, dan Super Admin memegang catatan", () => {
    for (const [code, role] of [
      ["SMPIT_ADMIN", "UNIT_ADMIN"],
      ["SMPIT_TATA_USAHA", "STAFF"],
      ["YAYASAN_KETUA", "UNIT_ADMIN"],
      ["SUPER_ADMIN", "SUPER_ADMIN"],
    ]) {
      expect(readsEmployeeRecord(sebagai(code, role), "guru-7")).toBe(true);
    }
  });

  it("tanpa sesi tidak membaca apa pun", () => {
    expect(readsEmployeeRecord(null, "guru-7")).toBe(false);
  });
});

describe("managesEmployees", () => {
  it("hanya bucket Super Admin dan admin unit yang mengubah atau menghapus", () => {
    expect(managesEmployees(sebagai("SUPER_ADMIN", "SUPER_ADMIN"))).toBe(true);
    expect(managesEmployees(sebagai("SMPIT_ADMIN", "UNIT_ADMIN"))).toBe(true);
    expect(managesEmployees(sebagai("SMPIT_TATA_USAHA", "STAFF"))).toBe(false);
    expect(managesEmployees(sebagai("SMPIT_GURU", "TEACHER"))).toBe(false);
  });
});
