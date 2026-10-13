-- Absensi pegawai: selfie + geotag, shift/rotasi, kebijakan, dan potongan
-- dari sisi tunjangan.
--
-- Guru dulu ditulis lewat `staff_attendance.teacher_id`; sejak ini kehadiran
-- satu orang adalah satu baris `staff_id`, dan guru ditautkan lewat
-- `teachers.staff_id`. Baris absensi guru lama dipindahkan ke identitas Staff
-- yang dibuat di sini — bukan dihapus, agar riwayat kehadiran tidak hilang.
--
-- Satu transaksi: `migrate deploy` menjalankan berkas ini pernyataan demi
-- pernyataan, jadi tanpa BEGIN/COMMIT kegagalan di tengah meninggalkan baris
-- Staff yang sudah dibuat tetapi absensinya belum dipindahkan. `ADD VALUE` di
-- dalam transaksi sah sejak PostgreSQL 12, selama nilai barunya tidak dipakai
-- di transaksi yang sama — dan di sini tidak.

BEGIN;

-- AlterEnum
ALTER TYPE "StaffAttendanceStatus" ADD VALUE 'HOLIDAY';

-- DropForeignKey
ALTER TABLE "staff_attendance" DROP CONSTRAINT "staff_attendance_teacher_id_fkey";

-- DropIndex
DROP INDEX "staff_attendance_teacher_id_idx";

-- DropIndex
DROP INDEX "staff_attendance_staff_id_teacher_id_date_key";

-- AlterTable
ALTER TABLE "teachers" ADD COLUMN     "staff_id" TEXT;

-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "employment_status" "EmploymentStatus";

-- Backfill: give every teacher a Staff identity (reusing the teacher's id where
-- the person has none), link it back from teachers, then move the teacher-only
-- attendance rows onto it. A date collision is resolved by keeping the existing
-- Staff row for that day; a teacher-only row with no Staff identity left is the
-- only thing dropped, immediately before the NOT NULL below.
INSERT INTO "staff" ("id", "user_id", "unit_id", "nip", "position", "join_date", "employment_status", "created_at", "updated_at")
SELECT
    t."id",
    t."user_id",
    t."unit_id",
    t."nip",
    COALESCE(NULLIF(t."specialization", ''), 'Guru'),
    t."join_date",
    t."employment_status",
    t."created_at",
    t."updated_at"
FROM "teachers" t
WHERE NOT EXISTS (SELECT 1 FROM "staff" s WHERE s."user_id" = t."user_id")
  AND NOT EXISTS (SELECT 1 FROM "staff" s WHERE s."id" = t."id");

UPDATE "teachers" t
SET "staff_id" = s."id"
FROM "staff" s
WHERE s."user_id" = t."user_id" AND t."staff_id" IS NULL;

UPDATE "staff_attendance" a
SET "staff_id" = t."staff_id"
FROM "teachers" t
WHERE a."staff_id" IS NULL
  AND a."teacher_id" = t."id"
  AND t."staff_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "staff_attendance" b
    WHERE b."staff_id" = t."staff_id" AND b."date" = a."date"
  );

DELETE FROM "staff_attendance" WHERE "staff_id" IS NULL;

