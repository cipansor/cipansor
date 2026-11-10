import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * Behaviour `release-gate.sh` hides, driven against stub `gh` and `curl` and a
 * throwaway git repository:
 *
 *  - a truncated SHA is refused before anything else (the full SHA is the image
 *    tag and what /health reports, so a short one matches neither);
 *  - a tag that is not a plain `vX.Y.Z` is refused: SDLC 13's `-rc` tags are
 *    retired, and shipping a candidate by accident is the failure to prevent;
 *  - a tag whose commit is not on `main` is refused — nothing off-branch is
 *    releasable;
 *  - a SHA staging does not serve is refused — a release may only ship what
 *    staging has actually run;
 *  - a green `load-tests.yml` run proves nothing about WHERE it measured, so the
 *    gate requires the run's title to name staging;
 *  - `MODE=rollback` skips staging and the load test by design, but still
 *    requires the target to be a commit `main` carried;
 *  - the happy path passes, and the gate never decides whether a release SHOULD
 *    happen (it only reads facts).
 *
 * The ancestry checks run `git` against a temporary repository (via `GIT_DIR`),
 * not the clone the test itself runs in: CI checks out with `fetch-depth: 1`, so
 * a test that relied on the real `origin/main` would depend on history the
 * runner does not have. The stubs keep the rest hermetic.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, '.github', 'scripts', 'release-gate.sh');
const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'deploy-production.yml');
const LOAD_WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'load-tests.yml');

const GH_STUB = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "$GH_STUB_LOG"; }
case "$1" in
  run)
    case "$2" in
      list) log "RUN LIST"; printf '%s\\n' "\${GH_STUB_RUNS:-[]}" ;;
    esac ;;
  api)
    # The actor-permission lookup. The test decides what the API returns; an
    # unset value means the API could not be read, which the gate must refuse.
    log "API $2"
    if [ -n "\${GH_STUB_ACTOR_PERM:-}" ]; then printf '%s\\n' "\${GH_STUB_ACTOR_PERM}"; fi ;;
