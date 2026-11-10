import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * Behaviour `duplicate-detect.sh` hides, driven against a stub `gh`:
 *
 *  - two OPEN issues whose titles are equal once normalised (lowercased,
 *    whitespace collapsed, trailing punctuation dropped, digit runs of
 *    `MASK_MIN` or more masked) -> the newest is labelled `duplicate`, the
 *    earliest (the original) is not;
 *  - a same-titled pair where the original is CLOSED is not a duplicate (a
 *    recurrence after a fix is a regression, and the index only carries open
 *    issues);
 *  - a short, generic title is not evidence;
 *  - an issue that already carries `duplicate` is left alone (idempotent);
 *  - an unreadable comment list skips the issue instead of stacking a second
 *    link;
 *  - a pull request is never touched, even when its title matches an issue's;
 *  - the link comment is written before the label, so a failed comment leaves
 *    nothing behind and the detector never removes a label itself;
 *  - a removal of the label is a verdict only from the trusted account; any
 *    other actor's removal is re-applied (the link comment is kept);
 *  - `DUPLICATE_DETECT_DRY_RUN` proves the whole path without writing.
 *
 * The script only labels. Closing is `duplicate-sweep.sh`'s job, after a warning
 * and a grace period, so no close command may exist here.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, '.github', 'scripts', 'duplicate-detect.sh');
const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'duplicate-detect.yml');

// The stub answers the reads the script makes (issues, comments, events) and
// logs the writes. `index_rows` pipes `gh api --paginate` straight into the
// script's own `jq`, so the issues listing is returned RAW (no `--jq`); the
// comments and events reads pass `--jq`, so the stub honours it there —
// otherwise the script's real expression would never run and the marker and
// trusted-removal checks would be untested.
const STUB = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "$GH_STUB_LOG"; }
if [ "$1" = "issue" ]; then
  case "$2" in
    edit)
      log "LABEL $*"
      case " $* " in
        *" --remove-label "*)
          if [ -n "\${GH_STUB_FAIL_UNLABEL:-}" ]; then exit 1; fi ;;
        *" --add-label "*)
          if [ -n "\${GH_STUB_FAIL_LABEL:-}" ]; then exit 1; fi ;;
      esac
      ;;
    comment) log "COMMENT $*"; if [ -n "\${GH_STUB_FAIL_COMMENT:-}" ]; then exit 1; fi ;;
  esac
  exit 0
fi
JQ=""
prev=""
for a in "$@"; do [ "$prev" = "--jq" ] && JQ="$a"; prev="$a"; done
[ "$1" = "api" ] || exit 0
shift
[ "$1" = "--paginate" ] && shift
path="$1"; shift
case "$path" in
  *"/comments?per_page=100")
    if [ -n "\${GH_STUB_FAIL_COMMENTS:-}" ]; then exit 1; fi
    printf '%s' "\${GH_STUB_COMMENTS:-[]}" | jq -r "\${JQ:-.}" 2>/dev/null || printf ''
    ;;
  *"/events?per_page=100")
    if [ -n "\${GH_STUB_FAIL_EVENTS:-}" ]; then exit 1; fi
    printf '%s' "\${GH_STUB_EVENTS:-[]}" | jq -r "\${JQ:-.}" 2>/dev/null || printf ''
    ;;
  *"/labels") log "LABEL $*" ;;
  *"/comments") log "COMMENT $*" ;;
  *) if [ -n "\${GH_STUB_FAIL_INDEX:-}" ]; then exit 1; fi; printf '%s' "\${GH_STUB_ISSUES:-[]}" ;;
esac
exit 0
`;

let dir: string;
let log: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'duplicate-detect-'));
  writeFileSync(join(dir, 'gh'), STUB, { mode: 0o755 });
  log = join(dir, 'calls.log');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(env: Record<string, string>) {
  writeFileSync(log, '');
  const r = spawnSync('sh', [SCRIPT], {
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

// A listing as `gh api --paginate` emits it: one JSON array of issues. A row
// with `pr: true` carries the `pull_request` field GitHub adds to a PR, which
// the script must filter out.
const issues = (rows: Array<{ number: number; title: string; labels?: string[]; pr?: boolean }>) =>
  JSON.stringify(
    rows.map((r) => ({
      number: r.number,
      state: 'open',
      title: r.title,
      labels: (r.labels ?? []).map((name) => ({ name })),
      ...(r.pr
        ? { pull_request: { url: `https://api.github.com/repos/o/r/pulls/${r.number}` } }
        : {}),
    }))
  );

const WATCH = 'Deploy watchdog: Deploy staging run ';

// An `unlabeled` event list as `gh api --paginate .../events` emits it.
const unlabeledBy = (logins: string[]) =>
  JSON.stringify(
    logins.map((login) => ({ event: 'unlabeled', label: { name: 'duplicate' }, actor: { login } }))
  );

// A label-history event list: one `{ event, login }` per entry, in order.
const events = (rows: Array<{ event: string; login: string }>) =>
  JSON.stringify(
    rows.map((r) => ({ event: r.event, label: { name: 'duplicate' }, actor: { login: r.login } }))
  );

