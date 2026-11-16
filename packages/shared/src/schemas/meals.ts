import { z } from "zod";
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

/**
 * The menu contract, read by both the API and the web (#1081).
 *
 * The two sides disagreed on almost every field: the Edit form sent `name`,
 * `dayType`, `description`, `nutritionInfo` and `isActive`, none of which is a
 * column of `MealMenu`, so `PUT /meals/menus/:id` answered 500 with "Unknown
 * argument". The contract is the columns the model actually has — nothing else
 * — so a form that follows it cannot send a field Prisma will reject.
 *
 * `mealType` mirrors the Prisma `MealType` enum; a guard pins the two lists.
 */
export const MEAL_TYPE_VALUES = [
  "BREAKFAST",
  "LUNCH",
  "DINNER",
  "SNACK",
] as const;
export type MealTypeCode = (typeof MEAL_TYPE_VALUES)[number];

/** A calendar day, "yyyy-MM-dd", as the date picker holds it. Not a datetime. */
export const menuDay = z.iso.date("Tanggal tidak valid (yyyy-MM-dd)");

const optionalText = (max: number) => z.string().trim().max(max).optional();

const menuFields = {
  mealType: z.enum(MEAL_TYPE_VALUES, "Waktu makan wajib dipilih"),
  date: menuDay,
  mainDish: z.string().trim().min(1, "Hidangan utama wajib diisi").max(200),
  sideDish: optionalText(200),
  vegetable: optionalText(200),
  soup: optionalText(200),
  dessert: optionalText(200),
  drink: optionalText(200),
  calories: z.number().int().positive().optional(),
  notes: optionalText(500),
};

export const createMenuSchema = z
  .object({
    /** The unit the menu belongs to; a unit admin writes to their own whatever it says. */
    unitId: z.string().uuid("Unit tidak valid"),
    ...menuFields,
  })
  .strict();

export type CreateMenuInput = z.input<typeof createMenuSchema>;

/**
 * What may change after creation. `unitId` is optional: moving a menu to
 * another unit is a write the service scopes the same way creation is, and a
 * unit admin can only ever move it within their own unit. Omitting a field
 * leaves it unchanged (no defaults to overwrite it).
 */
export const updateMenuSchema = z
  .object({
    unitId: z.string().uuid("Unit tidak valid").optional(),
    ...menuFields,
  })
  .partial()
  .strict();

export type UpdateMenuInput = z.input<typeof updateMenuSchema>;

export const bulkCreateMenusSchema = z
  .object({
    menus: z.array(createMenuSchema).min(1).max(50),
  })
  .strict();

export type BulkCreateMenusInput = z.input<typeof bulkCreateMenusSchema>;

/** A menu as the API returns it — the columns of `MealMenu`, plus its unit. */
export interface MealMenuDTO {
  id: string;
  unitId: string;
  date: string;
  mealType: MealTypeCode;
  mainDish: string;
  sideDish?: string | null;
  vegetable?: string | null;
  soup?: string | null;
  dessert?: string | null;
  drink?: string | null;
  notes?: string | null;
  calories?: number | null;
  unit?: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
}