esac
exit 0
`;

// Prints whatever commit the test says staging reports.
const CURL_STUB = `#!/bin/sh
printf '{"status":"ok","commit":"%s"}\\n' "\${GH_STUB_STAGING_COMMIT:-}"
exit 0
`;

const STAGING_URL = 'https://staging.cipansor.or.id';
// A green run whose title names the staging target — the shape the gate accepts.
const greenRun = (sha: string, title = `k6 public-smoke (smoke) vs ${STAGING_URL}`) =>
  JSON.stringify([
    {
      headSha: sha,
      conclusion: 'success',
      createdAt: '2026-11-01T00:00:00Z',
      url: 'u',
      displayTitle: title,
    },
  ]);

let dir: string;
let repo: string;
let log: string;
// A real commit on `main`, and a real commit `main` never contained. The gate's
// ancestry checks need genuine SHAs, not placeholders.
let onMain: string;
let offMain: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'release-gate-'));
  writeFileSync(join(dir, 'gh'), GH_STUB, { mode: 0o755 });
  writeFileSync(join(dir, 'curl'), CURL_STUB, { mode: 0o755 });
  log = join(dir, 'calls.log');

  repo = mkdtempSync(join(tmpdir(), 'release-gate-repo-'));
  const git = (...args: string[]) =>
    spawnSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    });
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'one');
  onMain = git('rev-parse', 'HEAD').stdout.trim();
  git('tag', 'v0.2.0'); // a clean release tag, pointing at main
  // A commit main never contained, and a well-formed tag pointing at it: the
  // case the tag-ancestry check exists for.
  git('checkout', '-q', '-b', 'side');
  git('commit', '-q', '--allow-empty', '-m', 'side');
  offMain = git('rev-parse', 'HEAD').stdout.trim();
  git('tag', 'v9.9.9');
  git('checkout', '-q', 'main');
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

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
      // Run `git` against the throwaway repo, and treat its `main` as the ref a
      // release must be an ancestor of (the default is `origin/main`).
      GIT_DIR: join(repo, '.git'),
      MAIN_REF: 'main',
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
      SHA: onMain,
      GH_STUB_STAGING_COMMIT: offMain,
      GH_STUB_RUNS: greenRun(onMain),
    });
    expect(status).not.toBe(0);
    expect(out).toContain('not');
    expect(out).toContain('deploy-staging.yml');
  });

  it('refuses a SHA with no green load-test run', () => {
    const { status, out } = run({
      SHA: onMain,
      GH_STUB_STAGING_COMMIT: onMain,
      GH_STUB_RUNS: JSON.stringify([
        {
          headSha: onMain,
          conclusion: 'failure',
          createdAt: 'x',
          url: 'u',
          displayTitle: `k6 public-smoke (smoke) vs ${STAGING_URL}`,
        },
      ]),
    });
    expect(status).not.toBe(0);
    expect(out).toContain('load-tests.yml');
    expect(out).toContain('skip the load test');
  });

  it('refuses a green load-test run that did not target staging', () => {
    // The `url` input is free-form: a green run against a throwaway host proves
    // nothing about staging, so the gate must read the run's target back.
    const { status, out } = run({
      SHA: onMain,
      GH_STUB_STAGING_COMMIT: onMain,
      GH_STUB_RUNS: greenRun(onMain, 'k6 public-smoke (smoke) vs https://example.test'),
    });
    expect(status).not.toBe(0);
    expect(out).toContain('does not prove staging');
  });

  it('refuses a green run whose title embeds the staging URL in another host', () => {
    // A substring test would accept this: the staging URL appears in the query,
    // but k6 only ever contacts `example.test`.
    const { status, out } = run({
      SHA: onMain,
      GH_STUB_STAGING_COMMIT: onMain,
      GH_STUB_RUNS: greenRun(
        onMain,
        'k6 public-smoke (smoke) vs https://example.test/?next=https://staging.cipansor.or.id'
      ),
    });
    expect(status).not.toBe(0);
    expect(out).toContain('does not prove staging');
  });

  it('refuses a green run whose title names staging alongside another host', () => {
    // More than one authority in the title means the run measured more than
    // staging, so it cannot stand as staging's load test.
    const { status } = run({
      SHA: onMain,
      GH_STUB_STAGING_COMMIT: onMain,
      GH_STUB_RUNS: greenRun(
        onMain,
        'k6 public-smoke (smoke) vs https://example.test vs https://staging.cipansor.or.id'
      ),
    });
    expect(status).not.toBe(0);
  });

  it('accepts a green run whose title names the staging host in any case', () => {
    // A hostname is case-insensitive; the comparison must be too, or a valid run
    // written in capitals would be refused.
    const { status } = run({
      SHA: onMain,
      GH_STUB_STAGING_COMMIT: onMain,
      GH_STUB_RUNS: greenRun(onMain, 'k6 public-smoke (smoke) vs https://STAGING.CIPANSOR.OR.ID'),
    });
    expect(status).toBe(0);
  });

  it('refuses when the load-test runs cannot be read at all', () => {
    // A gate that reads nothing must refuse, not pass by default.
    const { status, out } = run({
      SHA: onMain,
      GH_STUB_STAGING_COMMIT: onMain,
      GH_STUB_RUNS: '',
    });
    expect(status).not.toBe(0);
    expect(out).toContain('could not read');
  });

  it('passes when staging serves the SHA and a load-test run is green against it', () => {
    const { status, out } = run({
      SHA: onMain,
      GH_STUB_STAGING_COMMIT: onMain,
      GH_STUB_RUNS: greenRun(onMain),
    });
    expect(status).toBe(0);
    expect(out).toContain('Release gate passed');
  });

  it('ignores a green run on a different SHA', () => {
    const { status } = run({
      SHA: onMain,
      GH_STUB_STAGING_COMMIT: onMain,
      GH_STUB_RUNS: greenRun(offMain),
    });
    expect(status).not.toBe(0);
  });

  it('refuses a tag that is not a plain vX.Y.Z release', () => {
    for (const tag of ['v0.2.0-rc1', 'v0.2.0-beta', 'release-0.2.0', 'v0.2', 'v0.2.0.1']) {
      const { status, out } = run({
        SHA: onMain,
        TAG: tag,
        ACTOR: 'maint',
        GH_STUB_ACTOR_PERM: 'admin',
        GH_STUB_STAGING_COMMIT: onMain,
        GH_STUB_RUNS: greenRun(onMain),
      });
      expect(status, `${tag} must be refused`).not.toBe(0);
      expect(out, `${tag}`).toContain('Release gate');
    }
  });

  it('accepts a plain vX.Y.Z tag on main', () => {
    const { status, out } = run({
      SHA: onMain,
      TAG: 'v0.2.0',
      ACTOR: 'maint',
      GH_STUB_ACTOR_PERM: 'admin',
      GH_STUB_STAGING_COMMIT: onMain,
      GH_STUB_RUNS: greenRun(onMain),
    });
    expect(out).toContain('is an official release on main');
    expect(status).toBe(0);
  });

  it('refuses a tag pushed by an actor without admin permission', () => {
    // Write access is enough to push a `v*` tag, and the repository has no tag
    // ruleset, so the gate must check the pusher's permission itself.
    const { status, out } = run({
      SHA: onMain,
      TAG: 'v0.2.0',
      ACTOR: 'outsider',
      GH_STUB_ACTOR_PERM: 'write',
      GH_STUB_STAGING_COMMIT: onMain,
      GH_STUB_RUNS: greenRun(onMain),
    });
    expect(status).not.toBe(0);
    expect(out).toContain('only a maintainer (admin) may release');
  });

  it('refuses a tag when the pusher permission cannot be read', () => {
    const { status, out } = run({
      SHA: onMain,
      TAG: 'v0.2.0',
      ACTOR: 'maint',
      // GH_STUB_ACTOR_PERM unset: the API returned nothing.
      GH_STUB_STAGING_COMMIT: onMain,
      GH_STUB_RUNS: greenRun(onMain),
    });
    expect(status).not.toBe(0);
    expect(out).toContain('could not read the repository permission');
  });

  it('refuses a rollback dispatch by an actor without admin permission', () => {
    // A rollback has no tag, but `workflow_dispatch` needs only write access —
    // the same permission the gate refuses for a tag push — and it changes what
    // production runs. So the maintainer check applies here too: without it a
    // writer could roll production back to any old `main` SHA.
    const { status, out } = run({
      SHA: onMain,
      MODE: 'rollback',
      ACTOR: 'outsider',
      GH_STUB_ACTOR_PERM: 'write',
    });
    expect(status).not.toBe(0);
    expect(out).toContain('only a maintainer (admin) may roll back production');
  });

  it('allows a rollback dispatch by a maintainer', () => {
    const { status, out } = run({
      SHA: onMain,
      MODE: 'rollback',
      ACTOR: 'maint',
      GH_STUB_ACTOR_PERM: 'admin',
    });
    expect(status).toBe(0);
    expect(out).toContain('Rollback was triggered by maintainer');
  });

  it('refuses a release tag pointing at a commit off main', () => {
    // A well-formed `vX.Y.Z` tag whose commit main never contained is not
    // releasable, even if staging happens to serve it.
    const { status, out } = run({
      SHA: offMain,
      TAG: 'v9.9.9',
      ACTOR: 'maint',
      GH_STUB_ACTOR_PERM: 'admin',
      GH_STUB_STAGING_COMMIT: offMain,
      GH_STUB_RUNS: greenRun(offMain),
    });
    expect(status).not.toBe(0);
    expect(out).toContain('does not point at a commit on main');
  });

  it('skips the staging and load-test checks in rollback mode', () => {
    // A rollback is a human act on an older SHA; staging serves a newer one and
    // the load test is long past, so requiring them would block rollback exactly
    // when it is needed. The deploy job still refuses unbuilt images.
    const { status, out, calls } = run({
      SHA: onMain,
      MODE: 'rollback',
      GH_STUB_STAGING_COMMIT: offMain,
      GH_STUB_RUNS: '[]',
    });
    expect(status).toBe(0);
    expect(out).toContain('Rollback mode');
    expect(calls).not.toContain('RUN LIST');
  });

  it('refuses a rollback SHA that is not a commit on main', () => {
    // A rollback skips staging and the load test, but must stay inside released
    // history: otherwise a dispatcher could point production at unreviewed code.
    const { status, out } = run({
      SHA: offMain,
      MODE: 'rollback',
    });
    expect(status).not.toBe(0);
    expect(out).toContain('not a commit on main');
  });

  it('refuses an unknown MODE rather than guessing', () => {
    const { status, out } = run({ SHA: onMain, MODE: 'yolo' });
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
    // The target the load test must have measured is wired in, or a green run
    // against any host would satisfy the gate.
    expect(wf).toMatch(/LOAD_URL:/);
  });

  it('names the load-test target in the run title the gate reads back', () => {
    // The gate trusts this title as proof of WHERE the load test measured, so it
    // must be built from the same `url` input the runner uses.
    const wf = readFileSync(LOAD_WORKFLOW, 'utf8');
    expect(wf).toMatch(/^run-name:.*\$\{\{\s*inputs\.url/m);
    expect(wf).toContain("inputs.url || 'https://staging.cipansor.or.id'");
  });
});
