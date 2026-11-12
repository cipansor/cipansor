import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import * as PrismaClientNS from '@prisma/client';
import { createPrismaClient } from '../../prisma/client';

/**
 * Regression guard for the higher-education / Litbang purge
 * (PR #505). Each removal here was silent: a deleted module whose Prisma model
 * survived only failed at runtime, and editing the already-deployed `0_init`
 * migration left old enum values in existing databases while the regenerated
 * client rejected them. This test pins the invariants that keep the purge
 * consistent.
 */

const API_ROOT = resolve(__dirname, '..', '..');
const read = (p: string) => readFileSync(p, 'utf8');

const SCHEMA = read(join(API_ROOT, 'prisma', 'schema.prisma'));
const ZERO_INIT = read(join(API_ROOT, 'prisma', 'migrations', '0_init', 'migration.sql'));

const REMOVED_MODELS = ['ResearchProject', 'ResearchMilestone', 'InnovationProposal'];
const REMOVED_ENUMS = ['ResearchStatus', 'InnovationStatus'];
const REMOVED_ROLES = [
  'PT_REKTOR',
  'PT_WAKIL_REKTOR',
  'PT_DEKAN',
  'PT_KAPRODI',
  'PT_DOSEN',
  'PT_MAHASISWA',
  'PT_STAF_AKADEMIK',
  'PT_TATA_USAHA',
  'PT_ALUMNI',
];

const migrationDirs = readdirSync(join(API_ROOT, 'prisma', 'migrations'));
const DECOMMISSION_DIR = migrationDirs.find((d) => d.endsWith('_decommission_higher_ed_litbang'));
const DECOMMISSION = DECOMMISSION_DIR
  ? read(join(API_ROOT, 'prisma', 'migrations', DECOMMISSION_DIR, 'migration.sql'))
  : '';

describe('decommission purge — schema', () => {
  it.each(REMOVED_MODELS)('no model %s remains', (model) => {
    expect(SCHEMA).not.toMatch(new RegExp(`^model ${model}\\b`, 'm'));
  });

  it.each(REMOVED_ENUMS)('no enum %s remains', (name) => {
    expect(SCHEMA).not.toMatch(new RegExp(`^enum ${name}\\b`, 'm'));
  });

  it('no PERGURUAN_TINGGI / PT_* survives in the schema', () => {
    expect(SCHEMA).not.toContain('PERGURUAN_TINGGI');
    for (const role of REMOVED_ROLES) {
      expect(SCHEMA).not.toContain(role);
    }
  });

  it('retains the still-live research models', () => {
    expect(SCHEMA).toMatch(/^model ResearchTheme\b/m);
    expect(SCHEMA).toMatch(/^model ResearchSubmission\b/m);
  });
});

describe('decommission purge — generated Prisma client', () => {
  it('drops the removed delegates but keeps the live research ones', async () => {
    const client = createPrismaClient() as unknown as Record<string, unknown>;
    try {
      for (const model of REMOVED_MODELS) {
        const delegate = model[0].toLowerCase() + model.slice(1);
        expect(client[delegate]).toBeUndefined();
      }
      expect(client.researchTheme).toBeDefined();
    } finally {
      // The delegate inspection never opens a query, but the client still owns
      // the pg driver pool; release it rather than leaking a connection.
      await (client.$disconnect as () => Promise<void>).call(client);
    }
  });

  it('no longer exposes ResearchStatus / InnovationStatus', () => {
    const ns = PrismaClientNS as unknown as Record<string, unknown>;
    expect(ns.ResearchStatus).toBeUndefined();
    expect(ns.InnovationStatus).toBeUndefined();
  });

  it('Realm, UnitType and RoleCode carry no higher-ed values', () => {
    const { Realm, UnitType, RoleCode } = PrismaClientNS;
    expect(Object.values(Realm)).not.toContain('PERGURUAN_TINGGI');
    expect(Object.values(UnitType)).not.toContain('PERGURUAN_TINGGI');
    for (const role of REMOVED_ROLES) {
      expect(Object.values(RoleCode)).not.toContain(role);
    }
  });
});

