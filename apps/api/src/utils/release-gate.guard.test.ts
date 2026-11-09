import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * Behaviour `release-gate.sh` hides, driven against stub `gh` and `curl`:
 *
 *  - a truncated SHA is refused before anything else (the full SHA is the image
 *    tag and what /health reports, so a short one matches neither);
 *  - a tag that is not a plain `vX.Y.Z` is refused: SDLC 13's `-rc` tags are
 *    retired, and shipping a candidate by accident is the failure to prevent;
 *  - `MODE=rollback` skips the staging and load-test checks by design, because a
 *    rollback target is an older commit staging no longer serves;
 *  - a SHA staging does not serve is refused — a release may only ship what
 *    staging has actually run;
 *  - a SHA with no green `load-tests.yml` run is refused — the load test is not
 *    part of CI, so its absence is otherwise invisible;
 *  - the happy path passes, and the gate never decides whether a release SHOULD
 *    happen (it only reads facts).
 *
 * The stubs keep the test hermetic; the real `gh`/`curl` paths are exercised by
 * the workflow itself.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, '.github', 'scripts', 'release-gate.sh');
const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'deploy-production.yml');

const GH_STUB = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "$GH_STUB_LOG"; }
case "$1" in
  run)
    case "$2" in
      list) log "RUN LIST"; printf '%s\\n' "\${GH_STUB_RUNS:-[]}" ;;
    esac ;;
