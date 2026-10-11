import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * `gate-watch.sh` (#776) against a stub `gh` that serves JSON fixtures and runs
 * each call's real `--jq` expression through `jq`, so the filters the script
 * relies on — not a draft, the gate's login, the head commit — are exercised
 * too, not just the shell around them.
 *
 * A ready PR whose head checks all finished green more than an hour ago and
 * that the gate has not reviewed is flagged once, and the one health issue
 * lists it; anything else is left alone.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, '.github', 'scripts', 'gate-watch.sh');
const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'gate-watch.yml');

const STUB = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "$GH_STUB_LOG"; }
JQ=""; prev=""
for a in "$@"; do [ "$prev" = "--jq" ] && JQ="$a"; prev="$a"; done
emit() { if [ -n "$JQ" ]; then printf '%s' "$1" | jq -r "$JQ"; else printf '%s\\n' "$1"; fi; }
bodyof() { prev=""; for a in "$@"; do
  [ "$prev" = "--body-file" ] && cat "$a"
  [ "$prev" = "-F" ] && case "$a" in body=@*) cat "\${a#body=@}" ;; esac
  prev="$a"; done; }
case "$1" in
  pr)
    case "$2" in
      list) emit "\${GH_STUB_PRS:-[]}" ;;
      comment) log "PCOMMENT $3"; log "PBODY $(bodyof "$@")" ;;
    esac ;;
  issue)
    case "$2" in
      create) log "CREATE"; bodyof "$@" > "$GH_STUB_DIR/created"; echo "https://github.com/o/r/issues/900" ;;
      comment) log "ICOMMENT $3"; log "IBODY $(bodyof "$@")" ;;
    esac ;;
  api)
    case "$*" in
      *"-X PATCH"*) log "PATCH $*"; bodyof "$@" > "$GH_STUB_DIR/patched" ;;
      *"/reviews"*)
        n=$(printf '%s\\n' "$*" | sed -n 's|.*/pulls/\\([0-9]*\\)/reviews.*|\\1|p')
        [ "\${GH_STUB_REVIEWS_FAIL:-}" = "$n" ] && exit 1
        eval "v=\\\${GH_STUB_REVIEWS_$n:-[]}"; emit "$v" ;;
      *"/check-runs"*)
        s=$(printf '%s\\n' "$*" | sed -n 's|.*/commits/\\([0-9a-f]*\\)/check-runs.*|\\1|p')
        eval "v=\\\${GH_STUB_RUNS_$s:-}"; emit "\${v:-{\\"check_runs\\":[]}}" ;;
      *"/comments"*)
        n=$(printf '%s\\n' "$*" | sed -n 's|.*/issues/\\([0-9]*\\)/comments.*|\\1|p')
        eval "v=\\\${GH_STUB_COMMENTS_$n:-[]}"; emit "$v" ;;
      *"issues?state=open"*) emit "\${GH_STUB_OPEN_ISSUES:-[]}" ;;
      *"/issues/"*) emit "\${GH_STUB_ISSUE_JSON:-{}}" ;;
    esac ;;
