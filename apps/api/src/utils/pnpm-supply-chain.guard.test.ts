import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parse, parseAllDocuments } from 'yaml';

/**
 * The dependency build allowlist in `pnpm-workspace.yaml` is only a real
 * supply-chain control on the pnpm version the repo actually runs.
 *
 * pnpm 9 executes every dependency's install scripts and ignores
 * `onlyBuiltDependencies` entirely, so the allowlist reads as a defence while
 * denying nothing (fail-open) — the defect this guard exists to prevent from
 * returning. pnpm 10 honours the key; pnpm 11 renamed it to `allowBuilds` (a
 * name→boolean map) and stopped the old key from granting anything, so on 11+
 * the old key would be *fail-closed* and break the native builds instead.
 *
 * A version bump alone is not enough, either: the pin lives in four places and
 * a pnpm that is older than the file assumes is exactly how the control goes
 * dead. Keep every pin equal to `packageManager`, and keep the workspace file
 * on the key that the pinned version honours.
 *
 * pnpm 12 adds a SECOND permission surface beside build scripts: a dependency
 * that ships `skills/<name>/` is linked into `.claude/skills` after approval
 * (`allowBuilds` does not govern it). Both surfaces must carry an explicit
 * decision — see the `permissions` map — or one of them stays half-covered,
 * which is the same defect this guard exists to stop.
 */

const ROOT = resolve(__dirname, '..', '..', '..', '..');

const PACKAGE_JSON = resolve(ROOT, 'package.json');
const WORKSPACE = resolve(ROOT, 'pnpm-workspace.yaml');
const CI = resolve(ROOT, '.github/workflows/ci.yml');
const E2E = resolve(ROOT, '.github/workflows/e2e-tests.yml');
const DOCKERFILES = [resolve(ROOT, 'apps/api/Dockerfile'), resolve(ROOT, 'apps/web/Dockerfile')];
const AUDIT_SCRIPT = resolve(ROOT, 'scripts/audit-deps.mjs');
const LOCKFILE = resolve(ROOT, 'pnpm-lock.yaml');

/** The pnpm major from which `allowBuilds` (this repo's key) is honoured. */
const MIN_MAJOR = 11;

/** Native builds that must be allowed, or install produces an unusable tree. */
const MUST_ALLOW = [
  '@prisma/client',
  '@prisma/engines',
  'esbuild',
  'prisma',
  'sharp',
  'unrs-resolver',
];

/**
 * The lowest override a package may carry before `Security` goes red again.
 *
 * `overrides` is a *floor*, not a pin: `>=2.3.0` still resolves to the
 * vulnerable 2.3.0, so a floor written one patch too low leaves the lockfile on
 * the vulnerable release and the required `Security` check red on every PR and
 * on `main` — the 2026-11-02 failure that blocked all 12 open PRs (#910). A
 * floor is correct only at or above the first fixed release, and this list is
 * what says so; it is the dependency-side twin of the pnpm-pin guard above.
 * When an advisory's fixed release moves, raise the floor here and in
 * `pnpm-workspace.yaml` together.
 */
const MIN_OVERRIDES: Record<string, string> = {
  'body-parser': '2.4.0', // GHSA-27r3-jxmh-p828 — DoS via trailing bytes (high)
  dompurify: '3.4.17', // GHSA-cg2g-xh64-v4q7 (critical) + GHSA-mrv2-3pqr-j5jr (high)
  'follow-redirects': '1.16.2', // GHSA-mrwp-f3q8-3g9p (high)
  multer: '2.5.0', // GHSA-q7qp-rjg7-q26m — DoS via async fileFilter (high)
};

function pinnedVersion(): string {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as { packageManager?: string };
  const match = /^pnpm@(\d+\.\d+\.\d+)$/.exec(pkg.packageManager ?? '');
  if (!match) {
    throw new Error(`package.json packageManager is not an exact pnpm pin: ${pkg.packageManager}`);
  }
  return match[1];
}

function majorOf(version: string): number {
  return Number(version.split('.')[0]);
}

/** Every `PNPM_VERSION: '<x>'` in a workflow, as written. */
function workflowPins(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/PNPM_VERSION:\s*'([^']+)'/g)].map((m) => m[1]);
}

/** Every `corepack prepare pnpm@<x> --activate` in a Dockerfile. */
function dockerfilePins(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(/corepack prepare pnpm@(\S+) --activate/g)].map((m) => m[1]);
}

function workspace(): Record<string, unknown> {
  return parse(readFileSync(WORKSPACE, 'utf8')) as Record<string, unknown>;
}

/** The versions a `packages:`/`snapshots:` map holds for `name`, peer suffix stripped. */
function lockedVersions(section: Record<string, string>, name: string): string[] {
  const prefix = `${name}@`;
  return Object.keys(section)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length).replace(/\(.*$/, ''));
}

