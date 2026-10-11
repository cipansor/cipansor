import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Production and staging run on Azure Database for PostgreSQL, which refuses
 * `CREATE EXTENSION` for any extension the server does not allow-list — and
 * ours allow none. CI and the local stack run stock Postgres, where every
 * contrib extension installs, so a migration that needs one passes every check
 * and then fails on the first managed server it meets.
 *
 * It happened on 2026-10-09: `20261009010100_signing_key_fingerprint` called
 * `CREATE EXTENSION pgcrypto` for `digest()`, staging refused it after the
 * column was already added, and every restart after that stopped on P3009.
 * PostgreSQL has `sha256()` built in since version 11; use built-ins.
 */

const MIGRATIONS = resolve(__dirname, '..', '..', 'prisma', 'migrations');

/**
 * Functions that exist only once an extension is installed, by extension. None
 * of these is on the managed servers' allow-list; `gen_random_uuid()` and
 * `sha256()` are built in (PostgreSQL 13 and 11) and stay allowed.
 */
const EXTENSION_ONLY: Record<string, RegExp> = {
  pgcrypto:
    /\b(digest|hmac|crypt|gen_salt|pgp_sym_encrypt|pgp_sym_decrypt|pgp_pub_encrypt|pgp_pub_decrypt|armor|dearmor|gen_random_bytes)\s*\(/i,
  'uuid-ossp': /\b(uuid_generate_v[1-5](mc)?|uuid_nil|uuid_ns_(dns|url|oid|x500))\s*\(/i,
  pg_trgm: /\b(similarity|word_similarity|strict_word_similarity|show_trgm)\s*\(/i,
  unaccent: /\bunaccent\s*\(/i,
};

/**
 * The SQL without its comments. A header that explains why a function is not
 * used must not trip the rule it explains — in `--` lines or `/* … *\/` blocks.
 */
function withoutComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '');
}

function migrations(): { name: string; sql: string }[] {
  return readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => ({
      name: e.name,
      sql: withoutComments(readFileSync(join(MIGRATIONS, e.name, 'migration.sql'), 'utf8')),
    }));
}

describe('migrations run on a managed Postgres', () => {
  it('reads every migration (the scan is not blind)', () => {
    const all = migrations();
    expect(all.length).toBeGreaterThan(40);
    expect(all.map((m) => m.name)).toContain('20261009010100_signing_key_fingerprint');
  });

  it('no migration installs an extension', () => {
    const offenders = migrations()
      .filter((m) => /\bCREATE\s+EXTENSION\b/i.test(m.sql))
      .map((m) => m.name);
    expect(
      offenders,
      'Azure Database for PostgreSQL refuses CREATE EXTENSION unless the server allow-lists it; use a built-in (sha256(), gen_random_uuid()) instead'
    ).toEqual([]);
  });

  it.each(Object.entries(EXTENSION_ONLY))(
    'no migration calls a function only %s provides',
    (extension, pattern) => {
      const offenders = migrations()
        .filter((m) => pattern.test(m.sql))
        .map((m) => m.name);
      expect(
        offenders,
        `${extension} is not installed on the managed servers; use a built-in (sha256(), gen_random_uuid())`
      ).toEqual([]);
    }
  );

  it('the scan sees what it is meant to see, and not the comments that explain it', () => {
    // Without this a pattern typo would pass every migration, forever.
    expect(EXTENSION_ONLY.pgcrypto.test("digest(x, 'sha256')")).toBe(true);
    expect(EXTENSION_ONLY['uuid-ossp'].test('DEFAULT uuid_generate_v4()')).toBe(true);
    expect(EXTENSION_ONLY.pg_trgm.test('similarity(a, b)')).toBe(true);
    expect(EXTENSION_ONLY.unaccent.test('unaccent(name)')).toBe(true);
    expect(EXTENSION_ONLY.pgcrypto.test('gen_random_uuid()')).toBe(false);
    expect(EXTENSION_ONLY.pgcrypto.test("sha256(decode(k, 'base64'))")).toBe(false);

    const explained = withoutComments(
      '/* digest() needs pgcrypto, so */\n-- uuid_generate_v4() too\nSELECT sha256(x);'
    );
    expect(Object.values(EXTENSION_ONLY).some((p) => p.test(explained))).toBe(false);
  });
});
