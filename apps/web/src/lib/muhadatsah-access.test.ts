import { describe, expect, it } from "vitest";
import { muhadatsahAccessOf } from "./muhadatsah-access";

const dengan = (code: string) => ({
  role: "STUDENT",
  userRoles: [{ isPrimary: true, role: { code } }],
});

describe("muhadatsahAccessOf", () => {
  it("guru menjadwalkan dan menilai, tetapi tidak menghapus", () => {
    for (const code of ["SMPIT_GURU", "SDIT_KEPALA_SEKOLAH", "MUSYRIF"]) {
      expect(muhadatsahAccessOf(dengan(code))).toEqual({
        canWrite: true,
        canDelete: false,
      });
    }
  });

  it("admin unit dan super admin menghapus", () => {
    for (const code of ["SMPIT_ADMIN", "YAYASAN_KETUA", "SUPER_ADMIN"]) {
      expect(muhadatsahAccessOf(dengan(code))).toEqual({
        canWrite: true,
        canDelete: true,
      });
    }
  });

  it("santri, wali, dan staf hanya membaca", () => {
    for (const code of ["SDIT_SISWA", "SDIT_ORANG_TUA", "SMPIT_TATA_USAHA"]) {
      expect(muhadatsahAccessOf(dengan(code))).toEqual({
        canWrite: false,
        canDelete: false,
      });
    }
    expect(muhadatsahAccessOf(null)).toEqual({
      canWrite: false,
      canDelete: false,
    });
  });
});