/** Both YAML documents of the lockfile, merged per top-level map (see audit-deps). */
function lockfileMaps(): Record<string, Record<string, string>> {
  return parseAllDocuments(readFileSync(LOCKFILE, 'utf8')).reduce(
    (merged, doc) => {
      for (const [key, value] of Object.entries(doc.toJSON() ?? {})) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          merged[key] = { ...(merged[key] ?? {}), ...value };
        }
      }
      return merged;
    },
    {} as Record<string, Record<string, string>>
  );
}

/** The lower bound an override declares, or the value itself for an exact pin. */
function overrideLowerBound(declared: unknown): string {
  const match = /^\s*>=\s*(\S+)\s*$/.exec(String(declared ?? ''));
  return match ? match[1] : String(declared ?? '');
}

/** `a >= b` for release versions, compared numerically field by field. */
function versionAtLeast(version: string, floor: string): boolean {
  const fields = (v: string) => {
    const release = /^\d+(?:\.\d+)*/.exec(v)?.[0];
    return release ? release.split('.').map(Number) : null;
  };
  const a = fields(version);
  const b = fields(floor);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * Overrides whose floor sits below the first fixed release, as
 * "name: declared X, must be >= Y". Extracted so the guard below and the
 * blind-spot check share one implementation.
 */
function overrideFloorViolations(
  overrides: Record<string, unknown>,
  floors: Record<string, string> = MIN_OVERRIDES
): string[] {
  return Object.entries(floors)
    .filter(([name, floor]) => !versionAtLeast(overrideLowerBound(overrides[name]), floor))
    .map(([name, floor]) => `${name}: declared ${overrides[name]}, must be >= ${floor}`);
}

/** The version shape `scripts/audit-deps.mjs` keeps (`semver.valid`). */
const RELEASE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * How many distinct package names `scripts/audit-deps.mjs` should report: the
 * union of `packages:` across every YAML document of the lockfile, filtered to
 * real versions. It recomputes the number from the lockfile instead of pinning
 * a literal, so it stays correct as the tree grows — and, because it reads
 * **all** documents, it drops to ~15 (only the package-manager document) if the
 * script ever regresses to a single `parse()`, which is the failure the test
 * below exists to catch.
 */
function auditedPackageNames(): number {
  const docs = parseAllDocuments(readFileSync(LOCKFILE, 'utf8'));
  const packages = docs.reduce<Record<string, unknown>>((merged, doc) => {
    for (const [key, value] of Object.entries(doc.toJSON() ?? {})) {
      if (key === 'packages' && value && typeof value === 'object') {
        Object.assign(merged, value as Record<string, unknown>);
      }
    }
    return merged;
  }, {});
  const names = new Set<string>();
  for (const key of Object.keys(packages)) {
    const bare = key.replace(/\(.*$/, '');
    const at = bare.lastIndexOf('@');
    if (at <= 0 || !RELEASE_VERSION.test(bare.slice(at + 1))) continue;
    names.add(bare.slice(0, at));
  }
  return names.size;
}

describe('pnpm supply-chain control', () => {
  it('pins a pnpm that honours the build allowlist', () => {
    const version = pinnedVersion();
    expect(
      majorOf(version),
      `package.json pins pnpm ${version}; the build allowlist is only enforced from pnpm ${MIN_MAJOR}. A lower major silently runs every dependency's install scripts again.`
    ).toBeGreaterThanOrEqual(MIN_MAJOR);
  });

  it('uses the allowlist key the pinned pnpm honours, and only that key', () => {
    const version = pinnedVersion();
    const config = workspace();

    expect(
      config.onlyBuiltDependencies,
      `pnpm-workspace.yaml still carries onlyBuiltDependencies. On pnpm ${version} this key no longer grants anything; use the allowBuilds map.`
    ).toBeUndefined();

    const allow = config.allowBuilds;
    expect(allow, 'pnpm-workspace.yaml must declare an allowBuilds map').toBeTypeOf('object');
    expect(allow).not.toBeNull();
  });

  it('allows the native builds and denies the telemetry ones explicitly', () => {
    const allow = workspace().allowBuilds as Record<string, unknown>;

    const missing = MUST_ALLOW.filter((name) => allow[name] !== true);
    expect(
      missing,
      `these packages need their install scripts allowed, or install fails with ERR_PNPM_IGNORED_BUILDS: ${missing.join(', ')}`
    ).toEqual([]);

    const nonBoolean = Object.entries(allow)
      .filter(([, value]) => typeof value !== 'boolean')
      .map(([name]) => name);
    expect(nonBoolean, 'allowBuilds is a name→boolean map; a list is rejected by pnpm').toEqual([]);
  });

  it('keeps every pnpm pin equal to packageManager (workflows and Dockerfiles)', () => {
    const version = pinnedVersion();

    const ciPins = workflowPins(CI);
    const e2ePins = workflowPins(E2E);
    expect(ciPins.length, 'ci.yml declares no PNPM_VERSION').toBeGreaterThan(0);
    expect(e2ePins.length, 'e2e-tests.yml declares no PNPM_VERSION').toBeGreaterThan(0);

    const dockerPins = DOCKERFILES.flatMap(dockerfilePins);
    expect(dockerPins.length, 'the Dockerfiles declare no pnpm version').toBe(DOCKERFILES.length);

    const drift = [...ciPins, ...e2ePins, ...dockerPins].filter((pin) => pin !== version);
    expect(
      drift,
      `a pnpm pin differs from packageManager ${version}; an older pin here runs the allowlist dead. Offenders: ${drift.join(', ')}`
    ).toEqual([]);
  });

  it('keeps the overrides where pnpm 12 reads them', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as {
      pnpm?: { overrides?: unknown };
    };
    expect(
      pkg.pnpm?.overrides,
      'pnpm 12 no longer reads pnpm.overrides from package.json; move them to pnpm-workspace.yaml'
    ).toBeUndefined();

    expect(
      Object.keys((workspace().overrides as Record<string, unknown>) ?? {}).length,
      'pnpm-workspace.yaml must carry the overrides that moved out of package.json'
    ).toBeGreaterThan(0);
  });

  it('floors each overridden dependency at or above its first fixed release', () => {
    expect(
      overrideFloorViolations(workspace().overrides as Record<string, unknown>),
      'an override floor sits below the first release that fixes its advisory; ' +
        'the lockfile then keeps resolving the vulnerable version and the required Security check stays red (#910)'
    ).toEqual([]);
  });

  it('resolves every overridden dependency to at or above its fixed release', () => {
    const { packages = {}, snapshots = {} } = lockfileMaps();

    const stale = Object.entries(MIN_OVERRIDES).flatMap(([name, floor]) => {
      const resolved = [...lockedVersions(packages, name), ...lockedVersions(snapshots, name)];
      return resolved
        .filter((version) => !versionAtLeast(version, floor))
        .map((version) => `${name}@${version} (must be >= ${floor})`);
    });

    expect(
      stale,
      'the lockfile still resolves an override below its fixed release; run `pnpm install` after raising the floor'
    ).toEqual([]);
  });

  it("decides pnpm 12's second permission surface (agent skills), not just build scripts", () => {
    // pnpm 12 links a dependency's `skills/<name>/` into `.claude/skills` once
    // it is approved — a surface `allowBuilds` does not govern. Leaving it
    // "awaiting approval" forever means no decision is ever taken for the
    // third-party skill content every agent then reads, the same half-finished
    // shape `onlyBuiltDependencies` had. The `permissions` map is where the
    // decision lives; every package that ships skills needs an entry.
    const permissions = workspace().permissions as
      Record<string, Record<string, unknown>> | undefined;
    expect(
      permissions,
      'pnpm-workspace.yaml must decide the agent-skills permission surface (`permissions`), or a carrier stays silently awaiting approval'
    ).toBeTypeOf('object');

    const nonBoolean = Object.entries(permissions ?? {})
      .filter(([, entry]) => typeof (entry as Record<string, unknown>)?.skills !== 'boolean')
      .map(([name]) => name);
    expect(
      nonBoolean,
      'every permissions entry must set `skills` to a boolean (true grants, false denies)'
    ).toEqual([]);
  });

  it('leaves no dependency permission awaiting approval (skills or build)', async () => {
    // The authoritative answer, straight from the pinned pnpm. Static reading
    // of `permissions` above cannot tell whether a NEW dependency started
    // shipping skills; this does. `pnpm permissions list` needs no install —
    // it reads the config — so it runs even when node_modules is absent.
    const result = await permissionsList();
    if (result === null) {
      // pnpm is not resolvable in this process (not started through pnpm). The
      // static assertion above still guards the config; say so rather than
      // pass silently.
      expect(workspace().permissions).toBeTruthy();
      return;
    }
    expect(
      result,
      `a dependency permission is awaiting approval — decide it in pnpm-workspace.yaml -> permissions:\n${result}`
    ).not.toMatch(/Awaiting approval/);
    // And the scan is not blind: the output must be a real listing, or a
    // pnpm that failed would read as "nothing awaiting".
    expect(result, `could not read the permissions list:\n${result}`).toMatch(
      /Granted:|Denied:|No packages have been/
    );
  });

  it('the lockfile is what pnpm 12 writes (packageManagerDependencies)', () => {
    // The pin moving into the lockfile is why `--frozen-lockfile` must be
    // regenerated in the same change: an old single-document lockfile fails
    // `ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE`.
    const raw = readFileSync(LOCKFILE, 'utf8');
    expect(raw).toContain('packageManagerDependencies');
    expect(raw).toContain(`specifier: ${pinnedVersion()}`);
  });

  it('audit-deps reads the whole lockfile, not only its first document', async () => {
    // pnpm 12 splits the lockfile into two YAML documents; a plain `parse()`
    // throws MULTIPLE_DOCS. `pnpm run audit:deps` is the Security CI job, so
    // this fails the whole supply-chain check rather than one line of output.
    const result = await runAuditDeps();
    expect(result.code, `audit-deps failed:\n${result.stderr}\n${result.stdout}`).toBe(0);
    // The exact number, recomputed from the lockfile: it proves the script read
    // every document (a single `parse()` reports only the ~15 packages of the
    // package-manager document) and that it did not read zero. An anchored,
    // exact match replaces the old `not.toContain('0 packages')`, whose
    // substring also matched "1070 packages" and failed the check on any tree
    // whose package count ends in 0 (#871).
    expect(result.stdout).toContain(`Audited ${auditedPackageNames()} packages`);
  });

  it('the scan is not blind — it reads the files it guards', () => {
    // Without this a path typo would pass every assertion above, forever.
    expect(majorOf(pinnedVersion())).toBeGreaterThanOrEqual(1);
    expect(workflowPins(CI)).toContain(pinnedVersion());
    expect(workspace().allowBuilds).toBeTruthy();

    // The detection must fire on the dead configuration it exists to catch.
    const dead = parse('packages: []\nonlyBuiltDependencies:\n  - esbuild\n') as Record<
      string,
      unknown
    >;
    expect(dead.onlyBuiltDependencies).toBeDefined();
    expect(dead.allowBuilds).toBeUndefined();

    // Same for the override floors: a floor one patch below the fixed release
    // must be reported, an absent one too, and a floor at the fix must not.
    const floor = { dompurify: '3.4.17' };
    expect(overrideFloorViolations({ dompurify: '>=3.4.16' }, floor)).toContain(
      'dompurify: declared >=3.4.16, must be >= 3.4.17'
    );
    expect(overrideFloorViolations({}, floor)).toContain(
      'dompurify: declared undefined, must be >= 3.4.17'
    );
    expect(overrideFloorViolations({ dompurify: '>=3.4.17' }, floor)).toEqual([]);
    // An exact pin (as YAML writes `5.1.0`) is read the same way as a range.
    expect(overrideFloorViolations({ dompurify: '3.4.17' }, floor)).toEqual([]);

    // The lockfile scan must actually find the packages it checks; a change in
    // the lockfile key shape would otherwise make that assertion vacuous.
    const maps = lockfileMaps();
    expect(lockedVersions(maps.packages ?? {}, 'dompurify').length).toBeGreaterThan(0);
  });
});

/**
 * `pnpm permissions list` from the pinned pnpm, run from the repo root.
 *
 * `npm_execpath` is the pnpm binary when the suite was started through pnpm
 * (`pnpm --filter api test` / `test:coverage`, i.e. CI and the documented
 * local command); it is a plain `node` path under a bare `vitest run`. Either
 * way this reads the config — no install, no network — and returns null when
 * pnpm cannot be resolved, so the caller can fall back to the static check.
 */
function permissionsList(): Promise<string | null> {
  const execpath = process.env.npm_execpath;
  if (!execpath) return Promise.resolve(null);
  // Under a bare `vitest run` (no pnpm wrapper) npm_execpath is node itself;
  // there is no pnpm to ask, so fall back to the static check.
  if (/(^|[/\\])node(\.exe)?$/.test(execpath)) return Promise.resolve(null);
  // pnpm is a native binary here but a JS bundle under some setups (npm's
  // pnpm/action-setup): run the latter through node rather than exec it.
  const isScript = /\.(c?js|mjs)$/.test(execpath);
  const command = isScript ? process.execPath : execpath;
  const args = isScript ? [execpath, 'permissions', 'list'] : ['permissions', 'list'];
  try {
    return Promise.resolve(execFileSync(command, args, { cwd: ROOT, encoding: 'utf8' }));
  } catch (err) {
    return Promise.resolve(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Run the real `scripts/audit-deps.mjs` against a local stub of npm's bulk
 * advisory endpoint — the one network boundary — and return its output. The
 * lockfile is read from disk by the real code path, which is the behaviour
 * under test.
 */
function runAuditDeps(): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer((req, res) => {
      if (req.url?.endsWith('/security/advisories/bulk')) {
        req.resume();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      } else {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      const child = spawn(process.execPath, [AUDIT_SCRIPT], {
        env: { ...process.env, NPM_REGISTRY_URL: `http://127.0.0.1:${port}` },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (err) => {
        server.close();
        rejectPromise(err);
      });
      child.on('close', (code) => {
        server.close();
        resolvePromise({ code, stdout, stderr });
      });
    });
  });
}