esac
exit 0
`;

// The re-dispatch: logs the call and its payload, answers GH_STUB_CURL_CODE.
const CURL = `#!/bin/sh
prev=""; for a in "$@"; do [ "$prev" = "-d" ] && echo "CURL $*" "PAYLOAD $a" >> "$GH_STUB_LOG"; prev="$a"; done
printf '%s' "\${GH_STUB_CURL_CODE:-202}"
`;

let dir: string;
let log: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'gate-watch-'));
  writeFileSync(join(dir, 'gh'), STUB, { mode: 0o755 });
  writeFileSync(join(dir, 'curl'), CURL, { mode: 0o755 });
  log = join(dir, 'calls.log');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const NOW = 1_760_150_000;
const HEAD = 'abc123def456';
const ago = (minutes: number) => new Date((NOW - minutes * 60) * 1000).toISOString();

const runs = (...list: Array<[string, string | null, string | null]>) =>
  JSON.stringify({
    check_runs: list.map(([status, conclusion, completed_at]) => ({
      status,
      conclusion,
      completed_at,
    })),
  });

const GREEN_LONG_AGO = runs(
  ['completed', 'success', ago(150)],
  ['completed', 'skipped', ago(140)],
  ['completed', 'success', ago(90)]
);

const READY = JSON.stringify([{ number: 7, isDraft: false, headRefOid: HEAD }]);

function run(env: Record<string, string>) {
  writeFileSync(log, '');
  for (const f of ['created', 'patched']) rmSync(join(dir, f), { force: true });
  const r = spawnSync('sh', [SCRIPT], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      REPO: 'o/r',
      GH_TOKEN: 'x',
      NOW: String(NOW),
      GH_STUB_LOG: log,
      GH_STUB_DIR: dir,
      GH_STUB_PRS: READY,
      [`GH_STUB_RUNS_${HEAD}`]: GREEN_LONG_AGO,
      ...env,
    },
  });
  const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
  return {
    status: r.status ?? -1,
    out: `${r.stdout}${r.stderr}`,
    calls: existsSync(log) ? readFileSync(log, 'utf8') : '',
    created: read('created'),
    patched: read('patched'),
  };
}

describe('gate-watch.sh', () => {
  it('flags a ready PR green for over an hour with no gate review: one issue, one PR comment', () => {
    const { status, calls, created } = run({});
    expect(status).toBe(0);
    expect(calls).toContain('CREATE');
    expect(created).toContain('<!-- gate-watch:health -->');
    expect(created).toContain('| #7 | `abc123def` |');
    expect(created).toContain('This comment was created by an AI agent');
    expect(calls).toContain('PCOMMENT 7');
    expect(calls).toContain(`<!-- gate-watch:${HEAD} -->`);
    expect(calls).toContain('dicatat juga di #900');
  });

  it('counts from the last check to finish, not the first', () => {
    // Finished 150 and 30 minutes ago: green for only 30 minutes.
    const { calls } = run({
      [`GH_STUB_RUNS_${HEAD}`]: runs(
        ['completed', 'success', ago(150)],
        ['completed', 'success', ago(30)]
      ),
    });
    expect(calls).not.toContain('CREATE');
    expect(calls).not.toContain('PCOMMENT');
  });

  it('leaves a PR the gate reviewed on its head alone, whatever the verdict', () => {
    const { calls } = run({
      GH_STUB_REVIEWS_7: JSON.stringify([
        { id: 1, user: { login: 'cipansor-bot' }, commit_id: HEAD, state: 'CHANGES_REQUESTED' },
      ]),
    });
    expect(calls).not.toContain('CREATE');
    expect(calls).not.toContain('PCOMMENT');
  });

  it("still flags a PR whose only gate review is on an older commit, or someone else's on the head", () => {
    const { calls } = run({
      GH_STUB_REVIEWS_7: JSON.stringify([
        { id: 1, user: { login: 'cipansor-bot' }, commit_id: 'old000', state: 'CHANGES_REQUESTED' },
        { id: 2, user: { login: 'a-person' }, commit_id: HEAD, state: 'COMMENTED' },
      ]),
    });
    expect(calls).toContain('PCOMMENT 7');
  });

  it('skips a draft', () => {
    const { calls } = run({
      GH_STUB_PRS: JSON.stringify([{ number: 7, isDraft: true, headRefOid: HEAD }]),
    });
    expect(calls).not.toContain('PCOMMENT');
  });

  it('skips a PR whose checks are still running', () => {
    const { calls } = run({
      [`GH_STUB_RUNS_${HEAD}`]: runs(
        ['completed', 'success', ago(150)],
        ['in_progress', null, null]
      ),
    });
    expect(calls).not.toContain('PCOMMENT');
  });

  it('skips a red PR: the lifecycle does not dispatch it', () => {
    const { calls } = run({
      [`GH_STUB_RUNS_${HEAD}`]: runs(
        ['completed', 'success', ago(150)],
        ['completed', 'failure', ago(140)]
      ),
    });
    expect(calls).not.toContain('PCOMMENT');
  });

  it('skips a PR with no check runs yet', () => {
    const { calls } = run({ [`GH_STUB_RUNS_${HEAD}`]: runs() });
    expect(calls).not.toContain('PCOMMENT');
  });

  it('skips, with a warning, a PR whose reviews cannot be read', () => {
    const { calls, out } = run({ GH_STUB_REVIEWS_FAIL: '7' });
    expect(calls).not.toContain('PCOMMENT');
    expect(out).toContain('reviews unreadable');
  });

  it('comments once per head: an existing marker for the head is not repeated', () => {
    const { calls } = run({
      GH_STUB_COMMENTS_7: JSON.stringify([{ id: 5, body: `<!-- gate-watch:${HEAD} -->\n\nlama` }]),
    });
    expect(calls).not.toContain('PCOMMENT');
  });

  it('updates the open health issue in place, and only when the list changed', () => {
    const first = run({});
    const issue = JSON.stringify([{ number: 41, body: first.created }]);

    const same = run({
      GH_STUB_OPEN_ISSUES: issue,
      GH_STUB_ISSUE_JSON: JSON.stringify({ body: first.created }),
    });
    expect(same.calls).not.toContain('CREATE');
    expect(same.calls).not.toContain('PATCH');

    const changed = run({
      GH_STUB_OPEN_ISSUES: issue,
      GH_STUB_ISSUE_JSON: JSON.stringify({ body: `<!-- gate-watch:health -->\n\n| #3 |` }),
    });
    expect(changed.calls).not.toContain('CREATE');
    expect(changed.calls).toContain('PATCH repos/o/r/issues/41');
    expect(changed.patched).toContain('| #7 |');
  });

  it('ignores an automation-health issue that is not its own', () => {
    const { calls } = run({
      GH_STUB_OPEN_ISSUES: JSON.stringify([{ number: 12, body: 'Laporan kesehatan armada' }]),
    });
    expect(calls).toContain('CREATE');
  });

  it('closes the health issue with a comment once no PR is waiting', () => {
    const { calls } = run({
      GH_STUB_PRS: '[]',
      GH_STUB_OPEN_ISSUES: JSON.stringify([{ number: 41, body: '<!-- gate-watch:health -->' }]),
    });
    expect(calls).toContain('ICOMMENT 41');
    expect(calls).toMatch(/PATCH repos\/o\/r\/issues\/41 .*state=closed/);
    expect(calls).not.toContain('CREATE');
  });

  it('does nothing at all when no PR is waiting and no issue is open', () => {
    const { status, calls } = run({ GH_STUB_PRS: '[]' });
    expect(status).toBe(0);
    expect(calls).toBe('');
  });
});

