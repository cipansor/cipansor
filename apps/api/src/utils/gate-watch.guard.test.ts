import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * `gate-watch.sh` (#776) against a stub `gh` that serves JSON fixtures and runs
 * each call's real `--jq` expression through `jq`, so the filters the script
 * relies on — not a draft, the gate's login, the head commit — are exercised
 * too, not just the shell around them. Check-run fixtures carry `started_at`
 * and `id` as the real API does, because the script picks the latest run of a
 * name the same way `pr-lifecycle.sh` does (sort by `started_at`, then `id`) —
 * a re-run still in flight must keep the head pending.
 *
 * A ready PR whose full gate set finished green more than an hour ago and that
 * the gate has not reviewed is flagged once, and the one health issue lists it;
 * anything else is left alone.
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
      comment) log "PCOMMENT $3"; log "PBODY $(bodyof "$@")" ;;
    esac ;;
  issue)
    case "$2" in
      create) log "CREATE"; bodyof "$@" > "$GH_STUB_DIR/created"; echo "https://github.com/o/r/issues/900" ;;
      comment) log "ICOMMENT $3"; log "IBODY $(bodyof "$@")" ;;
    esac ;;
  api)
    case "$*" in
      *"pulls?state=open"*)
        [ "\${GH_STUB_PRS_FAIL:-}" = "1" ] && exit 1
        emit "\${GH_STUB_PRS:-[]}" ;;
      *"-X PATCH"*) log "PATCH $*"; bodyof "$@" > "$GH_STUB_DIR/patched" ;;
      *"/reviews"*)
        n=$(printf '%s\\n' "$*" | sed -n 's|.*/pulls/\\([0-9]*\\)/reviews.*|\\1|p')
        [ "\${GH_STUB_REVIEWS_FAIL:-}" = "$n" ] && exit 1
        eval "v=\\\${GH_STUB_REVIEWS_$n:-[]}"; emit "$v" ;;
      *"/check-runs"*)
        s=$(printf '%s\\n' "$*" | sed -n 's|.*/commits/\\([0-9a-f]*\\)/check-runs.*|\\1|p')
        [ "\${GH_STUB_RUNS_FAIL:-}" = "$s" ] && exit 1
        eval "v=\\\${GH_STUB_RUNS_$s:-}"; [ -n "$v" ] || v='{"check_runs":[]}'; emit "$v" ;;
      *"/comments"*)
        n=$(printf '%s\\n' "$*" | sed -n 's|.*/issues/\\([0-9]*\\)/comments.*|\\1|p')
        [ "\${GH_STUB_COMMENTS_FAIL:-}" = "$n" ] && exit 1
        eval "v=\\\${GH_STUB_COMMENTS_$n:-[]}"; emit "$v" ;;
      *"issues?state=open"*)
        [ "\${GH_STUB_ISSUES_FAIL:-}" = "1" ] && exit 1
        emit "\${GH_STUB_OPEN_ISSUES:-[]}" ;;
      *"/issues/"*) emit "\${GH_STUB_ISSUE_JSON:-{}}" ;;
    esac ;;
