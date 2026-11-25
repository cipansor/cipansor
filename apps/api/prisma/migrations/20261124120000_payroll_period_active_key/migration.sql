-- A cancelled payroll period keeps its slips and its history, but it must not
-- hold the unit's one-period-per-month slot forever (#990).
--
-- `active_key` is `${unit_id}:${month}:${year}` for every period that is not
-- CANCELLED, and NULL once it is cancelled. PostgreSQL allows many NULLs in a
-- unique index, so the cancelled row stays while a replacement can be created
-- for the same month. The old unit/month/year unique index is replaced.
--
-- Rollback is not a plain reverse: once replacements exist there can be more
-- than one period per unit/month/year, so restoring the old unique index first
-- requires reconciling those duplicates (keep one, rewrite or archive the
-- rest). Dropping `active_key` alone would leave the data unrecoverable.

ALTER TABLE "payroll_periods" ADD COLUMN "active_key" TEXT;

UPDATE "payroll_periods"
SET "active_key" = "unit_id" || ':' || "month" || ':' || "year"
WHERE "status" <> 'CANCELLED';

DROP INDEX IF EXISTS "payroll_periods_unit_id_month_year_key";
DROP INDEX IF EXISTS "payroll_periods_unit_id_idx";
CREATE UNIQUE INDEX "payroll_periods_active_key_key" ON "payroll_periods"("active_key");
CREATE INDEX "payroll_periods_unit_id_month_year_idx" ON "payroll_periods"("unit_id", "month", "year");