describe('gate-watch.sh — one re-dispatch per silent head', () => {
  it('re-dispatches the gate once with the PR and its head, and says so', () => {
    const { calls } = run({ OPENHANDS_API_KEY: 'k' });
    expect(calls.match(/^CURL /gm)).toHaveLength(1);
    expect(calls).toContain('/dispatch');
    expect(calls).toContain('"source":"gate-watch"');
    expect(calls).toContain('"pr":"7"');
    expect(calls).toContain(`"head_sha":"${HEAD}"`);
    expect(calls).toContain('di-dispatch ulang sekali (HTTP 202)');
  });

  it('does not re-dispatch a head it already commented on', () => {
    const { calls } = run({
      OPENHANDS_API_KEY: 'k',
      GH_STUB_COMMENTS_7: JSON.stringify([{ id: 5, body: `<!-- gate-watch:${HEAD} -->` }]),
    });
    expect(calls).not.toContain('CURL');
  });

  it('reports a refused re-dispatch rather than claiming it went out', () => {
    const { calls } = run({ OPENHANDS_API_KEY: 'k', GH_STUB_CURL_CODE: '401' });
    expect(calls).toContain('Dispatch ulang ditolak (HTTP 401)');
    expect(calls).not.toContain('di-dispatch ulang sekali');
  });

  it('only comments when no key is available', () => {
    const { calls } = run({});
    expect(calls).not.toContain('CURL');
    expect(calls).toContain('Dispatch ulang tidak dicoba');
  });

  it('never re-dispatches a PR the gate already reviewed', () => {
    const { calls } = run({
      OPENHANDS_API_KEY: 'k',
      GH_STUB_REVIEWS_7: JSON.stringify([
        { id: 1, user: { login: 'cipansor-bot' }, commit_id: HEAD, state: 'APPROVED' },
      ]),
    });
    expect(calls).not.toContain('CURL');
  });
});

describe('gate-watch.yml', () => {
  const yml = () => readFileSync(WORKFLOW, 'utf8');

  it('runs hourly and by hand, with the gate login and a one-hour wait', () => {
    expect(yml()).toMatch(/cron: '23 \* \* \* \*'/);
    expect(yml()).toContain('workflow_dispatch:');
    expect(yml()).toContain('GATE_LOGIN: cipansor-bot');
    expect(yml()).toContain("WAIT_MINUTES: '60'");
    expect(yml()).toContain('OPENHANDS_API_KEY: ${{ secrets.OPENHANDS_API_KEY }}');
  });

  it('can write the comment and the issue, and nothing else', () => {
    const perms = yml().slice(yml().indexOf('permissions:'), yml().indexOf('concurrency:'));
    expect(perms).toContain('issues: write');
    expect(perms).toContain('pull-requests: write');
    expect(perms).toContain('contents: read');
    expect(perms).not.toMatch(/contents: write|actions: write/);
  });
});
