import {
  ADMIN_ROLE_CODES,
  PESANTREN_EDUCATOR_ROLE_CODES,
  PESANTREN_LEADER_ROLE_CODES,
  PRINCIPAL_ROLE_CODES,
  SCHOOL_TEACHER_ROLE_CODES,
} from "../roles";

/**
 * Menu makan (dapur & konsumsi) — who may change it, and who may record a
 * santri's meal attendance.
 *
 * The write routes used to admit the legacy `UserRole.UNIT_ADMIN` bucket, which
 * expands to the yayasan organs as well as the four school admins. The organs
 * are read-only (`YAYASAN_OVERSIGHT` in `modules/roles/permissions.ts`), so the
 * Pengawas could create a menu for any unit and edit or delete another unit's —
 * a write the permission list never granted. The menu writers are therefore an
 * explicit list, the same shape as `DORMITORY_MANAGER_ROLE_CODES`.
 */
export const MEALS_MANAGER_ROLE_CODES: readonly string[] = [
  ...ADMIN_ROLE_CODES,
];

/**
 * Who records meal attendance: the menu managers plus the people who supervise
 * the santri at the table — the class teacher, the kepala sekolah, the Pimpinan
 * Pesantren and the asrama staff. The yayasan organs are again excluded; they
 * read the statistics, they do not mark a santri present.
 */
export const MEALS_ATTENDANCE_WRITER_ROLE_CODES: readonly string[] = [
  ...MEALS_MANAGER_ROLE_CODES,
  ...SCHOOL_TEACHER_ROLE_CODES,
  ...PRINCIPAL_ROLE_CODES,
  ...PESANTREN_LEADER_ROLE_CODES,
  ...PESANTREN_EDUCATOR_ROLE_CODES,
];