describe('duplicate-detect.sh', () => {
  it('labels the newest issue when two open issues share a normalised title', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
    });
    expect(calls).toContain('LABEL');
    expect(calls).toContain('--add-label duplicate');
    expect(calls).toContain('COMMENT');
    expect(out).toContain('Labelled #958 as a duplicate of #800');
  });

  it('does not label the earliest issue of the group — it is the original', () => {
    const { calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
    });
    // The original (#800) is never written to: the only write names #958.
    expect(calls).not.toContain('edit 800');
    expect(calls).not.toContain('comment 800');
    expect(calls).toContain('edit 958');
    expect(calls).toContain('comment 958');
  });

  it('flags every newer sibling in a group of three, order-independent', () => {
    const { out } = run({
      GH_STUB_ISSUES: issues([
        { number: 958, title: `${WATCH}42569593649 failed` },
        { number: 901, title: `${WATCH}11111111111 failed` },
        { number: 800, title: `${WATCH}38324975861 failed` },
      ]),
    });
    expect(out).toContain('Labelled #958 as a duplicate of #800');
    expect(out).toContain('Labelled #901 as a duplicate of #800');
    expect(out).not.toContain('Labelled #800');
  });

  it('does not treat a recurrence of a closed issue as a duplicate', () => {
    // The index is OPEN issues only, so an open issue whose same-titled sibling
    // was closed is alone in the group: nothing is labelled.
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([{ number: 958, title: `${WATCH}42569593649 failed` }]),
    });
    expect(calls).not.toContain('LABEL');
    expect(out).not.toContain('Labelled');
  });

  it('does not treat a short, generic title as evidence', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 1, title: 'Login' },
        { number: 2, title: 'login' },
      ]),
    });
    expect(calls).not.toContain('LABEL');
    expect(out).not.toContain('Labelled');
  });

  it('does not treat distinct titles as duplicates', () => {
    const { calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 1, title: 'Alpha feature request' },
        { number: 2, title: 'Beta bug report' },
      ]),
    });
    expect(calls).not.toContain('LABEL');
  });

  it('leaves an issue that already carries duplicate alone', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed`, labels: ['duplicate'] },
      ]),
    });
    expect(calls).not.toContain('LABEL');
    expect(out).toContain('#958 already carries a duplicate label');
  });

  it('skips an issue whose comments cannot be read, instead of stacking a link', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_FAIL_COMMENTS: '1',
    });
    expect(calls).not.toContain('LABEL');
    expect(out).toContain('comments unreadable');
  });

  it('writes nothing under DUPLICATE_DETECT_DRY_RUN', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      DUPLICATE_DETECT_DRY_RUN: '1',
    });
    expect(calls).not.toContain('LABEL');
    expect(calls).not.toContain('COMMENT');
    expect(out).toContain('would label #958 as a duplicate of #800');
  });

  it('never touches a pull request, even one sharing an issue title', () => {
    // A PR is listed by the issues API; the script must filter it out so a PR
    // never receives the issue-lifecycle `duplicate` label.
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed`, pr: true },
      ]),
    });
    expect(calls).not.toContain('LABEL');
    expect(out).not.toContain('Labelled');
  });

  it('never removes a label itself, even when the label write fails', () => {
    // The detector must never be the author of an `unlabeled` event: if it were,
    // a trusted removal could be its own rollback rather than a verdict. Comment
    // first means there is nothing to roll back.
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_FAIL_LABEL: '1',
    });
    expect(calls).not.toContain('--remove-label duplicate');
    expect(out).toContain('could not label #958');
  });

  it('re-labels when the removal was by a human and the issue was never linked', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_EVENTS: unlabeledBy(['someone']),
    });
    expect(calls).toContain('--add-label duplicate');
    expect(out).toContain('Labelled #958');
  });

  it('skips an issue whose label was removed by cipansor-bot[bot]', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_EVENTS: unlabeledBy(['cipansor-bot[bot]']),
    });
    expect(calls).not.toContain('LABEL');
    expect(out).toContain('pernah dicabut cipansor-bot');
  });

  it('re-labels when a removal login merely resembles the trusted actor', () => {
    // Exact match, not a substring: `cipansor-bot-fake` must not impersonate.
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_EVENTS: unlabeledBy(['cipansor-bot-fake']),
    });
    expect(calls).toContain('--add-label duplicate');
    expect(out).toContain('Labelled #958');
  });

  it('skips an issue whose events cannot be read, instead of risking a re-label', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_FAIL_EVENTS: '1',
    });
    expect(calls).not.toContain('LABEL');
    expect(out).toContain('events unreadable');
  });

  it('writes nothing when the link comment fails (comment-first, no orphan label)', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_FAIL_COMMENT: '1',
    });
    expect(calls).not.toContain('--add-label duplicate');
    expect(calls).not.toContain('--remove-label duplicate');
    expect(out).toContain('could not post the link on #958');
    expect(out).not.toContain('Labelled #958');
  });

  it('never removes a label itself, however the writes fail', () => {
    // Comment-first: even with both writes failing there is nothing to roll back,
    // so the detector is never the author of an `unlabeled` event.
    const { calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_FAIL_COMMENT: '1',
      GH_STUB_FAIL_LABEL: '1',
    });
    expect(calls).not.toContain('--remove-label duplicate');
  });

  it('re-applies the label without a second comment when a human removed it after linking', () => {
    // The link comment (marker) is present, so the detector already ran. A human
    // removed the label; that is not a verdict, so the label comes back — but the
    // comment is kept, so no second link is posted.
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_COMMENTS: JSON.stringify([{ body: 'see #800 <!-- duplicate-detect -->' }]),
      GH_STUB_EVENTS: unlabeledBy(['someone']),
    });
    expect(calls).toContain('--add-label duplicate');
    expect(calls).not.toContain('COMMENT');
    expect(out).toContain('Labelled #958');
  });

  it('re-applies the label when github-actions[bot] removed it after linking', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_COMMENTS: JSON.stringify([{ body: 'see #800 <!-- duplicate-detect -->' }]),
      GH_STUB_EVENTS: unlabeledBy(['github-actions[bot]']),
    });
    expect(calls).toContain('--add-label duplicate');
    expect(calls).not.toContain('COMMENT');
    expect(out).toContain('Labelled #958');
  });

  it('re-applies the label when the link exists but the label write failed last time', () => {
    // The comment was written but the label was not (the previous run failed
    // between the two writes). With no removal recorded, the label is re-applied.
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_COMMENTS: JSON.stringify([{ body: 'see #800 <!-- duplicate-detect -->' }]),
    });
    expect(calls).toContain('--add-label duplicate');
    expect(calls).not.toContain('COMMENT');
    expect(out).toContain('Labelled #958');
  });

  it('does not let any comment suppress a trusted removal', () => {
    // Round-5 finding: with no marker to forge, a comment that mimics one cannot
    // stop a removal by the trusted account from being a verdict.
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_COMMENTS: JSON.stringify([
        { body: '<!-- duplicate-detect:rollback -->' },
        { body: 'see #800 <!-- duplicate-detect -->' },
      ]),
      GH_STUB_EVENTS: unlabeledBy(['cipansor-bot']),
    });
    expect(calls).not.toContain('LABEL');
    expect(out).toContain('pernah dicabut cipansor-bot');
  });

  it('retries from a clean state when the link comment fails twice with the trusted token', () => {
    // Round-5 finding: a repeated comment failure must not lock the pair. With
    // comment-first there is no removal, so nothing looks like a verdict and the
    // next sweep simply tries again.
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_FAIL_COMMENT: '1',
      DUPLICATE_DETECT_TRUSTED_ACTOR: 'cipansor-bot',
    });
    expect(calls).not.toContain('--add-label duplicate');
    expect(calls).not.toContain('--remove-label duplicate');
    expect(out).toContain('nothing written, the next sweep retries');
  });

  it('does not touch the issue under DUPLICATE_DETECT_DRY_RUN', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_COMMENTS: JSON.stringify([{ body: 'see #800 <!-- duplicate-detect -->' }]),
      GH_STUB_EVENTS: unlabeledBy(['someone']),
      DUPLICATE_DETECT_DRY_RUN: '1',
    });
    expect(calls).not.toContain('LABEL');
    expect(out).toContain('would label #958 as a duplicate of #800');
  });

  it('honours a trusted removal beside a label-add (not read as a rollback)', () => {
    // A trusted `labeled` then `unlabeled` with no link is a triage decision: the
    // detector never removes a label itself, so this is not its rollback.
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_EVENTS: events([
        { event: 'labeled', login: 'cipansor-bot' },
        { event: 'unlabeled', login: 'cipansor-bot' },
      ]),
    });
    expect(calls).not.toContain('LABEL');
    expect(out).toContain('pernah dicabut cipansor-bot');
  });

  it('uses the configured trusted account in the link comment', () => {
    const { calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      DUPLICATE_DETECT_TRUSTED_ACTOR: 'trusted-ops',
    });
    expect(calls).toContain('trusted-ops');
  });

  it('warns and does nothing when the issue index cannot be read', () => {
    const { out, calls } = run({ GH_STUB_FAIL_INDEX: '1' });
    expect(calls).not.toContain('LABEL');
    expect(out).toContain('could not read the issue index');
  });

  it('never closes an issue: closing belongs to duplicate-sweep.sh', () => {
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).not.toMatch(/issue\s+close/);
    expect(src).not.toMatch(/state.?[:=].?closed/);
  });

  it('fires on issues.opened and on a schedule, and runs the script', () => {
    const wf = readFileSync(WORKFLOW, 'utf8');
    const onBlock = wf.slice(wf.indexOf('\non:'), wf.indexOf('\njobs:'));
    expect(onBlock).toContain('opened');
    expect(onBlock).toContain('schedule');
    expect(wf).toContain('duplicate-detect.sh');
  });
});