-- AlterTable
ALTER TABLE "staff_attendance" DROP COLUMN "teacher_id",
ADD COLUMN     "late_minutes" INTEGER,
ADD COLUMN     "recorded_by_id" TEXT,
ADD COLUMN     "shift_id" TEXT,
ADD COLUMN     "leave_request_id" TEXT,
ADD COLUMN     "leave_previous_status" "StaffAttendanceStatus",
ADD COLUMN     "leave_previous_notes" TEXT,
ALTER COLUMN "staff_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "salary_components" ADD COLUMN     "classification" TEXT NOT NULL DEFAULT 'TIDAK_TETAP';

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "attendance_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'CHECK_IN',
    "photo_ref" TEXT,
    "photo_source" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracy_meters" DOUBLE PRECISION,
    "site_id" TEXT,
    "distance_meters" INTEGER,
    "is_within_radius" BOOLEAN,
    "device_info" TEXT,
    "captured_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_sites" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT,
    "label" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "radius_meters" INTEGER NOT NULL DEFAULT 200,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_shifts" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT,
    "name" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "grace_minutes" INTEGER NOT NULL DEFAULT 15,
    "crosses_midnight" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_assignments" (
    "id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "days_of_week" INTEGER[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_rotations" (
    "id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "member_ids" TEXT[],
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "cycle_days" INTEGER NOT NULL DEFAULT 7,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shift_rotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_week_configs" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT,
    "work_days" INTEGER[],
    "hours_per_day" INTEGER NOT NULL DEFAULT 7,
    "friday_end_time" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_week_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_exemptions" (
    "id" TEXT NOT NULL,
    "role_code" TEXT,
    "staff_id" TEXT,
    "reason" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_exemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_policies" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT,
    "grace_minutes" INTEGER NOT NULL DEFAULT 15,
    "require_selfie" BOOLEAN NOT NULL DEFAULT true,
    "require_location" BOOLEAN NOT NULL DEFAULT true,
    "outside_radius_action" TEXT NOT NULL DEFAULT 'FLAG',
    "photo_retention_days" INTEGER NOT NULL DEFAULT 365,
    "record_retention_days" INTEGER NOT NULL DEFAULT 3650,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_policy_rules" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DEDUCTION',
    "trigger" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "rate" DECIMAL(14,4),
    "unit" TEXT NOT NULL DEFAULT 'PER_KEJADIAN',
    "tiers_json" JSONB,
    "formula_expr" TEXT,
    "cap_per_day" DECIMAL(14,2),
    "cap_per_month" DECIMAL(14,2),
    "rounding" TEXT NOT NULL DEFAULT 'NONE',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "legal_basis_doc" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "effective_from" DATE,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_policy_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_guard_configs" (
    "id" TEXT NOT NULL,
    "unit_id" TEXT,
    "max_deduction_percent" INTEGER NOT NULL DEFAULT 50,
    "min_basic_share_percent" INTEGER NOT NULL DEFAULT 75,
    "must_stay_above_umk" BOOLEAN NOT NULL DEFAULT true,
    "umkNominal" DECIMAL(14,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_guard_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" TEXT NOT NULL,
    "data_type" TEXT NOT NULL,
    "retention_days" INTEGER NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'DELETE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_type_configs" (
    "id" TEXT NOT NULL,
    "leave_type" "LeaveType" NOT NULL,
    "entitlement_days" INTEGER,
    "period_basis" TEXT NOT NULL DEFAULT 'CALENDAR_YEAR',
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "requires_document" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_type_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_records_site_id_idx" ON "attendance_records"("site_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_attendance_id_kind_key" ON "attendance_records"("attendance_id", "kind");

-- Satu swafoto untuk satu absen: foto yang sama tidak bisa dipakai dua kali.
CREATE UNIQUE INDEX "attendance_records_photo_ref_key" ON "attendance_records"("photo_ref");

-- CreateIndex
CREATE INDEX "attendance_sites_unit_id_idx" ON "attendance_sites"("unit_id");

-- CreateIndex
CREATE INDEX "work_shifts_unit_id_idx" ON "work_shifts"("unit_id");

-- CreateIndex
CREATE INDEX "shift_assignments_staff_id_idx" ON "shift_assignments"("staff_id");

-- CreateIndex
CREATE INDEX "shift_assignments_shift_id_idx" ON "shift_assignments"("shift_id");

-- CreateIndex
CREATE INDEX "shift_rotations_shift_id_idx" ON "shift_rotations"("shift_id");

-- CreateIndex
CREATE INDEX "work_week_configs_unit_id_idx" ON "work_week_configs"("unit_id");

-- CreateIndex
CREATE INDEX "attendance_exemptions_role_code_idx" ON "attendance_exemptions"("role_code");

-- CreateIndex
CREATE INDEX "attendance_exemptions_staff_id_idx" ON "attendance_exemptions"("staff_id");

-- CreateIndex
CREATE INDEX "attendance_policies_unit_id_idx" ON "attendance_policies"("unit_id");

-- CreateIndex
CREATE INDEX "payroll_policy_rules_trigger_idx" ON "payroll_policy_rules"("trigger");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_policy_rules_unit_id_code_key" ON "payroll_policy_rules"("unit_id", "code");

-- CreateIndex
CREATE INDEX "payroll_guard_configs_unit_id_idx" ON "payroll_guard_configs"("unit_id");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_data_type_key" ON "retention_policies"("data_type");

-- CreateIndex
CREATE UNIQUE INDEX "leave_type_configs_leave_type_key" ON "leave_type_configs"("leave_type");

-- CreateIndex
CREATE UNIQUE INDEX "teachers_staff_id_key" ON "teachers"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_attendance_staff_id_date_key" ON "staff_attendance"("staff_id", "date");

-- AddForeignKey
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "work_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "staff_attendance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "attendance_sites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_sites" ADD CONSTRAINT "attendance_sites_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_shifts" ADD CONSTRAINT "work_shifts_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "work_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift_rotations" ADD CONSTRAINT "shift_rotations_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "work_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_week_configs" ADD CONSTRAINT "work_week_configs_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: holiday imports land as drafts for review before they affect payroll
ALTER TABLE "calendar_events" ADD COLUMN "is_draft" BOOLEAN NOT NULL DEFAULT false;

-- Pimpinan Pesantren dikecualikan dari absen mandiri sebagai bawaan
-- (keputusan 2026-10-09). Barisnya biasa, jadi admin dapat menghapusnya di
-- Pengaturan Absensi → Pengecualian bila yayasan memutuskan lain.
INSERT INTO "attendance_exemptions" ("id", "role_code", "staff_id", "reason", "is_active", "created_at", "updated_at")
SELECT gen_random_uuid()::text, 'PESANTREN_PENGASUH', NULL,
       'Pimpinan Pesantren — dikecualikan bawaan (keputusan 2026-10-09)', true, now(), now()
WHERE NOT EXISTS (
    SELECT 1 FROM "attendance_exemptions" WHERE "role_code" = 'PESANTREN_PENGASUH' AND "staff_id" IS NULL
);

COMMIT;
