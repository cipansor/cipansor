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

  it('is wired into deploy-production as a job the deploy waits on', () => {
    // The gate is only a gate if the deploy cannot start without it.
    const wf = readFileSync(WORKFLOW, 'utf8');
    expect(wf).toContain('release-gate.sh');
    expect(wf).toMatch(/gate:/);
    expect(wf).toMatch(/needs:\s*gate/);
    // Reading workflow runs needs the scope, and the gate must not require the
    // production environment (it touches no Azure identity).
    expect(wf).toMatch(/actions:\s*read/);
  });
});