esac
exit 0
`;

// The re-dispatch: logs the call and its payload, answers a run id.
const CURL = `#!/bin/sh
prev=""; for a in "$@"; do [ "$prev" = "-d" ] && echo "CURL $*" "PAYLOAD $a" >> "$GH_STUB_LOG"; prev="$a"; done
# The gate's run history, read by gate_run_status / gate_any_in_flight.
# GH_STUB_GATE_RUNS is the JSON body; a missing one means an empty history, and
# GH_STUB_RUNS_API_FAIL makes the read fail (the "unreadable history" path).
case "$*" in
  *"/runs?limit="*)
    [ "\${GH_STUB_RUNS_API_FAIL:-}" = 1 ] && exit 1
    # The default is held in a variable: a literal \`}\` inside \${v:-...} would
    # close the expansion early and append a stray brace to the JSON.
    empty='{"runs":[]}'
    # gate_run_status walks pages with limit/offset until it finds the id; the
    # in-flight probe has no offset. Page 1 is served on offset 0 (or a bare
    # limit=5); later offsets get page 2, so a run pushed past page 1 is still
    # found (and a single-page read cannot be mistaken for "gone").
    case "$*" in
      *"offset=0"* | *"limit=5"*) printf '%s' "\${GH_STUB_GATE_RUNS_PAGE1:-\${GH_STUB_GATE_RUNS:-$empty}}" ;;
      *) printf '%s' "\${GH_STUB_GATE_RUNS_PAGE2:-$empty}" ;;
    esac
    exit 0 ;;
  *"/dispatch"*)
    # A successful dispatch answers the new run id in the body, followed by the
    # HTTP code on its own line (the script calls curl with a -w code format).
    # GH_STUB_DISPATCH_CODE forces a refusal, in which case no run id comes back.
    case "\${GH_STUB_DISPATCH_CODE:-201}" in
      2??) printf '{"id":"%s","status":"PENDING"}\n%s' "\${GH_STUB_DISPATCH_ID:-run-9001}" "\${GH_STUB_DISPATCH_CODE:-201}" ;;
      *) printf '\n%s' "\${GH_STUB_DISPATCH_CODE}" ;;
    esac
    exit 0 ;;
esac
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

// name, status, conclusion, completed_at, started_at (defaults to
// completed_at), id (defaults to row order).
type Run = [
  name: string,
  status: string,
  conclusion: string | null,
  completedAt: string | null,
  startedAt?: string | null,
  id?: number,
];
const runs = (...list: Run[]) =>
  JSON.stringify({
    check_runs: list.map((t, i) => ({
      name: t[0],
      status: t[1],
      conclusion: t[2],
      completed_at: t[3],
      started_at: t[4] ?? t[3],
      id: t[5] ?? i + 1,
    })),
  });

// The full gate set, each green and long settled. Tests replace or extend parts
// of it, mirroring the names pr-lifecycle.sh dispatches on.
const GATE_GREEN: Run[] = [
  ['CI scope', 'completed', 'success', ago(150)],
  ['Lint', 'completed', 'success', ago(130)],
  ['Build', 'completed', 'skipped', ago(140)],
  ['Tests', 'completed', 'success', ago(150)],
  ['Security', 'completed', 'success', ago(140)],
  ['E2E scope', 'completed', 'success', ago(100)],
  ['E2E Tests (Chromium)', 'completed', 'success', ago(90)],
];
const GREEN_LONG_AGO = runs(...GATE_GREEN);
const without = (name: string) => GATE_GREEN.filter(([n]) => n !== name);

