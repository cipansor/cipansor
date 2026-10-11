# migration-history-baselined

> Migrations were baselined into `0_init` (#480); `migrate diff` cannot see triggers, functions or views; CI builds its database with `db push`, so a schema change without a migration stays green; and `migrate deploy` runs a plain script statement by statement.

**Since #480 (2026-09-05)** the old 27 migration directories — which could not
be replayed from an empty database (P3006, `relation "complaints" does not
exist`) — are replaced by one baseline, `0_init`. Existing databases were
marked with `migrate resolve --applied 0_init` (it records, it does not run:
`applied_steps_count = 0`). A schema change is now: edit `schema.prisma` →
write a migration → `migrate deploy`. Never `db push` against a real database.

## `migrate diff` is blind to what Prisma does not model

It compares tables, columns, indexes, enums and foreign keys. It does **not**
see triggers, functions, views, materialized views or hand-written CHECK
constraints. The baseline generated with `migrate diff --from-empty` silently
left out `assert_yayasan_organ_exclusive` — a function and two triggers that
stop one person holding two yayasan organs at once. The diff stayed empty,
every gate stayed green, and a database built from it would have lost that
governance rule with no error. It is written into `0_init/migration.sql` by
hand now.

Check the database directly, not the diff:

```sql
SELECT count(*) FROM information_schema.views    WHERE table_schema='public';
SELECT count(*) FROM information_schema.triggers WHERE trigger_schema='public';
SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public';
SELECT count(*) FROM pg_constraint WHERE contype='c'
  AND connamespace='public'::regnamespace;
```

Stronger than counting: compare an md5 of the sorted, concatenated
`pg_get_functiondef` + `pg_get_triggerdef` between the two databases.

## CI does not notice a schema change without a migration

`ci.yml` and `e2e-tests.yml` build their database with `db push`, so a new
model in `schema.prisma` with no migration folder is **green in CI** — and
`migrate deploy` then never creates the table. In every review, compare
`git diff -- apps/api/prisma/schema.prisma` with `apps/api/prisma/migrations/`.
(A CI guard would be `prisma migrate diff --from-migrations prisma/migrations
--to-schema prisma/schema.prisma --exit-code`, which needs a shadow database —
not built yet.)

## `migrate deploy` runs a plain script statement by statement

Measured 2026-09-25 on a replay: a migration without a `DO $…$` block runs in
autocommit, one statement at a time. `CREATE TEMP TABLE … ON COMMIT DROP`
vanishes before the next statement ("relation … does not exist"), and a
failure midway leaves the data half-migrated. **Wrap a data migration in an
explicit `BEGIN;` … `COMMIT;`** (as `20260925000000_pesantren_role_catalog`
does). Recover a failed replay with `prisma migrate resolve --rolled-back <name>`.

Test a migration against a restored copy of real data in a Postgres container
on an `--internal` Docker network, running `node_modules/.bin/prisma migrate
deploy` directly (corepack wants the internet).

## Renumbering a branch's migrations

A long-lived branch whose migrations are older than `main`'s latest should be
renumbered after it, so the history reads in the order it is applied. Take
the list of the branch's own migrations from
`git diff --name-only --diff-filter=A origin/main HEAD -- apps/api/prisma/migrations`
— **never from a date glob**: `202609*` matched 34 migrations already applied
on staging and production, not the branch's 8 (2026-10-09; caught before the
commit). Afterwards `git diff --name-status origin/main -- apps/api/prisma/migrations`
must list only `A` lines.

## Prisma 7 flag traps

- `--to-schema` and `--from-schema` (not `--to-schema-datamodel`).
- No `--shadow-database-url`; it comes from `prisma.config.ts`.
- Diffing two schema *files* dies with "Error in Schema engine" because a
  Prisma 7 datasource block has no `url`. Use the datasource form.
- `db push` needs `--config prisma/prisma.config.ts`; `--skip-generate` no
  longer exists and makes it print usage and do nothing.

Migration files here open with an Indonesian comment header explaining **why**
the change exists, then the SQL. See [seed-verify-throwaway-db](./seed-verify-throwaway-db.md).
