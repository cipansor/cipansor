-- The pesantren's own unit (decided 2026-09-29,
-- .claude/memory/decisions/struktur-organisasi-dan-identitas.md). The Kiai
-- heads it as Pimpinan Pesantren; the ustadz, musyrif, muhafidz and Tata
-- Usaha Pesantren belong to it. With no such unit they were assigned to SMP IT,
-- which counted them as its staff and gave it a second head.
--
-- What moves: every assignment to one of those five roles; and, for a person
-- whose primary assignment is one of them, their home unit and their teacher
-- or staff record. Someone who holds one of the roles beside a school's role
-- keeps the school as home. Their santri stay in their schools: these roles
-- reach every unit's santri (`seesAllUnits`).
--
-- Nothing is deleted. A second assignment to the same role at another unit
-- would collide with the moved one, so it is switched off instead. Without a
-- yayasan row (an empty database) nothing happens; the seed makes the unit.
-- Replayed on a copy of production first.
BEGIN;

INSERT INTO "units" ("id", "foundation_id", "name", "official_name", "type", "address", "phone", "created_at", "updated_at")
SELECT gen_random_uuid()::text, f."id", 'Pesantren Cipansor', 'Pondok Pesantren Cipansor', 'PESANTREN', f."address", f."phone", now(), now()
FROM "foundations" f
WHERE NOT EXISTS (SELECT 1 FROM "units" u WHERE u."type" = 'PESANTREN' AND u."deleted_at" IS NULL)
ORDER BY f."created_at"
LIMIT 1;

CREATE TEMP TABLE "pesantren_unit" ON COMMIT DROP AS
  SELECT "id" FROM "units" WHERE "type" = 'PESANTREN' AND "deleted_at" IS NULL ORDER BY "created_at" LIMIT 1;

CREATE TEMP TABLE "pesantren_roles" ON COMMIT DROP AS
  SELECT "id" FROM "roles"
  WHERE "code" IN ('PESANTREN_PENGASUH', 'PESANTREN_TATA_USAHA', 'USTADZ', 'MUSYRIF', 'MUHAFIDZ');

-- Whose home becomes the pesantren, read before anything moves.
CREATE TEMP TABLE "pesantren_people" ON COMMIT DROP AS
  SELECT DISTINCT a."user_id" FROM "user_role_assignments" a
  WHERE a."role_id" IN (SELECT "id" FROM "pesantren_roles") AND a."is_primary" AND a."is_active"
    AND EXISTS (SELECT 1 FROM "pesantren_unit");

-- One assignment per person and role moves: the primary one, else the active
-- one, else the oldest.
WITH "ranked" AS (
  SELECT a."id",
         row_number() OVER (
           PARTITION BY a."user_id", a."role_id"
           ORDER BY a."is_primary" DESC, a."is_active" DESC, a."assigned_at"
         ) AS "n"
  FROM "user_role_assignments" a
  WHERE a."role_id" IN (SELECT "id" FROM "pesantren_roles")
    AND a."unit_id" IS DISTINCT FROM (SELECT "id" FROM "pesantren_unit")
    AND NOT EXISTS (
      SELECT 1 FROM "user_role_assignments" b
      WHERE b."user_id" = a."user_id" AND b."role_id" = a."role_id"
        AND b."unit_id" = (SELECT "id" FROM "pesantren_unit")
    )
)
UPDATE "user_role_assignments" a
SET "unit_id" = (SELECT "id" FROM "pesantren_unit"), "updated_at" = now()
FROM "ranked" r
WHERE a."id" = r."id" AND r."n" = 1 AND EXISTS (SELECT 1 FROM "pesantren_unit");

-- Any other assignment to those roles, now a duplicate, is switched off.
UPDATE "user_role_assignments" a
SET "is_active" = false, "is_primary" = false, "updated_at" = now()
WHERE a."role_id" IN (SELECT "id" FROM "pesantren_roles")
  AND a."unit_id" IS DISTINCT FROM (SELECT "id" FROM "pesantren_unit")
  AND a."is_active"
  AND EXISTS (SELECT 1 FROM "pesantren_unit");

UPDATE "users" SET "unit_id" = (SELECT "id" FROM "pesantren_unit"), "updated_at" = now()
WHERE "id" IN (SELECT "user_id" FROM "pesantren_people")
  AND "unit_id" IS DISTINCT FROM (SELECT "id" FROM "pesantren_unit");

UPDATE "teachers" SET "unit_id" = (SELECT "id" FROM "pesantren_unit"), "updated_at" = now()
WHERE "user_id" IN (SELECT "user_id" FROM "pesantren_people")
  AND "unit_id" IS DISTINCT FROM (SELECT "id" FROM "pesantren_unit");

UPDATE "staff" SET "unit_id" = (SELECT "id" FROM "pesantren_unit"), "updated_at" = now()
WHERE "user_id" IN (SELECT "user_id" FROM "pesantren_people")
  AND "unit_id" IS DISTINCT FROM (SELECT "id" FROM "pesantren_unit");

COMMIT;
