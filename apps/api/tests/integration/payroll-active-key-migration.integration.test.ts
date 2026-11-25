/**
 * The `active_key` backfill is what lets an existing database upgrade without
 * losing a period: every non-cancelled row must receive its unit/month/year
 * key, and the cancelled rows must stay NULL. `db:push` in CI creates the
 * final schema, so the service test cannot prove this; this test runs the
 * real migration file against a scratch schema on PostgreSQL. Opt-in via
 * RUN_DB_TESTS=1.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const describeDb = process.env.RUN_DB_TESTS ? describe : describe.skip;
vi.setConfig({ testTimeout: 30_000 });

const CONNECTION = process.env.DATABASE_URL;
const MIGRATION = join(
  __dirname,
  '../../prisma/migrations/20261125130000_payroll_period_active_key/migration.sql'
);

describeDb('PayrollPeriod.active_key — the migration backfills existing rows', () => {
  it('keys every non-cancelled period, leaves cancelled rows NULL, and enforces uniqueness', async () => {
    const client = new Client({ connectionString: CONNECTION });
    const schema = `payroll_active_key_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      await client.query(
        'CREATE TABLE "payroll_periods" ("unit_id" TEXT, "month" INTEGER, "year" INTEGER, "status" TEXT)'
      );
      await client.query(
        `INSERT INTO "payroll_periods" ("unit_id", "month", "year", "status") VALUES
           ('unit-a', 7, 2026, 'DRAFT'),
           ('unit-a', 7, 2026, 'CANCELLED'),
           ('unit-b', 8, 2026, 'APPROVED')`
      );

      await client.query(readFileSync(MIGRATION, 'utf8'));

      const { rows } = await client.query(
        `SELECT "unit_id", "month", "year", "status", "active_key"
           FROM "payroll_periods"
          ORDER BY "unit_id", "status"`
      );
      expect(rows).toEqual([
        { unit_id: 'unit-a', month: 7, year: 2026, status: 'CANCELLED', active_key: null },
        { unit_id: 'unit-a', month: 7, year: 2026, status: 'DRAFT', active_key: 'unit-a:7:2026' },
        {
          unit_id: 'unit-b',
          month: 8,
          year: 2026,
          status: 'APPROVED',
          active_key: 'unit-b:8:2026',
        },
      ]);

      await expect(
        client.query(
          `INSERT INTO "payroll_periods" ("unit_id", "month", "year", "status", "active_key")
           VALUES ('unit-a', 7, 2026, 'DRAFT', 'unit-a:7:2026')`
        )
      ).rejects.toMatchObject({ code: '23505' });
    } finally {
      await client.query('SET search_path TO public');
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await client.end();
    }
  });
});
