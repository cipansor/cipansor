import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * Behaviour `pr-lifecycle.sh` hides behind its `gh` calls, driven against a
 * stub `gh` and the real `jq`:
 *
 *  - check runs come paginated from the REST API; a failing check on a second
 *    page must still be seen (`jq -s` combines pages). Red checks leave the PR
 *    open — no comment, no draft revert;
 *  - an existing lifecycle comment is updated through the REST endpoint's
 *    numeric id — the GraphQL node id is rejected there;
 *  - a green draft PR gets its all-green notice without waiting for Analyze or
 *    CodeQL, which no checked-in workflow publishes;
 *  - a green **ready** PR dispatches the `Gerbang tinjau PR` review gate (via `curl`)
 *    rather than relying on a `ready_for_review` transition that will not come;
 *  - a changes-requested review holds the PR only while it is on the current
 *    head: once the author has pushed and the head is green, the gate is
 *    dispatched again (#727).
 *
 * Each check fails against the pre-review script and passes after it.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, '.github', 'scripts', 'pr-lifecycle.sh');
const SHA = 'abc123';

const STUB = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "$GH_STUB_LOG"; }
case "$1" in
  pr)
    case "$2" in
      view)
        case "$*" in
          *"--json state"*) printf '%s\\n' "\${GH_STUB_STATE:-OPEN}" ;;
          *"--json isDraft"*) printf '%s\\n' "\${GH_STUB_DRAFT:-false}" ;;
          *"--json reviewDecision"*) printf '%s\\n' "\${GH_STUB_REVIEW:-}" ;;
          *"--json headRefOid"*) printf '%s\\n' "\${GH_STUB_HEAD:-abc123}" ;;
          *"--json potentialMergeCommit"*) printf '%s\\n' "\${GH_STUB_MERGE:-}" ;;
          *"--json comments"*) printf '%s\\n' "\${GH_STUB_PRCOMMENTS:-}" ;;
        esac ;;
      ready) log "READY $*" ;;
      comment) log "COMMENT $*" ;;
      edit) log "EDIT $*" ;;
    esac ;;
  api)
    case "$*" in
      *check-runs*) printf '%s\\n' "\${GH_STUB_CHECKS:-}" ;;
      *"/reviews"*)
        if [ -n "\${GH_STUB_REVIEWS_FAIL:-}" ]; then echo "gh: reviews unavailable" >&2; exit 1; fi
        printf '%s\\n' "\${GH_STUB_REVIEWS:-[]}" ;;
      *"comments?per_page"*)
        printf '%s' "\${GH_STUB_COMMENTS_LIST:-[]}" \
          | jq -r '.[] | select(.body | contains("<!-- pr-lifecycle:")) | .id' ;;
      *"/issues/comments/"*)
        case "$*" in
          *"-X PATCH"*)
            case "$*" in
              *"/issues/comments/\${GH_STUB_PATCH_FAIL_ID:-none}"*) echo "gh: cannot edit" >&2; exit 1 ;;
              *) log "PATCH $*" ;;
            esac ;;
          *) printf '%s' "\${GH_STUB_OLD_COMMENT:-}" ;;
        esac ;;
    esac ;;