describe('decommission purge — migrations', () => {
  it('leaves 0_init untouched so deployed databases are not desynced', () => {
    // The baseline has definitely shipped; rewriting it never re-runs on an
    // existing database. The legacy values must still be there, and the drift
    // must be corrected by a later migration instead.
    expect(ZERO_INIT).toContain('PERGURUAN_TINGGI');
    expect(ZERO_INIT).toContain('PT_DOSEN');
  });

  it('ships a new migration that reconciles data before dropping the enum values', () => {
    expect(DECOMMISSION).not.toBe('');
    // Data that still points at the dropped unit type / realm is re-homed
    // BEFORE the type is recreated, otherwise the ALTER fails on old rows.
    const reassign = DECOMMISSION.indexOf('PERGURUAN_TINGGI');
    const recreate = DECOMMISSION.indexOf('CREATE TYPE "UnitType"');
    expect(reassign).toBeGreaterThan(-1);
    expect(recreate).toBeGreaterThan(reassign);

    for (const table of ['research_projects', 'research_milestones', 'innovation_proposals']) {
      expect(DECOMMISSION).toContain(`DROP TABLE IF EXISTS "${table}"`);
    }
    // PR #504 owns the system-secrets removal; #505's SQL must not act on it.
    // The header does name the table -- it has to explain why the catalog rule
    // still matches three tables after #504 deleted the model -- so strip the
    // comments before asserting that no statement touches it.
    expect(DECOMMISSION.replace(/--[^\n]*/g, '')).not.toContain('system_secrets');
  });

  it('no longer references the removed modules from active source', () => {
    const appSource = read(join(API_ROOT, 'src', 'app.ts'));
    expect(appSource).not.toContain("'/litbang'");
    expect(appSource).toContain("'/research'");

    const removedDir = join(API_ROOT, 'src', 'modules', 'litbang');
    expect(() => readdirSync(removedDir)).toThrow();
  });

  it('keeps the published blast radius consistent across migration and docs', () => {
    // The operator-facing numbers drifted apart once already (the PR body, the
    // migration header and docs/DEPLOYMENT.md disagreed, and one header count
    // was not reproducible from the catalog at all). Pin the numbers the
    // migration and the runbook must agree on, so the next schema change that
    // moves the closure is told to update both rather than leaving one stale.
    const deployment = read(resolve(API_ROOT, '..', '..', 'docs', 'DEPLOYMENT.md'));
    const dependents = DECOMMISSION.match(
      /deletes (\d+) dependent tables \((\d+) including `units`/
    );
    expect(dependents, 'migration header states the blast radius').not.toBeNull();
    const [, migrationDependents, migrationTotal] = dependents!;
    expect(migrationDependents).toBe('232');
    expect(migrationTotal).toBe('233');
    expect(Number(migrationTotal) - Number(migrationDependents)).toBe(1);

    // docs/DEPLOYMENT.md must publish the same two numbers.
    expect(deployment).toContain(`${migrationDependents} dependent`);
    expect(deployment).toContain(`(${migrationTotal} including \`units\`)`);

    // The depth distribution and the seed count must be internally consistent:
    // depth 0 is exactly the seed set (units + the pinned tables + the
    // unique-per-unit matches), and the distribution sums to the total.
    const headerText = DECOMMISSION.split('\n')
      .map((l) => l.replace(/^\s*--\s?/, ''))
      .join('\n');
    const dist = headerText.match(
      /Depth distribution[^:]*:\s*(\d+) at 0,\s*(\d+) at 1,\s*(\d+) at 2,\s*(\d+) at 3/
    );
    expect(dist, 'migration header states the depth distribution').not.toBeNull();
    const [, d0, d1, d2, d3] = dist!.map(Number);
    expect(d0 + d1 + d2 + d3).toBe(Number(migrationTotal));

    // The explicit `IN (...)` pin list in the loop must mirror the tables the
    // header documents. `units` is the root of the closure and is seeded
    // separately (`c.oid = 'units'::regclass`), so it is not part of the literal
    // pin list -- its presence in the header's repro query is the closure root.
    const pinnedInLoop = [
      'announcements',
      'alumni_events',
      'calendar_events',
      'dashboard_history',
      'islamic_events',
      'paud_development_indicators',
      'strategic_plans',
      'donation_campaigns',
      'marketing_campaigns',
      'account_codes',
    ];
    for (const table of pinnedInLoop) {
      expect(DECOMMISSION, table).toContain(`'public.${table}'`);
    }
    // Depth 0 = `units` + the ten pinned tables + the three unique-per-unit
    // matches. If a future change adds or drops a seed, this fails and forces
    // the header numbers (232/233, distribution) to be recomputed too.
    expect(d0).toBe(1 + pinnedInLoop.length + 3);
  });

  it('deletes the PERGURUAN_TINGGI unit outright instead of re-typing it', () => {
    // Owner decision on PR #505: the PT unit is removed, not re-typed to OTHER.
    // A unit cannot simply be deleted while rows still point at it, so the
    // migration walks the live FK catalog. Pin the shape: no re-typing UPDATE,
    // a catalog-driven closure, and a real DELETE.
    expect(DECOMMISSION).not.toMatch(/UPDATE "units"[\s\S]{0,80}SET "type"\s*=\s*'OTHER'/);
    expect(DECOMMISSION).toContain('confdeltype');
    expect(DECOMMISSION).toMatch(/DELETE FROM %s WHERE id IN/);
    // The realm still has to be re-homed for the enum rewrite, which is a
    // different concern from the unit rows themselves.
    expect(DECOMMISSION).toMatch(/UPDATE "roles"[\s\S]*?SET "realm"\s*=\s*'UNIT_USAHA'/);
  });

  it('ends the sessions of users left without any role by the PT purge', () => {
    // Deleting the PT_* assignments alone does not end a PT user's session:
    // `authService.refreshToken` falls back to the legacy `users.role` column
    // when no assignment is active, so a user whose only role was PT keeps
    // rotating refresh tokens. The migration must therefore also identify the
    // affected users (before deleting their assignments), revoke their refresh
    // tokens and null the legacy role.
    const code = DECOMMISSION.replace(/--[^\n]*/g, '');
    expect(code).toMatch(/DELETE FROM "refresh_tokens"/);
    expect(code).toMatch(/UPDATE "users"[\s\S]*?SET "role"\s*=\s*NULL/);
    // The temp table must be populated before the PT assignments are removed,
    // otherwise the trace of who was PT-only is already gone.
    const snapshot = code.indexOf('CREATE TEMP TABLE');
    const deleteAssignments = code.indexOf('DELETE FROM "user_role_assignments"');
    expect(snapshot).toBeGreaterThan(-1);
    expect(deleteAssignments).toBeGreaterThan(snapshot);
    // Only users with no remaining active assignment qualify.
    expect(code).toMatch(/NOT EXISTS/);
    expect(code).toMatch(/"is_active"/);
  });

  it('documents why a later-expiring non-PT assignment is not a PT hole', () => {
    // Gap 2 of the PR #505 review: a "mixed" user whose surviving non-PT
    // assignment is active now but expires later would keep the legacy fallback
    // reachable once it lapses. That presupposes `expires_at` is ever written,
    // which no code path does — `assignRoleSchema` carries no `expiresAt` and
    // every assignment creation omits it. Pinned so the day that changes, this
    // reasoning is re-checked instead of silently rotting.
    const rolesSchema = read(join(API_ROOT, 'src', 'modules', 'roles', 'roles.schema.ts'));
    expect(rolesSchema).toMatch(/assignRoleSchema/);
    expect(rolesSchema).not.toMatch(/expiresAt/);

    for (const rel of [
      ['src', 'modules', 'roles', 'roles.service.ts'],
      ['src', 'utils', 'parent-scope.ts'],
      ['src', 'services', 'integration', 'student-onboarding.orchestrator.ts'],
    ]) {
      const source = read(join(API_ROOT, ...rel));
      expect(source, rel.join('/')).not.toMatch(
        /userRoleAssignment\.(create|update|updateMany)[\s\S]{0,200}expiresAt/
      );
    }
  });

  it('no code writes `expires_at` on a user_role_assignment (exhaustive)', () => {
    // The full set of assignment writers, confirmed by grepping every
    // `userRoleAssignment.create|update|updateMany|upsert` and every nested
    // `userRoles: { create/update }` in the API and the seed. None sets
    // `expiresAt`/`expires_at`; the only reads are active-role filters
    // (auth.service.ts activeRoleWhere, roles.service.ts switchRole). If one of
    // these starts writing an expiry, the "mixed user, future expiry" reasoning
    // above no longer holds and the PT purge must be revisited.
    const writers = [
      ['src', 'modules', 'auth', 'auth.service.ts'],
      ['src', 'modules', 'roles', 'roles.service.ts'],
      ['src', 'modules', 'users', 'user.service.ts'],
      ['src', 'utils', 'parent-scope.ts'],
      ['src', 'services', 'integration', 'student-onboarding.orchestrator.ts'],
      ['prisma', 'seed.ts'],
    ];
    for (const rel of writers) {
      const source = read(join(API_ROOT, ...rel));
      // A write site that reaches an `expiresAt` within a small window of the
      // assignment mutation is the only realistic way to set the column.
      expect(source, `${rel.join('/')} writes expiresAt`).not.toMatch(
        /(userRoleAssignment\.(create|createMany|update|updateMany|upsert)|userRoles:\s*\{\s*(create|update))[\s\S]{0,200}?expiresAt/
      );
    }
    // Raw SQL is the other way in; none of it *writes* user_role_assignments.
    // The regex must distinguish a write from a read: the section-4 sweep
    // legitimately *reads* the column (`... AND (expires_at IS NULL OR
    // expires_at > now())`) to mirror `activeRoleWhere`, so an `expires_at`
    // followed by `IS NULL`/`>` must not trip the guard. What it must catch is
    // an assignment (`expires_at =`) or an INSERT column list carrying the
    // column.
    const migrationSql = readdirSync(join(API_ROOT, 'prisma', 'migrations'))
      .filter((d) => d !== 'migration_lock.toml')
      .map((d) => join(API_ROOT, 'prisma', 'migrations', d, 'migration.sql'))
      .filter((p) => p.endsWith('.sql'))
      .map((p) => read(p))
      .join('\n');
    expect(migrationSql).not.toMatch(
      /UPDATE\s+"?user_role_assignments"?[\s\S]{0,400}?SET[\s\S]{0,300}?"?expires_at"?\s*=/
    );
    expect(migrationSql).not.toMatch(
      /INSERT INTO\s+"?user_role_assignments"?\s*\([^)]*"?(expires_at|expiresAt)"?/
    );
  });

  it('closes the no-assignment PT shape via the pre-purge unit snapshot', () => {
    // Gap 1 of the PR #505 review: a PT user with no `user_role_assignments`
    // row leaves no PT assignment for the purge to find. Account creation is
    // not how the shape arises — those paths all write an assignment:
    //   - authService.register        -> auth.service.ts:388 (tx.userRoleAssignment.create)
    //   - userService.create          -> user.service.ts:224 (nested userRoles.create)
    //   - student-onboarding          -> student-onboarding.orchestrator.ts:341
    //   - parent-scope                -> parent-scope.ts:130
    //   - seed (DEMO_ACCOUNTS loop)   -> seed.ts, one create per entry
    // It arises through *offboarding*: `rolesService.removeRoleAssignment`
    // (roles.service.ts:243) deletes the row without revoking refresh tokens,
    // so the user keeps a rotatable token and a legacy `users.role`. The
    // migration closes it by snapshotting users still attached to a
    // PERGURUAN_TINGGI unit before the unit is deleted (`users.unit_id` is SET
    // NULL, so this marker only exists pre-delete), and unioning that with the
    // assignment-based set. Pinned end-to-end by
    // tests/integration/decommission-pt-session.integration.test.ts.
    const register = read(join(API_ROOT, 'src', 'modules', 'auth', 'auth.service.ts'));
    expect(register).toMatch(/userRoleAssignment\.create/);

    const users = read(join(API_ROOT, 'src', 'modules', 'users', 'user.service.ts'));
    expect(users).toMatch(/userRoles:\s*\{\s*create:/);

    const seed = read(join(API_ROOT, 'prisma', 'seed.ts'));
    expect(seed).toMatch(/userRoleAssignment\.create/);
    // The seed also fails loudly if any active account is left without an
    // active assignment.
    expect(seed).toMatch(/userRoles:\s*\{\s*none:\s*\{\s*isActive:\s*true/);

    // The offboarding path that produces the shape does not revoke tokens —
    // the migration therefore has to. Pinned so a future "tidy up" of
    // removeRoleAssignment is not mistaken for the fix.
    const roles = read(join(API_ROOT, 'src', 'modules', 'roles', 'roles.service.ts'));
    const remove = roles.slice(roles.indexOf('async removeRoleAssignment'));
    expect(remove.slice(0, 400)).not.toMatch(/refreshToken\.deleteMany/);

    // Migration: the unit-based snapshot is taken *before* the unit delete, and
    // the section-4 selection unions it with the assignment-based candidates.
    const code = DECOMMISSION.replace(/--[^\n]*/g, '');
    const unitSnapshot = code.indexOf('pt_unit_users_tmp');
    const deleteUnits = code.search(/DELETE FROM\s+%s/);
    expect(unitSnapshot).toBeGreaterThan(-1);
    expect(deleteUnits).toBeGreaterThan(-1);
    expect(unitSnapshot).toBeLessThan(deleteUnits);
    expect(code).toMatch(/UNION/);
    expect(code).toMatch(/FROM "pt_unit_users_tmp"/);
  });

  it('neutralises null-scoped non-foundation assignments on PT-home users', () => {
    // CRITICAL broken access control (Devin Review): a PT-home user whose only
    // active assignment is a NON-foundation role with `unit_id IS NULL`. The
    // unit delete nulls `users.unit_id`, after which `tokenUnitId`
    // (src/utils/resolve-unit-id.ts:187-195) mints a null-unit token for that
    // assignment, and the 117 optional unit filter sites read null as "every unit":
    // scope WIDENS from one unit to the foundation. The migration must
    // deactivate the assignment before computing `pt_only_users_tmp`. Pinned
    // statically here and end-to-end by
    // tests/integration/decommission-pt-session.integration.test.ts.
    const code = DECOMMISSION.replace(/--[^\n]*/g, '');
    const deactivate = code.search(/"unit_id"\s+IS\s+NULL/);
    const snapshot = code.indexOf('CREATE TEMP TABLE "pt_only_users_tmp"');
    expect(snapshot).toBeGreaterThan(-1);
    expect(deactivate).toBeGreaterThan(-1);
    // A bare `unit_id IS NULL`-scoped deactivation exists ...
    expect(code).toMatch(/"unit_id"\s+IS\s+NULL/);
    // ... and it is scoped to PT-home users (the pre-delete snapshot) ...
    expect(code).toMatch(/FROM "pt_unit_users_tmp"/);
    // ... excludes the foundation/global codes the runtime treats as
    // null-scope-by-design (`isFoundationScopedRole`) ...
    const inMatch = code.match(/r\."code"\s+IN\s*\(([\s\S]*?)\)/);
    expect(inMatch, 'migration has a role-code exemption list').not.toBeNull();
    const exempted = [...inMatch![1].matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    // ... mirroring the runtime's `FOUNDATION_SCOPE_ROLES`
    // (src/utils/resolve-unit-id.ts:63-71) exactly, both directions. A code the
    // runtime treats as foundation-scoped but the migration omits would sweep a
    // legitimate yayasan account; a code the migration exempts but the runtime
    // does not would leave a null-unit escalation open.
    const resolveUnit = read(join(API_ROOT, 'src', 'utils', 'resolve-unit-id.ts'));
    const foundation = resolveUnit.slice(resolveUnit.indexOf('FOUNDATION_SCOPE_ROLES'));
    const runtimeCodes = [
      ...foundation.slice(0, foundation.indexOf('];')).matchAll(/RoleCode\.([A-Z_]+)/g),
    ].map((m) => m[1]);
    expect(runtimeCodes.length).toBeGreaterThan(0);
    expect(exempted.sort()).toEqual([...runtimeCodes].sort());
    // ... and runs BEFORE the `pt_only_users_tmp` snapshot, so the sweep sees
    // the neutralised assignment as gone.
    expect(deactivate).toBeLessThan(snapshot);
  });

  it('guards the purge block against a catalog that breaks its assumptions', () => {
    // The unit purge deletes rows with `ch.id IN (...)` per FK edge, which is
    // only correct while every followed edge is single-column, targets the
    // parent's `id`, and the child has an `id`. The block computes the table
    // closure from the catalog and asserts those three properties, failing
    // loudly instead of deleting the wrong rows or dying mid-deploy. Pinned so
    // the guards are not quietly removed by a future refactor.
    expect(DECOMMISSION).toMatch(/array_length\(c\.conkey,\s*1\)/);
    expect(DECOMMISSION).toMatch(/pa\.attnum\s*=\s*c\.confkey\[1\]/);
    expect(DECOMMISSION).toMatch(/edge\.parent_col\s*<>\s*'id'/);
    expect(DECOMMISSION).toMatch(/_decommission_tables/);
    expect(DECOMMISSION).toMatch(/IF edge\.conkey_len <> 1 THEN/);
    expect(DECOMMISSION).toMatch(/RAISE EXCEPTION/);
  });

  it('refuses to delete a doomed row that belongs to a surviving unit', () => {
    // Finding 5 of the PR #505 review: the row walk follows every
    // NO ACTION/RESTRICT/CASCADE FK, so a row can reach a doomed PT parent
    // through a column that is not its `unit_id` -- a book whose `category_id`
    // is a PT category while the book sits on a sibling unit. Deleting it would
    // reach across units. The migration asserts that every doomed row carrying
    // a `unit_id` belongs to a PT unit, and raises rather than delete the rest.
    expect(DECOMMISSION).toMatch(/t\.unit_id NOT IN \(SELECT id FROM units/);
    expect(DECOMMISSION).toMatch(/refusing to reach across units/);
  });

  it('orders the purge by doomed row, not whole table, so a table-level cycle is not fatal', () => {
    // Finding 3 of the PR #505 review: the old purge deleted whole tables in
    // leaf-first batches and raised as soon as a batch came back empty, which a
    // table-level FK cycle would trigger even when no doomed row of either table
    // referenced a doomed row of the other. The loop now falls back to deleting
    // the doomed rows nothing still references, and raises only when that pass
    // also makes no progress -- a genuine row-level deadlock. Pinned so the
    // fallback is not quietly removed (which would reintroduce the false abort).
    const code = DECOMMISSION.replace(/--[^\n]*/g, '');
    expect(code).toMatch(/AND %s',\s*\n?\s*edge\.parent, edge\.parent, edge\.conds/);
    expect(code).toMatch(/NOT EXISTS \(SELECT 1 FROM %s ch WHERE ch\.%I = t\.id\)/);
    expect(code).toMatch(/IF total = 0 THEN/);
    // The loud abort stays: a real row cycle must still stop the deploy.
    expect(code).toMatch(/FK cycle prevents deleting PERGURUAN_TINGGI units/);
  });

  it('deletes PT rows whose `SET NULL` unit FK would globalise them', () => {
    // Finding 1 of the PR #505 review: a `SET NULL` FK to `units` does not
    // delete the child row -- it nulls the column, and for these tables a
    // NULL `unit_id` is read as "all units"/foundation-wide. Letting the FK fire
    // would widen each PT row's audience instead of retiring it. The migration
    // captures those rows before the unit delete and folds them into the purge.
    //
    // The list is semantic (the catalog cannot tell "NULL means global" from
    // "NULL means orphan") but the mechanism is catalog-driven, and each entry
    // is pinned against the read path that proves the semantics.
    //
    // `system_secrets` belongs to this class too (secrets.service.ts:6-7 reads
    // `unitId: null` as the global/foundation-wide scope), but PR #504 owns that
    // module and #505's migration must not name it. It is caught instead by the
    // generic below.
    const GLOBAL_NULL_TABLES = [
      'announcements',
      // Not a "NULL widens the audience" table but the same pinned class: the
      // unfiltered `getEvents` list returns a NULL-unit event to every unit.
      'alumni_events',
      'calendar_events',
      'dashboard_history',
      'islamic_events',
      'paud_development_indicators',
      'strategic_plans',
      'donation_campaigns',
      'marketing_campaigns',
      'account_codes',
    ];
    expect(DECOMMISSION).toContain('pt_setnull_doomed_tmp');
    expect(DECOMMISSION).toMatch(/confdeltype\s*=\s*'n'/);
    expect(DECOMMISSION).toMatch(/c\.confrelid\s*=\s*'units'::regclass/);
    for (const table of GLOBAL_NULL_TABLES) {
      expect(DECOMMISSION, table).toContain(`'public.${table}'`);
    }
    // users.unit_id and user_role_assignments.unit_id must keep SET NULL: a
    // PT-only account survives the unit delete detached (section 4 then ends
    // its session). Pinned by their absence from the purge list.
    expect(DECOMMISSION).not.toContain("'public.users'");
    expect(DECOMMISSION).not.toContain("'public.user_role_assignments'");

    // Evidence that NULL means "global" for each pinned table (file:line).
    const announcements = read(
      join(API_ROOT, 'src', 'modules', 'announcements', 'announcements.service.ts')
    );
    expect(announcements).toMatch(/\{ unitId: null \}/); // "Global announcements"
    const calendar = read(join(API_ROOT, 'src', 'modules', 'calendar', 'calendar.service.ts'));
    expect(calendar).toMatch(/unitId: null/);
    const dashboard = read(join(API_ROOT, 'src', 'modules', 'dashboard', 'dashboard.service.ts'));
    expect(dashboard).toMatch(/unitId: unitId \|\| null/);
    const paudSchema = read(
      join(API_ROOT, 'src', 'modules', 'paud-assessment', 'paud-assessment.schema.ts')
    );
    expect(paudSchema).toMatch(/null = global indicator/);
    const perencanaan = read(
      join(API_ROOT, 'src', 'modules', 'perencanaan', 'perencanaan.service.ts')
    );
    expect(perencanaan).toMatch(/\{ unitId: null \}/);

    // `alumni_events` is pinned for the same class, one step stronger: a NULL
    // unit is not read as the foundation scope, it is read by the *unfiltered*
    // list at all. `getEvents` (alumni.service.ts:692-722) filters with
    // `...(unitId && { unitId })` -- a NULL-unit event matches no unit filter and
    // is returned by the list the web calls by default (use-alumni.ts:340-361,
    // no unitId param) -- so a detached PT event would stay visible to every
    // unit, attendee count included. Pinned against that exact query shape.
    const alumni = read(join(API_ROOT, 'src', 'modules', 'alumni', 'alumni.service.ts'));
    const getEventsStart = alumni.indexOf('export async function getEvents');
    const getEvents = alumni.slice(
      getEventsStart,
      alumni.indexOf('export async function getEventById', getEventsStart)
    );
    expect(getEvents).toMatch(/\.\.\.\(unitId && \{ unitId \}\)/);
    expect(getEvents).toMatch(/_count: \{ select: \{ attendees: true \} \}/);
    // It has no `(unit_id, ...)` UNIQUE either, so the generic catalog rule
    // cannot reach it (the leading unique columns are `id` and
    // event_id/alumni_id on the attendee table, not `unit_id`).
    const eventBody = SCHEMA.slice(SCHEMA.indexOf('model AlumniEvent {'));
    const eventFields = eventBody.slice(0, eventBody.indexOf('\n}'));
    expect(eventFields).not.toMatch(/@@unique\(\[unitId/);
    // And its own children do not reach it from `units` over the followed edges:
    // both `alumni_event_attendees` FKs are CASCADE, so the closure picks the
    // attendee up only once the event is doomed.
    expect(ZERO_INIT).toMatch(
      /ALTER TABLE "alumni_event_attendees" ADD CONSTRAINT "alumni_event_attendees_event_id_fkey" FOREIGN KEY \("event_id"\) REFERENCES "alumni_events"\("id"\) ON DELETE CASCADE/
    );

    // `donation_campaigns` is a pinned entry whose read path never even looks at
    // the unit: `findPublic` filters on status/date only, so a PT campaign the
    // FK detached to `unit_id IS NULL` stays on the public site and keeps
    // collecting donations. Pinned against that exact query shape.
    const donation = read(join(API_ROOT, 'src', 'modules', 'donation', 'donation.service.ts'));
    const findPublic = donation.slice(
      donation.indexOf('async findPublic'),
      donation.indexOf('async findPublic') + 600
    );
    expect(findPublic).toMatch(/status: 'ACTIVE'/);
    expect(findPublic).not.toMatch(/unitId/);
    // And the table carries no `(unit_id, ...)` UNIQUE, which is why the generic
    // catalog rule cannot reach it: only `id` and `slug` are unique.
    const campaignBody = SCHEMA.slice(SCHEMA.indexOf('model DonationCampaign {'));
    const campaignFields = campaignBody.slice(0, campaignBody.indexOf('\n}'));
    expect(campaignFields).toMatch(/slug\s+String\s+@unique/);
    expect(campaignFields).not.toMatch(/@@unique\(\[unitId/);

    // `marketing_campaigns` is the same shape: a *public* lookup for a single
    // campaign by code, with no session (`marketing.routes.ts`, the public GET
    // is declared before `router.use(authenticate)`) and no unit filter on the
    // read (`getCampaignByCode` filters on code + isActive only). A PT campaign
    // the FK detached to `unit_id IS NULL` with `is_active = true` would keep
    // resolving its code and keep attributing registrations.
    const marketingRoutes = read(
      join(API_ROOT, 'src', 'modules', 'marketing', 'marketing.routes.ts')
    );
    const publicLookup = marketingRoutes.indexOf("'/public/campaigns/code/:code'");
    const authenticate = marketingRoutes.indexOf('router.use(authenticate)');
    expect(publicLookup).toBeGreaterThan(-1);
    expect(authenticate).toBeGreaterThan(publicLookup);

    const marketing = read(join(API_ROOT, 'src', 'modules', 'marketing', 'marketing.service.ts'));
    const byCode = marketing.slice(
      marketing.indexOf('export const getCampaignByCode'),
      marketing.indexOf('export const getCampaignByCode') + 500
    );
    expect(byCode).toMatch(/isActive: true/);
    expect(byCode).not.toMatch(/unitId/);
    // Like the donation campaign it has no `(unit_id, ...)` UNIQUE; `code` is
    // globally unique, so the generic catalog rule cannot reach it either.
    const mktBody = SCHEMA.slice(SCHEMA.indexOf('model MarketingCampaign {'));
    const mktFields = mktBody.slice(0, mktBody.indexOf('\n}'));
    expect(mktFields).toMatch(/code\s+String\s+@unique/);
    expect(mktFields).not.toMatch(/@@unique\(\[unitId/);

    // `account_codes` is the finance-side twin of the two campaigns: the list
    // reads never scope by unit, and the account code it holds is globally
    // unique, so a detached `unit_id = NULL` row both stays on every unit's
    // chart and keeps its code occupied for a real unit.
    const accounting = read(join(API_ROOT, 'src', 'modules', 'finance', 'accounting.service.ts'));
    const getAccounts = accounting.slice(
      accounting.indexOf('export async function getAccounts'),
      accounting.indexOf('export async function getAccountById')
    );
    expect(getAccounts).toMatch(/isActive/);
    expect(getAccounts).not.toMatch(/unitId/);

    const financeEnhancement = read(
      join(API_ROOT, 'src', 'modules', 'finance-enhancement', 'finance-enhancement.service.ts')
    );
    const getAccountCodes = financeEnhancement.slice(
      financeEnhancement.indexOf('async getAccountCodes'),
      financeEnhancement.indexOf('async createAccountCode')
    );
    expect(getAccountCodes).toMatch(/isActive/);
    // The list gained an opt-in `unitId` filter (the budgeting dropdown must
    // offer only accounts `createBudget` accepts). The property this pin guards
    // is unchanged, and now stated directly: a NULL-unit row stays visible to
    // every unit, so the filter matches the shared `unitId: null` rows too — a
    // detached PT row would still sit on every chart.
    expect(getAccountCodes).toMatch(/\{ OR: \[\{ unitId \}, \{ unitId: null \}\] \}/);

    const accountingConfig = read(
      join(API_ROOT, 'src', 'modules', 'finance', 'accounting-config.service.ts')
    );
    const fallback = accountingConfig.slice(
      accountingConfig.indexOf('export async function getAccountOrFallback'),
      accountingConfig.indexOf('export async function getAccountOrFallback') + 1200
    );
    expect(fallback).toMatch(/where: \{ code: fallbackCode, isActive: true, unitId \}/);
    // No `(unit_id, ...)` UNIQUE, so the generic catalog rule cannot reach it
    // either; `code` alone is unique (0_init `account_codes_code_key`).
    const acctBody = SCHEMA.slice(SCHEMA.indexOf('model AccountCode {'));
    const acctFields = acctBody.slice(0, acctBody.indexOf('\n}'));
    expect(acctFields).toMatch(/code\s+String\s+@unique/);
    expect(acctFields).not.toMatch(/@@unique\(\[unitId/);
    expect(ZERO_INIT).toContain('CREATE UNIQUE INDEX "account_codes_code_key"');
  });

  it('captures unique-per-unit `SET NULL` children generically, without naming them', () => {
    // Finding 1's other half. A `SET NULL` child whose `(unit_id, ...)` is
    // UNIQUE models one row per unit, so a row belonging to the PT unit is
    // unit-owned -- not a foundation-wide row. It must be purged too. The
    // migration must NOT name them (PR #504 owns one of them), so it matches
    // the shape from the catalog: a unique index whose first key column is the
    // FK column. Today that matches `dashboard_metric_snapshots` and
    // `report_templates`, plus one table owned by PR #504.
    const code = DECOMMISSION.replace(/--[^\n]*/g, '');
    expect(code).toMatch(/pg_index/);
    expect(code).toMatch(/indisunique/);
    expect(code).toMatch(/i\.indkey\[0\]/);
    expect(code).toMatch(/ia\.attname\s*=\s*a\.attname/);
    // The tables the rule matches today must not be hard-coded anywhere in the
    // migration -- naming them would defeat the generic match.
    for (const table of [
      'dashboard_metric_snapshots',
      'report_templates',
      // Owned by PR #504; must stay out of #505's migration entirely.
      'system_secrets',
    ]) {
      expect(code, `${table} must not be pinned by literal name`).not.toContain(table);
    }

    // Evidence each is genuinely `@@unique([unitId, ...])` (the catalog rule
    // matches the leading key column being the FK column).
    for (const [model, unique] of [
      ['DashboardMetricSnapshot', '@@unique([unitId, metricType, periodType, periodDate])'],
      ['ReportTemplate', '@@unique([unitId, type])'],
    ]) {
      const body = SCHEMA.slice(SCHEMA.indexOf(`model ${model} {`));
      expect(body.slice(0, body.indexOf('\n}')), model).toContain(unique);
    }
    // `system_secrets` is the third match, and its evidence cannot come from
    // `schema.prisma` any more: PR #504 deleted the model. The TABLE still
    // exists when this migration runs, because #504's `DROP TABLE` sorts
    // *after* this folder and Prisma applies migrations in folder order. So the
    // evidence is the baseline the database actually carries, plus that
    // ordering -- if the drop is ever renamed to sort earlier, the catalog rule
    // matches two tables instead of three and the header's blast radius
    // (233/232, 14 at depth 0) is wrong by one.
    expect(ZERO_INIT).toContain(
      'CREATE UNIQUE INDEX "system_secrets_unit_id_key_key" ON "system_secrets"("unit_id", "key")'
    );
    expect(ZERO_INIT).toMatch(
      /ALTER TABLE "system_secrets" ADD CONSTRAINT "system_secrets_unit_id_fkey"[\s\S]{0,120}ON DELETE SET NULL/
    );
    const dropSecrets = migrationDirs.find((d) => d.endsWith('_drop_system_secrets'));
    expect(dropSecrets, 'PR #504 ships the system_secrets drop').toBeDefined();
    expect(DECOMMISSION_DIR).toBeDefined();
    expect(dropSecrets! > DECOMMISSION_DIR!).toBe(true);
  });

  it('excludes partial unique indexes from the unique-per-unit rule', () => {
    // Finding 2 of the PR #505 review: a PARTIAL unique index does not prove
    // "one row per unit" -- its predicate can exclude rows -- so matching it
    // could over-delete. An expression index cannot match either (its `indkey`
    // entry is 0, never a real `attnum`), and INCLUDE columns follow the key
    // columns so they do not affect `indkey[0]`. Pin both the guard and the
    // doc-query in the header, which must stay in sync with the DO block.
    expect(DECOMMISSION).toMatch(/i\.indpred IS NULL/);
    const header = DECOMMISSION.slice(0, DECOMMISSION.indexOf('DO \$decommission_setnull\$'));
    expect(header).toMatch(/i\.indpred IS NULL/);
  });

  it('the unique-per-unit heuristic matches only genuinely unit-owned tables', () => {
    // Analysis item B of the PR #505 review: the catalog rule reads "the leading
    // key column of a UNIQUE index is the FK column" as *unit ownership* -- not
    // merely "unique per unit". That is a destructive inference, so the tables
    // it matches today are each audited here against their read path. All three
    // are scoped by unit (a `unitId` filter or a per-unit precedence), none is a
    // foundation-wide table that happens to carry a nullable `unit_id`.
    const DASHBOARD = join(
      API_ROOT,
      'src',
      'modules',
      'dashboard-enhancement',
      'dashboard.service.ts'
    );
    const dashboard = read(DASHBOARD);
    // `listMetricSnapshots`/`getTrend` filter on the caller's unit when one is
    // supplied: a NULL-unit snapshot is the foundation-wide roll-up, and a
    // PT-unit snapshot (a unit-owned row) is read only for that unit.
    expect(dashboard).toMatch(/if \(unitId\) where\.unitId = unitId;/);

    const REPORTS = join(API_ROOT, 'src', 'modules', 'finance', 'reports.service.ts');
    const reports = read(REPORTS);
    // A report template is selected per unit, with the unit-specific row taking
    // precedence over the default: `unitId` is a real ownership column.
    expect(reports).toMatch(/OR: \[\{ unitId: query\.unitId \}, \{ isDefault: true \}\]/);

    // The third match, `system_secrets`, no longer has a read path to audit:
    // PR #504 deleted the module (`secrets.service.ts` read an explicit
    // `unitId` as that unit's secret and `null` as the foundation scope --
    // per-unit ownership, same as the two above). Its table outlives this
    // migration only because #504's drop sorts later, and it holds no rows in
    // production, so capturing it here retires it rather than globalising it.
    expect(existsSync(join(API_ROOT, 'src', 'modules', 'system-secrets'))).toBe(false);
  });

  it('pins the exact set of tables the unique-per-unit catalog rule can match', () => {
    // Finding 2 of the PR #505 review: the catalog rule is destructive and is
    // applied to whatever the schema happens to carry at deploy time, so a new
    // nullable `unit_id` + `@@unique([unitId, ...])` model would silently join
    // the purge with no semantic audit. The set is derived from the *schema*
    // here (the shape the rule keys on: an optional `unitId` mapped to
    // `unit_id`, a `SET NULL`-style optional `Unit` relation, and a
    // `@@unique([unitId, ...])`) and pinned by name. A new match fails this
    // test until it is audited against its read path and added below.
    //
    // The catalog equivalent is in the migration's section-3 comment; this
    // static form runs without a database. Keep the two in sync: today both
    // yield exactly these three tables.
    const models = [...SCHEMA.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)];
    const optionalUnitUnique = models
      .filter(([, , body]) => body.includes('@@unique([unitId'))
      .filter(([, , body]) => /unitId\s+String\?\s+@map\("unit_id"\)/.test(body))
      .filter(([, , body]) =>
        /unit\s+Unit\?\s+@relation\(fields: \[unitId\], references: \[id\]\)/.test(body)
      )
      .map(([, name, body]) => {
        const map = body.match(/@@map\("([^"]+)"\)/);
        return map ? map[1] : name;
      })
      .sort();

    expect(optionalUnitUnique).toEqual([
      // Audited: `listMetricSnapshots`/`getTrend` scope by the caller's unit; a
      // NULL unit is the foundation-wide roll-up, a unit row is unit-owned.
      'dashboard_metric_snapshots',
      // Audited: a template is selected per unit, the unit row taking
      // precedence over the default.
      'report_templates',
    ]);

    // The schema is no longer the whole story: the rule runs against the
    // database, which still carries `system_secrets` at this point (PR #504
    // deleted the model but its `DROP TABLE` sorts after this migration). So
    // the catalog matches three tables where the schema now shows two, and the
    // header's blast radius counts three. Pin the difference explicitly rather
    // than letting it read as a stale number.
    const alsoInDatabase = ['system_secrets'];
    for (const table of alsoInDatabase) {
      expect(ZERO_INIT, `${table} exists in the deployed baseline`).toContain(
        `CREATE TABLE "${table}"`
      );
      expect(SCHEMA, `${table} has no Prisma model left`).not.toContain(`@@map("${table}")`);
    }
    expect(optionalUnitUnique.length + alsoInDatabase.length).toBe(3);

    // Guard the derivation itself: a model with a *required* `unit_id` and
    // `@@unique([unitId, ...])` is unit-owned along a RESTRICT edge and is
    // already inside the closure, so the rule must NOT match it.
    const required = models
      .filter(([, , body]) => body.includes('@@unique([unitId'))
      .filter(([, , body]) => /unitId\s+String\s+@map\("unit_id"\)/.test(body))
      .map(([, name]) => name);
    expect(required.length).toBeGreaterThan(0); // the derivation is not vacuous
    expect(required).not.toContain('Driver');
  });

  it('leaves a detached PT donation alone: it never becomes global', () => {
    // The inverse of Finding 1, pinned so a later "purge everything the PT unit
    // touched" sweep cannot quietly delete real donation records. `donations`
    // has a `SET NULL` `unit_id` like the campaign does, but a null unit is NOT
    // read as foundation-wide here: `getRecent` (donation.service.ts:711-732)
    // lists by status alone with no unit filter, and every unit-scoped list uses
    // `...(unitId && { unitId })` (donation.service.ts:240,618), under which a
    // null row is invisible rather than widened. It is also not a pinned
    // NULL-means-global table.
    const donation = read(join(API_ROOT, 'src', 'modules', 'donation', 'donation.service.ts'));
    const scoped = () => [...donation.matchAll(/\.\.\.\(unitId && \{ unitId \}\)/g)];
    expect(scoped().length).toBeGreaterThan(0);
    // A copied `findPublic`-style predicate with no unit guard must NOT appear
    // for donations -- that is what would make null global.
    const recent = donation.slice(
      donation.indexOf('async getRecent'),
      donation.indexOf('async getRecent') + 400
    );
    expect(recent).not.toMatch(/unitId/);
    // Not in the pinned global list.
    const pinned = DECOMMISSION.slice(
      DECOMMISSION.indexOf('IN (\n'),
      DECOMMISSION.indexOf('IN (\n') + 900
    );
    expect(pinned).not.toContain('public.donations');
  });

  it('purges PT roles by realm, not only the hard-coded PT_* codes', () => {
    // Finding 2 of the PR #505 review: `roles.code` is TEXT (0_init), and
    // `createRoleSchema` accepts any uppercase code, so `POST /roles` can mint a
    // role with a non-standard code (e.g. PT_CUSTOM_X) and realm
    // PERGURUAN_TINGGI. Re-homing the realm (line ~283) would turn it into an
    // ordinary UNIT_USAHA role that survives, keeping its assignment, refresh
    // token and legacy `users.role`. The migration captures PT roles (realm OR
    // the known codes) BEFORE the realm rewrite, then deletes them by id.
    const rolesSchema = read(join(API_ROOT, 'src', 'modules', 'roles', 'roles.schema.ts'));
    expect(rolesSchema).toMatch(/code:[\s\S]*?z\.string\(\)/);
    expect(rolesSchema).toMatch(/\^\[A-Z0-9_\]\+\$/);

    const rolesService = read(join(API_ROOT, 'src', 'modules', 'roles', 'roles.service.ts'));
    expect(rolesService).toMatch(/async createRole/);

    const code = DECOMMISSION.replace(/--[^\n]*/g, '');
    expect(code).toContain('pt_roles_tmp');
    expect(code).toMatch(/"realm"::text\s*=\s*'PERGURUAN_TINGGI'/);
    // capture must precede the re-home, and deletion must use the captured set
    const capture = code.indexOf('pt_roles_tmp');
    const rehome = code.indexOf(`SET "realm" = 'UNIT_USAHA'`);
    const deleteRoles = code.indexOf('DELETE FROM "roles"');
    expect(rehome).toBeGreaterThan(capture);
    expect(deleteRoles).toBeGreaterThan(rehome);
    expect(code).toMatch(/DELETE FROM "roles" WHERE "id" IN \(SELECT "id" FROM "pt_roles_tmp"\)/);
  });

  it('deactivates a non-PT assignment scoped to the PT unit and ends its session', () => {
    // A role assignment carries a scope (`user_role_assignments.unit_id`), and the
    // token's unit comes from that assignment (`tokenUnitId`, resolve-unit-id.ts:
    // 187-195; refresh reads `primaryAssignment.unitId`, auth.service.ts:475). The
    // column is `SET NULL`, so deleting the PT unit detaches a *non-PT* assignment
    // instead of removing it -- and a null token unit is read as "no limit" by
    // every optional unit filter (`...(unitId && { unitId })`,
    // `unitId ? { unitId } : {}`), not as "no access". Markers 1 and 2 both miss
    // this user (the role is not PT, the user is not on the PT unit), so the
    // migration must snapshot the scoped assignments by unit, deactivate them, and
    // union their holders into the lost-role set.
    const resolveUnitId = read(join(API_ROOT, 'src', 'utils', 'resolve-unit-id.ts'));
    expect(resolveUnitId).toMatch(/export function tokenUnitId/);
    expect(resolveUnitId).toMatch(/if \(assignmentUnitId\) return assignmentUnitId/);

    const auth = read(join(API_ROOT, 'src', 'modules', 'auth', 'auth.service.ts'));
    expect(auth).toMatch(/refreshUnitId = primaryAssignment\.unitId/);
    // Evidence the optional-unit filter reads null as "every unit".
    const donation = read(join(API_ROOT, 'src', 'modules', 'donation', 'donation.service.ts'));
    expect(donation).toMatch(/\.\.\.\(unitId && \{ unitId \}\)/);

    const code = DECOMMISSION.replace(/--[^\n]*/g, '');
    expect(code).toContain('pt_scoped_assignments_tmp');
    // The snapshot is taken by unit, before the unit delete.
    expect(code).toMatch(/JOIN "units" un ON un\."id" = a\."unit_id"/);
    // The assignments are deactivated, not deleted.
    expect(code).toMatch(/UPDATE "user_role_assignments"\s+SET "is_active" = false/);
    // Their holders are unioned into the candidate set (marker 3). Compare the
    // CTE's two markers, not the earlier UPDATE that also names the temp table.
    const marker2 = code.lastIndexOf('SELECT "user_id" FROM "pt_unit_users_tmp"');
    const marker3 = code.lastIndexOf('SELECT "user_id" FROM "pt_scoped_assignments_tmp"');
    expect(marker2).toBeGreaterThan(-1);
    expect(marker3).toBeGreaterThan(marker2);
    // The snapshot must be taken before the unit delete, like marker 2.
    const snapshotScoped = code.indexOf('pt_scoped_assignments_tmp');
    const deleteUnits = code.search(/DELETE FROM\s+%s/);
    expect(snapshotScoped).toBeLessThan(deleteUnits);
  });
});