const READY = JSON.stringify([{ number: 7, draft: false, head: { sha: HEAD } }]);

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
      // The re-dispatch is off unless a test turns it on; the parent
      // environment may carry the real key.
      OPENHANDS_API_KEY: '',
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
    // No AI-disclosure footer: the anti-loop guard is the comment's author.
    expect(created).not.toContain('This comment was created by an AI agent');
    expect(calls).toContain('PCOMMENT 7');
    expect(calls).toContain(`<!-- gate-watch:${HEAD} -->`);
    expect(calls).toContain('dicatat juga di #900');
  });

  it('counts from the last check to finish, not the first', () => {
    // Finished 150 and 30 minutes ago: green for only 30 minutes.
    const { calls } = run({
      [`GH_STUB_RUNS_${HEAD}`]: runs(...without('Lint'), ['Lint', 'completed', 'success', ago(30)]),
    });
    expect(calls).not.toContain('CREATE');
    expect(calls).not.toContain('PCOMMENT');
  });

  it('flags a PR whose only red run was superseded by a re-run success', () => {
    // The API returns the replaced failure beside its green re-run; only the
    // latest run of each name counts, so this head is green, not red.
    const { calls } = run({
      [`GH_STUB_RUNS_${HEAD}`]: runs(
        ...without('Tests'),
        ['Tests', 'completed', 'failure', ago(150)],
        ['Tests', 'completed', 'success', ago(90)]
      ),
    });
    expect(calls).toContain('PCOMMENT 7');
  });

  it('keeps waiting when a re-run of a check is still in flight', () => {
    // An old green run beside a fresh re-run that has not finished: ordering by
    // completed_at picked the old green run and dispatched the gate before the
    // new result was known. The latest run by started_at keeps it pending.
    const { calls } = run({
      [`GH_STUB_RUNS_${HEAD}`]: runs(
        ...without('E2E Tests (Chromium)'),
        ['E2E Tests (Chromium)', 'completed', 'success', ago(140)],
        ['E2E Tests (Chromium)', 'in_progress', null, null, ago(5)]
      ),
    });
    expect(calls).not.toContain('PCOMMENT');
  });

  it('keeps waiting while the gate set is still incomplete', () => {
    // CI finished but the E2E suite has not published its checks yet: a green
    // subset must not be mistaken for the full gate.
    const { calls } = run({
      [`GH_STUB_RUNS_${HEAD}`]: runs(...GATE_GREEN.filter(([n]) => !n.startsWith('E2E'))),
    });
    expect(calls).not.toContain('PCOMMENT');
  });

  it.each(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale'])(
    'still skips a PR whose latest run of a gate check is %s',
    (conclusion) => {
      const { calls } = run({
        [`GH_STUB_RUNS_${HEAD}`]: runs(...without('Lint'), [
          'Lint',
          'completed',
          conclusion,
          ago(140),
        ]),
      });
      expect(calls).not.toContain('PCOMMENT');
    }
  );

  it('ignores an advisory check that failed when the gate set is green', () => {
    // `PR template reminder` is not in REQUIRED_CHECKS; pr-lifecycle still
    // dispatches, so a failing advisory check must not hide the gate's silence.
    const { calls } = run({
      [`GH_STUB_RUNS_${HEAD}`]: runs(...GATE_GREEN, [
        'Before/after visual reminder',
        'completed',
        'failure',
        ago(140),
      ]),
    });
    expect(calls).toContain('PCOMMENT 7');
  });

  it('ignores an advisory check that is still running when the gate set is green', () => {
    const { calls } = run({
      [`GH_STUB_RUNS_${HEAD}`]: runs(...GATE_GREEN, [
        'Before/after visual reminder',
        'in_progress',
        null,
        null,
        ago(5),
      ]),
    });
    expect(calls).toContain('PCOMMENT 7');
  });

  it('flags a PR whose only non-success conclusion is skipped', () => {
    const { calls } = run({
      [`GH_STUB_RUNS_${HEAD}`]: runs(...without('Build'), [
        'Build',
        'completed',
        'skipped',
        ago(140),
      ]),
    });
    expect(calls).toContain('PCOMMENT 7');
  });

  it('keys each check by its whole name, not its first word', () => {
    // "Tests A" is green and "Tests B" is red — distinct checks whose first
    // word matches. Keying on the first word would drop the red one and flag
    // a head that is in fact red.
    const { calls } = run({
      [`GH_STUB_RUNS_${HEAD}`]: runs(
        ...without('Tests'),
        ['Tests A', 'completed', 'success', ago(90)],
        ['Tests B', 'completed', 'failure', ago(140)]
      ),
    });
    expect(calls).not.toContain('PCOMMENT');
  });

  it('lets a re-run of a name with spaces supersede its failure', () => {
    const { calls } = run({
      [`GH_STUB_RUNS_${HEAD}`]: runs(
        ...without('E2E Tests (Chromium)'),
        ['E2E Tests (Chromium)', 'completed', 'failure', ago(140)],
        ['E2E Tests (Chromium)', 'completed', 'success', ago(90)]
      ),
    });
    expect(calls).toContain('PCOMMENT 7');
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

  it('leaves a PR whose only gate review is on an older commit alone: its automatic pass already ran', () => {
    // The gate's automatic pass is the first review only. A review on an older
    // commit means the gate already ran; a later head is reviewed only on a
    // manual re-request, so this head is expected to have no new review.
    const { calls } = run({
      GH_STUB_REVIEWS_7: JSON.stringify([
        { id: 1, user: { login: 'cipansor-bot' }, commit_id: 'old000', state: 'CHANGES_REQUESTED' },
        { id: 2, user: { login: 'a-person' }, commit_id: HEAD, state: 'COMMENTED' },
      ]),
    });
    expect(calls).not.toContain('PCOMMENT');
    expect(calls).not.toContain('CREATE');
  });

  it('flags a head whose manual re-review was requested and not delivered', () => {
    // The author asked for another pass (requested_reviewers holds the gate) and
    // the gate has reviewed before but not this head: the re-review is owed, so
    // the watch re-dispatches it. The lead sentence names the re-review.
    const { calls, created } = run({
      GH_STUB_PRS: JSON.stringify([
        {
          number: 7,
          draft: false,
          head: { sha: HEAD },
          requested_reviewers: [{ login: 'cipansor-bot' }],
        },
      ]),
      GH_STUB_REVIEWS_7: JSON.stringify([
        { id: 1, user: { login: 'cipansor-bot' }, commit_id: 'old000', state: 'CHANGES_REQUESTED' },
      ]),
    });
    expect(calls).toContain('PCOMMENT 7');
    expect(calls).toContain('meninjau **ulang**');
    expect(created).toContain('| #7 |');
  });

  it('skips a draft', () => {
    const { calls } = run({
      GH_STUB_PRS: JSON.stringify([{ number: 7, draft: true, head: { sha: HEAD } }]),
    });
    expect(calls).not.toContain('PCOMMENT');
  });

  it('skips a PR whose checks are still running', () => {
    const { calls } = run({
      [`GH_STUB_RUNS_${HEAD}`]: runs(...without('E2E Tests (Chromium)'), [
        'E2E Tests (Chromium)',
        'in_progress',
        null,
        null,
        ago(5),
      ]),
    });
    expect(calls).not.toContain('PCOMMENT');
  });

  it('skips a red PR: the lifecycle does not dispatch it', () => {
    const { calls } = run({
      [`GH_STUB_RUNS_${HEAD}`]: runs(...without('Lint'), [
        'Lint',
        'completed',
        'failure',
        ago(140),
      ]),
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

  it('does not close the health issue when a scan did not complete', () => {
    // Reviews unreadable for the only open PR: the empty list is not proof the
    // incident ended, so the active report is left alone.
    const { calls } = run({
      GH_STUB_REVIEWS_FAIL: '7',
      GH_STUB_OPEN_ISSUES: JSON.stringify([{ number: 41, body: '<!-- gate-watch:health -->' }]),
    });
    expect(calls).not.toContain('ICOMMENT 41');
    expect(calls).not.toMatch(/PATCH repos\/o\/r\/issues\/41/);
  });

  it('does not close the health issue when the open PR list cannot be read', () => {
    // A failed fetch is not an empty list: treating it as one closed an issue
    // whose PRs were still waiting, then reopened it on the next good run.
    const { status, calls, out } = run({
      GH_STUB_PRS_FAIL: '1',
      GH_STUB_OPEN_ISSUES: JSON.stringify([{ number: 41, body: '<!-- gate-watch:health -->' }]),
    });
    expect(status).not.toBe(0);
    expect(out).toContain('Could not read open pull requests');
    expect(calls).not.toContain('ICOMMENT 41');
    expect(calls).not.toMatch(/PATCH repos\/o\/r\/issues\/41/);
  });

  it('does not close the health issue when the issue list cannot be read', () => {
    const { status, calls } = run({
      GH_STUB_PRS: '[]',
      GH_STUB_ISSUES_FAIL: '1',
      GH_STUB_OPEN_ISSUES: JSON.stringify([{ number: 41, body: '<!-- gate-watch:health -->' }]),
    });
    expect(status).not.toBe(0);
    expect(calls).not.toContain('ICOMMENT 41');
    expect(calls).not.toContain('CREATE');
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
  // The gate's newest run failed on infrastructure: the head is silent and the
  // run was lost, so a re-dispatch is the point.
  const INFRA_RUN = JSON.stringify({
    runs: [
      {
        id: 'r1',
        status: 'FAILED',
        status_detail: { phase: 'execution', kind: 'timeout' },
        created_at: '2026-10-15T04:25:33Z',
      },
    ],
  });

  it('re-dispatches the gate once with the PR and its head, and says so', () => {
    const { calls } = run({ OPENHANDS_API_KEY: 'k' });
    expect(calls.match(/^CURL /gm)).toHaveLength(1);
    expect(calls).toContain('/dispatch');
    expect(calls).toContain('"source":"gate-watch"');
    expect(calls).toContain('"pr":"7"');
    expect(calls).toContain(`"head_sha":"${HEAD}"`);
    expect(calls).toContain('percobaan 1/3');
  });

  it('waits while the run it dispatched for this head is still RUNNING', () => {
    // The run id is read back from the head's own comment, so another PR's
    // in-flight run cannot hold this head back (nor its failure trigger a
    // wrong retry).
    const { calls, patched } = run({
      OPENHANDS_API_KEY: 'k',
      GH_STUB_GATE_RUNS: JSON.stringify({
        runs: [{ id: 'run-77', status: 'RUNNING' }],
      }),
      GH_STUB_COMMENTS_7: JSON.stringify([
        { id: 5, body: `<!-- gate-watch:${HEAD} -->\n<!-- gate-watch-run:${HEAD}:run-77 -->` },
      ]),
    });
    expect(calls).not.toContain('CURL');
    expect(patched).toContain('RUNNING/PENDING');
  });

  it('does not re-dispatch when the gate history is unreadable', () => {
    // A failed read is not "no run": dispatching then could double up on a head
    // already being reviewed.
    const { calls, out } = run({ OPENHANDS_API_KEY: 'k', GH_STUB_RUNS_API_FAIL: '1' });
    expect(calls).not.toContain('CURL');
    expect(out).toContain('run history is unreadable');
  });

  it('stops at GATE_MAX_ATTEMPTS and hands the head to a person', () => {
    const { calls, patched } = run({
      OPENHANDS_API_KEY: 'k',
      GATE_MAX_ATTEMPTS: '3',
      GH_STUB_GATE_RUNS: INFRA_RUN,
      GH_STUB_COMMENTS_7: JSON.stringify([
        {
          id: 5,
          body: `<!-- gate-watch:${HEAD} -->\n<!-- gate-watch-attempt:${HEAD}:3 -->\n<!-- gate-watch-run:${HEAD}:r1 -->`,
        },
      ]),
    });
    expect(calls).not.toContain('CURL');
    expect(patched).toContain('giliran manusia');
  });

  it('counts an attempt from the marker and updates the comment in place', () => {
    const { calls, patched } = run({
      OPENHANDS_API_KEY: 'k',
      GH_STUB_GATE_RUNS: INFRA_RUN,
      GH_STUB_COMMENTS_7: JSON.stringify([
        {
          id: 5,
          body: `<!-- gate-watch:${HEAD} -->\n<!-- gate-watch-attempt:${HEAD}:1 -->\n<!-- gate-watch-run:${HEAD}:r1 -->`,
        },
      ]),
    });
    // The counter rides in the comment body, so the next run reads it there.
    expect(patched).toContain('percobaan 2/3');
    expect(patched).toContain(`<!-- gate-watch-attempt:${HEAD}:2 -->`);
    expect(calls).toMatch(/PATCH api -X PATCH repos\/o\/r\/issues\/comments\/5/);
    expect(calls).not.toContain('PCOMMENT');
  });

  it('records the run id it dispatched in the head comment', () => {
    const { calls } = run({ OPENHANDS_API_KEY: 'k' });
    expect(calls).toContain('PCOMMENT 7');
    expect(calls).toContain(`<!-- gate-watch-run:${HEAD}:run-9001 -->`);
  });

  it('re-dispatches a head that was never dispatched and has no run in flight', () => {
    // An empty history with no marker is a head the gate never reached; it must
    // still get a bounded attempt instead of only a warning.
    const { calls } = run({ OPENHANDS_API_KEY: 'k' });
    expect(calls).toContain('/dispatch');
  });

  it('re-dispatches a head whose earlier dispatch left no run id, until the cap', () => {
    // The gate was told about this head but no run id was ever recorded, and
    // nothing is in flight: the earlier dispatch was lost. One bounded attempt
    // is owed; the marker's count keeps it from repeating forever.
    const { calls, patched } = run({
      OPENHANDS_API_KEY: 'k',
      GATE_MAX_ATTEMPTS: '3',
      GH_STUB_COMMENTS_7: JSON.stringify([
        { id: 5, body: `<!-- gate-watch:${HEAD} -->\n<!-- gate-watch-attempt:${HEAD}:1 -->` },
      ]),
    });
    expect(calls).toContain('/dispatch');
    expect(patched).toContain(`<!-- gate-watch-attempt:${HEAD}:2 -->`);
  });

  it('re-dispatches a head whose recorded run completed without a review, until the cap', () => {
    // A run that finished but wrote no review is the gate going silent — the
    // failure this watch exists for — so it earns a bounded re-dispatch, not
    // just a warning. The gate is idempotent, so a stray extra run is cheap.
    const { calls, patched } = run({
      OPENHANDS_API_KEY: 'k',
      GH_STUB_GATE_RUNS: JSON.stringify({ runs: [{ id: 'r1', status: 'COMPLETED' }] }),
      GH_STUB_COMMENTS_7: JSON.stringify([
        {
          id: 5,
          body: `<!-- gate-watch:${HEAD} -->\n<!-- gate-watch-attempt:${HEAD}:1 -->\n<!-- gate-watch-run:${HEAD}:r1 -->`,
        },
      ]),
    });
    expect(calls).toContain('/dispatch');
    expect(patched).toContain(`<!-- gate-watch-attempt:${HEAD}:2 -->`);
  });

  it('hands a head whose completed run wrote no review to a person at the cap', () => {
    const { calls, patched } = run({
      OPENHANDS_API_KEY: 'k',
      GATE_MAX_ATTEMPTS: '3',
      GH_STUB_GATE_RUNS: JSON.stringify({ runs: [{ id: 'r1', status: 'COMPLETED' }] }),
      GH_STUB_COMMENTS_7: JSON.stringify([
        {
          id: 5,
          body: `<!-- gate-watch:${HEAD} -->\n<!-- gate-watch-attempt:${HEAD}:3 -->\n<!-- gate-watch-run:${HEAD}:r1 -->`,
        },
      ]),
    });
    expect(calls).not.toContain('CURL');
    expect(patched).toContain('giliran manusia');
    expect(patched).toContain('selesai tanpa menulis review');
  });

  it('finds a run pushed past the first page instead of calling it gone', () => {
    // The listing is paged; a run id that fell past page 1 is still there, and
    // calling it `gone` would dispatch a second run on a head already in
    // flight. The stub serves the full page 1, then page 2 with the run.
    const page1 = JSON.stringify({
      runs: Array.from({ length: 100 }, (_, i) => ({ id: `other-${i}`, status: 'COMPLETED' })),
    });
    const page2 = JSON.stringify({ runs: [{ id: 'r1', status: 'RUNNING' }] });
    const { calls, patched } = run({
      OPENHANDS_API_KEY: 'k',
      GH_STUB_GATE_RUNS_PAGE1: page1,
      GH_STUB_GATE_RUNS_PAGE2: page2,
      GH_STUB_COMMENTS_7: JSON.stringify([
        { id: 5, body: `<!-- gate-watch:${HEAD} -->\n<!-- gate-watch-run:${HEAD}:r1 -->` },
      ]),
    });
    expect(calls).not.toContain('/dispatch');
    expect(patched).toContain('RUNNING/PENDING');
  });

  it('treats a null runs page as unreadable, not as a lost run', () => {
    // `{"runs":null}` must not read as length 0: that would look like the run is
    // gone and dispatch a second one on a head already in flight.
    const { calls, out } = run({
      OPENHANDS_API_KEY: 'k',
      GH_STUB_GATE_RUNS: JSON.stringify({ runs: null }),
      GH_STUB_COMMENTS_7: JSON.stringify([
        { id: 5, body: `<!-- gate-watch:${HEAD} -->\n<!-- gate-watch-run:${HEAD}:r1 -->` },
      ]),
    });
    expect(calls).not.toContain('CURL');
    expect(out).toContain('run history is unreadable');
  });

  it('reads the attempt count across comment pages, not per page', () => {
    // `gh api --paginate` prints one JSON array per page. Without slurping, the
    // count becomes "3\n0" and the numeric cap comparison fails, so the head
    // would be re-dispatched forever. The marker on page two must still count.
    const page1 = JSON.stringify([{ id: 5, body: `<!-- gate-watch:${HEAD} -->` }]);
    const page2 = JSON.stringify([
      {
        id: 6,
        body: `<!-- gate-watch-attempt:${HEAD}:3 -->\n<!-- gate-watch-run:${HEAD}:r1 -->`,
      },
    ]);
    const { calls } = run({
      OPENHANDS_API_KEY: 'k',
      GATE_MAX_ATTEMPTS: '3',
      GH_STUB_GATE_RUNS: JSON.stringify({
        runs: [
          { id: 'r1', status: 'FAILED', status_detail: { phase: 'execution', kind: 'timeout' } },
        ],
      }),
      // Two pages, emitted as two documents the way gh prints them.
      GH_STUB_COMMENTS_7: `${page1}\n${page2}`,
    });
    expect(calls).not.toContain('CURL');
  });

  it('does not re-dispatch when the comment list cannot be read', () => {
    // A read failure must not look like "no comment yet"; replaying the
    // dispatch every hour for a head already told about is the risk.
    const { calls } = run({ OPENHANDS_API_KEY: 'k', GH_STUB_COMMENTS_FAIL: '7' });
    expect(calls).not.toContain('CURL');
  });

  it('does not retry a run that failed for a reason a retry cannot fix', () => {
    const { calls, patched } = run({
      OPENHANDS_API_KEY: 'k',
      GH_STUB_GATE_RUNS: JSON.stringify({
        runs: [
          {
            id: 'r1',
            status: 'FAILED',
            status_detail: { phase: 'verification', kind: 'auth' },
          },
        ],
      }),
      GH_STUB_COMMENTS_7: JSON.stringify([
        { id: 5, body: `<!-- gate-watch:${HEAD} -->\n<!-- gate-watch-run:${HEAD}:r1 -->` },
      ]),
    });
    expect(calls).not.toContain('CURL');
    expect(patched).toContain('bukan karena infrastruktur');
  });

  it('reports a refused re-dispatch rather than claiming it went out', () => {
    const { calls, patched } = run({
      OPENHANDS_API_KEY: 'k',
      GH_STUB_GATE_RUNS: INFRA_RUN,
      GH_STUB_COMMENTS_7: JSON.stringify([
        { id: 5, body: `<!-- gate-watch:${HEAD} -->\n<!-- gate-watch-run:${HEAD}:r1 -->` },
      ]),
      GH_STUB_DISPATCH_CODE: '401',
    });
    expect(calls).toContain('/dispatch');
    expect(patched).toContain('Dispatch ulang ditolak (HTTP 401)');
    expect(patched).not.toContain('di-dispatch ulang');
  });

  it('only comments when no key is available', () => {
    const { calls } = run({});
    expect(calls).not.toContain('CURL');
    expect(calls).toContain('Dispatch ulang tidak dicoba');
  });

  it('never re-dispatches a PR the gate already reviewed', () => {
    const { calls } = run({
      OPENHANDS_API_KEY: 'k',
      GH_STUB_GATE_RUNS: INFRA_RUN,
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
    expect(yml()).toContain("GATE_MAX_ATTEMPTS: '3'");
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
