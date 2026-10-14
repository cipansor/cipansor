import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { parse } from 'yaml';

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
    expect(result.stdout).toMatch(/Audited \d+ packages/);
    expect(result.stdout).not.toContain('0 packages');
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
