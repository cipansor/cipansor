import { getEffectiveRole, type RbacUser } from "@/lib/rbac";

/**
 * Apa yang boleh dilakukan akun ini di layar Muhadatsah.
 *
 * Sumbernya `authorize()` di
 * `apps/api/src/modules/muhadatsah/muhadatsah.routes.ts`: menghapus hanya
 * Super Admin dan admin unit; menjadwalkan, menilai, dan membatalkan juga guru.
 * Tombol yang tampil adalah tombol yang tidak akan dijawab 403.
 */
export function muhadatsahAccessOf(user: RbacUser | null | undefined) {
  const role = getEffectiveRole(user);
  return {
    canWrite:
      role === "SUPER_ADMIN" || role === "UNIT_ADMIN" || role === "TEACHER",
    canDelete: role === "SUPER_ADMIN" || role === "UNIT_ADMIN",
  };
}