esac
exit 0
`;

let dir: string;
let log: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'lifecycle-guards-'));
  writeFileSync(join(dir, 'gh'), STUB, { mode: 0o755 });
  writeFileSync(join(dir, 'curl'), CURL_STUB, { mode: 0o755 });
  log = join(dir, 'calls.log');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(env: Record<string, string>, sha = SHA) {
  writeFileSync(log, '');
  const r = spawnSync('sh', [SCRIPT, '7', sha], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      REPO: 'o/r',
      GH_TOKEN: 'x',
      GH_STUB_LOG: log,
      ...env,
    },
  });
  return {
    status: r.status ?? -1,
    out: `${r.stdout}${r.stderr}`,
    calls: existsSync(log) ? readFileSync(log, 'utf8') : '',
  };
}

const CURL_STUB = `#!/bin/sh
[ -n "\${GH_STUB_LOG:-}" ] && echo "curl $*" >> "$GH_STUB_LOG"
printf '%s' "\${GH_STUB_HTTP:-200}"
`;

const REQUIRED = [
  'CI scope',
  'Lint',
  'Build',
  'Tests',
  'Security',
  'E2E scope',
  'E2E Tests (Chromium)',
];
const cr = (name: string, conclusion: string, id: number) => ({
  name,
  status: 'completed',
  conclusion,
  started_at: `2024-01-01T00:00:${String(id).padStart(2, '0')}Z`,
  id,
});
const page = (runs: ReturnType<typeof cr>[]) => JSON.stringify({ check_runs: runs });

const allGreen = page(REQUIRED.map((n, i) => cr(n, 'success', i + 1)));
// A docs-only PR: the scope jobs run and pass, every other required check is
// skipped by its own `if:`. All seven are present, none failed.
const docsSkipped = page(
  REQUIRED.map((n, i) => cr(n, /scope/.test(n) ? 'success' : 'skipped', i + 1))
);
// Every required check green while this workflow's own check and an advisory
// one are still running, as they are at the moment CI finishes.
const running = (name: string, id: number) => ({
  name,
  status: 'in_progress',
  conclusion: null as unknown as string,
  started_at: `2024-01-01T00:01:${String(id).padStart(2, '0')}Z`,
  id,
});
const greenWhileAdvisoryRuns = JSON.stringify({
  check_runs: [
    ...REQUIRED.map((n, i) => cr(n, 'success', i + 1)),
    running('lifecycle', 50),
    running('PR template reminder', 51),
  ],
});
// A required check still running: the gate must wait for it.
const requiredStillRuns = JSON.stringify({
  check_runs: [
    ...REQUIRED.filter((n) => n !== 'E2E Tests (Chromium)').map((n, i) => cr(n, 'success', i + 1)),
    running('E2E Tests (Chromium)', 52),
  ],
});
// Two pages: the failing Tests run is only on the second.
const paginatedRed =
  page(REQUIRED.filter((n) => n !== 'Tests').map((n, i) => cr(n, 'success', i + 1))) +
  '\n' +
  page([cr('Tests', 'failure', 999)]);
// Every required check green, but an advisory workflow's check failed.
const advisoryRed = page([
  ...REQUIRED.map((n, i) => cr(n, 'success', i + 1)),
  cr('PR template reminder', 'failure', 888),
]);

describe('pr-lifecycle.sh', () => {
  it('leaves a ready PR open when a failing check is on the second page', () => {
    const { calls, out } = run({
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'false',
      GH_STUB_HEAD: SHA,
      GH_STUB_CHECKS: paginatedRed,
    });
    expect(calls).not.toContain('READY');
    expect(calls).not.toContain('--undo');
    expect(out).toContain('failing checks');
  });

  it('updates an existing lifecycle comment through its numeric id', () => {
    const { calls } = run({
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'true',
      GH_STUB_HEAD: SHA,
      GH_STUB_CHECKS: allGreen,
      GH_STUB_COMMENTS_LIST: '[{"id":4242,"body":"old <!-- pr-lifecycle:green -->"}]',
      GH_STUB_OLD_COMMENT: 'an older lifecycle comment',
    });
    expect(calls).toContain('PATCH');
    expect(calls).toContain('/issues/comments/4242');
  });

  it('updates the newest editable comment instead of stacking a notice', () => {
    const { calls } = run({
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'true',
      GH_STUB_HEAD: SHA,
      GH_STUB_CHECKS: allGreen,
      // The oldest marker (100) cannot be edited; a newer one (200) can. The old
      // code always retried the first match (100), failed, and posted a fresh
      // comment every run — stacking notices. The guard must skip the
      // uneditable one and edit 200, without posting anything.
      GH_STUB_COMMENTS_LIST:
        '[{"id":100,"body":"old <!-- pr-lifecycle:green -->"},{"id":200,"body":"newer <!-- pr-lifecycle:green -->"}]',
      GH_STUB_OLD_COMMENT: 'a stale lifecycle comment',
      GH_STUB_PATCH_FAIL_ID: '100',
    });
    expect(calls).toContain('/issues/comments/200');
    expect(calls).not.toContain('/issues/comments/100');
    expect(calls).not.toContain('COMMENT');
  });

  it('posts the all-green notice for a green draft without Analyze/CodeQL', () => {
    const { calls } = run({
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'true',
      GH_STUB_HEAD: SHA,
      GH_STUB_CHECKS: allGreen,
      GH_STUB_COMMENTS_LIST: '[]',
    });
    expect(calls).toContain('COMMENT');
    expect(calls).toContain('pr-lifecycle:green');
  });

  it('does nothing for a stale run whose sha is not the PR head', () => {
    const { calls } = run({
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'false',
      GH_STUB_HEAD: 'othersha',
      GH_STUB_CHECKS: paginatedRed,
    });
    expect(calls).not.toContain('READY');
  });

  it('does not draft a ready PR for a failed advisory check', () => {
    const { calls, out } = run({
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'false',
      GH_STUB_HEAD: SHA,
      GH_STUB_CHECKS: advisoryRed,
    });
    expect(calls).not.toContain('READY');
    expect(out).toContain('Ignoring non-gate check');
  });

  it('posts no comment on a red lifecycle run', () => {
    const { calls } = run({
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'false',
      GH_STUB_HEAD: SHA,
      GH_STUB_CHECKS: paginatedRed,
      GH_STUB_COMMENTS_LIST: '[]',
    });
    expect(calls).not.toContain('COMMENT');
  });

  it('posts no comment on a changes-requested review', () => {
    const { calls } = run({
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'false',
      GH_STUB_REVIEW: 'CHANGES_REQUESTED',
      GH_STUB_HEAD: SHA,
      GH_STUB_CHECKS: allGreen,
      GH_STUB_COMMENTS_LIST: '[]',
    });
    expect(calls).not.toContain('COMMENT');
    expect(calls).not.toContain('READY');
  });

  describe('after the gate requested changes', () => {
    // Reviews carry their author: the script tells "the gate already reviewed
    // this PR" from "never reviewed" by `.user.login`.
    const requested = (commit: string) =>
      JSON.stringify([
        { state: 'COMMENTED', commit_id: 'old000', user: { login: 'cipansor-bot' } },
        { state: 'CHANGES_REQUESTED', commit_id: commit, user: { login: 'cipansor-bot' } },
      ]);
    const base = {
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'false',
      GH_STUB_REVIEW: 'CHANGES_REQUESTED',
      GH_STUB_HEAD: SHA,
      GH_STUB_COMMENTS_LIST: '[]',
      OPENHANDS_API_KEY: 'key',
      GH_STUB_HTTP: '200',
    };

    it('waits for fixes while the request is on the current head', () => {
      const { calls, out } = run({
        ...base,
        GH_STUB_CHECKS: allGreen,
        GH_STUB_REVIEWS: requested(SHA),
      });
      expect(calls).not.toContain('curl');
      expect(out).toContain('leaving it open for fixes');
    });

    it('does not send a green head pushed after the request back to the gate on its own', () => {
      // The gate's automatic pass is the first review only. It already reviewed
      // this PR (changes requested), so a new green head is reviewed only when
      // the author asks again by hand: no dispatch, just the re-review notice.
      const { calls, out } = run({
        ...base,
        GH_STUB_CHECKS: allGreen,
        GH_STUB_REVIEWS: requested('fff111'),
      });
      expect(calls).not.toContain('/dispatch');
      expect(out).toContain('not re-dispatching');
      expect(out).toContain('manual re-request required');
    });

    it('does not dispatch while that newer head is red', () => {
      const { calls } = run({
        ...base,
        GH_STUB_CHECKS: paginatedRed,
        GH_STUB_REVIEWS: requested('fff111'),
      });
      expect(calls).not.toContain('curl');
    });
  });

  it('dispatches the review gate for a green ready PR', () => {
    const { calls } = run({
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'false',
      GH_STUB_HEAD: SHA,
      GH_STUB_CHECKS: allGreen,
      GH_STUB_COMMENTS_LIST: '[]',
      OPENHANDS_API_KEY: 'key',
      GH_STUB_HTTP: '200',
    });
    expect(calls).toContain('curl');
    expect(calls).toContain('96eebf19-b64b-4035-9653-2d8b15b06ac4/dispatch');
  });

  it('does not re-dispatch a green ready PR the gate has already reviewed, and points at a manual re-review', () => {
    // The automatic pass is the first review only: once the gate has reviewed
    // the PR, a later green head must not be dispatched again. The author is
    // told to request a re-review by hand instead (#837).
    const { calls, out } = run({
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'false',
      GH_STUB_HEAD: SHA,
      GH_STUB_CHECKS: allGreen,
      GH_STUB_COMMENTS_LIST: '[]',
      GH_STUB_REVIEWS: JSON.stringify([
        { state: 'CHANGES_REQUESTED', commit_id: 'old000', user: { login: 'cipansor-bot' } },
      ]),
      OPENHANDS_API_KEY: 'key',
      GH_STUB_HTTP: '200',
    });
    expect(calls).not.toContain('/dispatch');
    expect(out).toContain('not re-dispatching');
    expect(out).toContain('manual re-request required');
  });

  it('stays quiet when the gate already reviewed the current head', () => {
    // Nothing is owed: an approval is final, and a request for changes waits on
    // the author. No dispatch, no re-review notice.
    const { calls, out } = run({
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'false',
      GH_STUB_HEAD: SHA,
      GH_STUB_CHECKS: allGreen,
      GH_STUB_COMMENTS_LIST: '[]',
      GH_STUB_REVIEWS: JSON.stringify([
        { state: 'CHANGES_REQUESTED', commit_id: SHA, user: { login: 'cipansor-bot' } },
      ]),
      OPENHANDS_API_KEY: 'key',
      GH_STUB_HTTP: '200',
    });
    expect(calls).not.toContain('/dispatch');
    expect(calls).not.toContain('COMMENT');
    expect(out).toContain('already reviewed by the gate');
  });

  it('does not dispatch when the review list cannot be read', () => {
    // A failed read is not "never reviewed": dispatching then would re-review a
    // PR the gate already saw.
    const { calls, out } = run({
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'false',
      GH_STUB_HEAD: SHA,
      GH_STUB_CHECKS: allGreen,
      GH_STUB_COMMENTS_LIST: '[]',
      GH_STUB_REVIEWS_FAIL: '1',
      OPENHANDS_API_KEY: 'key',
      GH_STUB_HTTP: '200',
    });
    expect(calls).not.toContain('/dispatch');
    expect(out).toContain('reviews unreadable');
  });

  it('dispatches the review gate for a ready docs PR whose code checks are skipped', () => {
    const { calls } = run({
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'false',
      GH_STUB_HEAD: SHA,
      GH_STUB_CHECKS: docsSkipped,
      GH_STUB_COMMENTS_LIST: '[]',
      OPENHANDS_API_KEY: 'key',
      GH_STUB_HTTP: '200',
    });
    expect(calls).toContain('96eebf19-b64b-4035-9653-2d8b15b06ac4/dispatch');
  });

  it('dispatches while only advisory checks are still running', () => {
    // At the moment CI finishes, this workflow's own `lifecycle` check is in
    // progress; counting it held every dispatch until the next run (#708).
    const { calls } = run({
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'false',
      GH_STUB_HEAD: SHA,
      GH_STUB_CHECKS: greenWhileAdvisoryRuns,
      GH_STUB_COMMENTS_LIST: '[]',
      OPENHANDS_API_KEY: 'key',
      GH_STUB_HTTP: '200',
    });
    expect(calls).toContain('96eebf19-b64b-4035-9653-2d8b15b06ac4/dispatch');
  });

  it('waits while a required check is still running', () => {
    const { calls } = run({
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'false',
      GH_STUB_HEAD: SHA,
      GH_STUB_CHECKS: requiredStillRuns,
      GH_STUB_COMMENTS_LIST: '[]',
      OPENHANDS_API_KEY: 'key',
      GH_STUB_HTTP: '200',
    });
    expect(calls).not.toContain('/dispatch');
  });

  it('does not report a refused dispatch as dispatched', () => {
    // curl exits 0 on a 401; only the status code tells the two apart.
    const { out } = run({
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'false',
      GH_STUB_HEAD: SHA,
      GH_STUB_CHECKS: allGreen,
      GH_STUB_COMMENTS_LIST: '[]',
      OPENHANDS_API_KEY: 'key',
      GH_STUB_HTTP: '401',
    });
    expect(out).not.toContain('Dispatched review gate');
    expect(out).toContain('::warning::Review-gate dispatch for PR #');
    expect(out).toContain('HTTP 401');
  });

  it('carries no AI-disclosure footer on the all-green notice', () => {
    const { calls } = run({
      GH_STUB_STATE: 'OPEN',
      GH_STUB_DRAFT: 'true',
      GH_STUB_HEAD: SHA,
      GH_STUB_CHECKS: allGreen,
      GH_STUB_COMMENTS_LIST: '[]',
    });
    // The anti-loop guard is the comment's author (`cipansor-bot`), not a footer.
    expect(calls).not.toContain('This comment was created by an AI agent');
  });
});
