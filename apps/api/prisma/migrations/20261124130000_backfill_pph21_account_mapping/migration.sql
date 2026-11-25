-- PPh 21 payable is now resolved only through ACCOUNT_MAPPING_TAX_PAYABLE.
-- Before this change the payroll journal could fall back to a code/name lookup;
-- without a mapping, units that relied on that fallback would start refusing to
-- pay a taxed period. Backfill the explicit mapping where the old lookup had
-- exactly one unambiguous candidate.
--
-- Only one candidate per unit is accepted. If a unit has two or more active
-- liability accounts mentioning PPh 21 / Pasal 21, the migration leaves the
-- mapping empty and the operator must choose in Laporan Keuangan →
-- Pengaturan; guessing there would credit the wrong account.
--
-- ROLLBACK: delete the rows this migration created (identified by `source`):
--   DELETE FROM "settings"
--    WHERE "key" = 'ACCOUNT_MAPPING_TAX_PAYABLE'
--      AND "value"->>'source' = 'backfill-20261124';
-- An operator who later saves the mapping replaces the whole JSON value, so
-- their choice is not removed by that rollback.

INSERT INTO "settings" ("id", "unit_id", "key", "value", "created_at", "updated_at")
SELECT
  gen_random_uuid()::text,
  candidate."unit_id",
  'ACCOUNT_MAPPING_TAX_PAYABLE',
  jsonb_build_object(
    'accountId', candidate."account_id",
    'source', 'backfill-20261124'
  ),
  now(),
  now()
FROM (
  SELECT
    u."id" AS "unit_id",
    a."id" AS "account_id",
    count(*) OVER (PARTITION BY u."id") AS "matches"
  FROM "units" u
  JOIN "account_codes" a
    ON (a."unit_id" = u."id" OR a."unit_id" IS NULL)
  WHERE a."is_active" = true
    AND a."type" = 'LIABILITY'
    AND (a."name" ~* 'pph[[:space:]]*21' OR a."name" ~* 'pasal[[:space:]]*21')
) candidate
WHERE candidate."matches" = 1
  AND NOT EXISTS (
    SELECT 1
    FROM "settings" s
    WHERE s."unit_id" = candidate."unit_id"
      AND s."key" = 'ACCOUNT_MAPPING_TAX_PAYABLE'
  )
ON CONFLICT ("unit_id", "key") DO NOTHING;