esac
exit 0
`;

// Prints whatever commit the test says staging reports.
const CURL_STUB = `#!/bin/sh
printf '{"status":"ok","commit":"%s"}\\n' "\${GH_STUB_STAGING_COMMIT:-}"
exit 0
`;

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

let dir: string;
let log: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'release-gate-'));
  writeFileSync(join(dir, 'gh'), GH_STUB, { mode: 0o755 });
  writeFileSync(join(dir, 'curl'), CURL_STUB, { mode: 0o755 });
  log = join(dir, 'calls.log');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(env: Record<string, string>) {
  writeFileSync(log, '');
  const r = spawnSync('sh', [SCRIPT], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      REPO: 'o/r',
      GH_TOKEN: 'x',
      GH_STUB_LOG: log,
      // vitest sets MODE in the environment; pin it so the script's own default
      // (release) is what the tests exercise unless a case overrides it.
      MODE: 'release',
      // The gate retries the staging probe with a 10s sleep between attempts; a
      // test must not sit through that. The default (3) is exercised in
      // production, where a slightly stale /healthz is worth waiting out.
      LOAD_PROBE_ATTEMPTS: '1',
      ...env,
    },
  });
  return {
    status: r.status ?? -1,
    out: `${r.stdout}${r.stderr}`,
    calls: existsSync(log) ? readFileSync(log, 'utf8') : '',
  };
}

const greenRun = (sha: string) =>
  JSON.stringify([
    { headSha: sha, conclusion: 'success', createdAt: '2026-11-01T00:00:00Z', url: 'u' },
  ]);

describe('release-gate.sh', () => {
  it('refuses a SHA that is not 40 lowercase hex characters', () => {
    const short = run({ SHA: 'abc123' });
    expect(short.status).not.toBe(0);
    expect(short.out).toContain('sha must be 40 characters');
    // Nothing else was consulted: the shape is checked first.
    expect(short.calls).not.toContain('RUN LIST');
  });

  it('refuses a SHA staging is not serving', () => {
    const { status, out } = run({
      SHA,
      GH_STUB_STAGING_COMMIT: OTHER,
      GH_STUB_RUNS: greenRun(SHA),
    });
    expect(status).not.toBe(0);
    expect(out).toContain('not');
    expect(out).toContain('deploy-staging.yml');
  });

  it('refuses a SHA with no green load-test run', () => {
    const { status, out } = run({
      SHA,
      GH_STUB_STAGING_COMMIT: SHA,
      GH_STUB_RUNS: JSON.stringify([
        { headSha: SHA, conclusion: 'failure', createdAt: 'x', url: 'u' },
      ]),
    });
    expect(status).not.toBe(0);
    expect(out).toContain('load-tests.yml');
    expect(out).toContain('skip the load test');
  });

  it('refuses when the load-test runs cannot be read at all', () => {
    // A gate that reads nothing must refuse, not pass by default.
    const { status, out } = run({
      SHA,
      GH_STUB_STAGING_COMMIT: SHA,
      GH_STUB_RUNS: '',
    });
    expect(status).not.toBe(0);
    expect(out).toContain('could not read');
  });

  it('passes when staging serves the SHA and a load-test run is green', () => {
    const { status, out } = run({
      SHA,
      GH_STUB_STAGING_COMMIT: SHA,
      GH_STUB_RUNS: greenRun(SHA),
    });
    expect(status).toBe(0);
    expect(out).toContain('Release gate passed');
  });

  it('ignores a green run on a different SHA', () => {
    const { status } = run({
      SHA,
      GH_STUB_STAGING_COMMIT: SHA,
      GH_STUB_RUNS: greenRun(OTHER),
    });
    expect(status).not.toBe(0);
  });

  it('refuses a tag that is not a plain vX.Y.Z release', () => {
    for (const tag of ['v0.2.0-rc1', 'v0.2.0-beta', 'release-0.2.0', 'v0.2', 'v0.2.0.1']) {
      const { status, out } = run({
        SHA,
        TAG: tag,
        GH_STUB_STAGING_COMMIT: SHA,
        GH_STUB_RUNS: greenRun(SHA),
      });
      expect(status, `${tag} must be refused`).not.toBe(0);
      expect(out, `${tag}`).toContain('Release gate');
    }
  });

  it('accepts a plain vX.Y.Z tag shape', () => {
    // The tag itself is only shape-checked here; the on-main ancestry check runs
    // against a real checkout in the workflow, which this hermetic test cannot
    // provide, so it is exercised by the gate job itself.
    const { out } = run({
      SHA,
      TAG: 'v0.2.0',
      GH_STUB_STAGING_COMMIT: SHA,
      GH_STUB_RUNS: greenRun(SHA),
    });
    // It must get past the tag shape check (the ancestry check may still stop it).
    expect(out).not.toContain('not a release tag');
    expect(out).not.toContain('prerelease suffix');
  });

  it('skips the staging and load-test checks in rollback mode', () => {
    // A rollback is a human act on an older SHA; staging serves a newer one and
    // the load test is long past, so requiring them would block rollback exactly
    // when it is needed. The deploy job still refuses unbuilt images.
    const { status, out, calls } = run({
      SHA,
      MODE: 'rollback',
      GH_STUB_STAGING_COMMIT: OTHER,
      GH_STUB_RUNS: '[]',
    });
    expect(status).toBe(0);
    expect(out).toContain('Rollback mode');
    expect(calls).not.toContain('RUN LIST');
  });

  it('refuses an unknown MODE rather than guessing', () => {
    const { status, out } = run({ SHA, MODE: 'yolo' });
    expect(status).not.toBe(0);
    expect(out).toContain("MODE must be 'release' or 'rollback'");
  });

  it('is wired into deploy-production as a job the deploy waits on', () => {
    // The gate is only a gate if the deploy cannot start without it.
    const wf = readFileSync(WORKFLOW, 'utf8');
    expect(wf).toContain('release-gate.sh');
    expect(wf).toMatch(/gate:/);
    expect(wf).toMatch(/needs:\s*gate/);
    // Reading workflow runs needs the scope, and the gate must not require the
    // production environment (it touches no Azure identity).
    expect(wf).toMatch(/actions:\s*read/);
    // The trigger is a tag push, and the dispatch survives only for rollback.
    expect(wf).toContain("tags: ['v*']");
    expect(wf).toContain('Rollback only');
    expect(wf).toMatch(/MODE:/);
    // Full history, so the gate can ask whether the tag's commit is on main.
    expect(wf).toContain('fetch-depth: 0');
  });
});
