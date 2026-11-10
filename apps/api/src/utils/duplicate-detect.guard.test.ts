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
 *  - an issue that already carries `duplicate`, or that the detector already
 *    linked (its marker comment), is left alone (idempotent);
 *  - an unreadable comment list skips the issue instead of stacking a second
 *    link;
 *  - a pull request is never touched, even when its title matches an issue's;
 *  - a failed link comment rolls the label back, so no label is left without its
 *    marker;
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

  it('leaves an issue the detector already linked alone', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_COMMENTS: JSON.stringify([{ body: 'see #800 <!-- duplicate-detect -->' }]),
    });
    expect(calls).not.toContain('LABEL');
    expect(out).toContain('#958 was already linked');
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

  it('removes the label again when the link comment fails, leaving no orphan label', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_FAIL_COMMENT: '1',
    });
    expect(calls).toContain('--add-label duplicate');
    expect(calls).toContain('--remove-label duplicate');
    expect(out).toContain('removed the label again');
    expect(out).not.toContain('Labelled #958');
  });

  it('skips an issue whose `duplicate` label was removed by cipansor-bot', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_EVENTS: unlabeledBy(['cipansor-bot']),
    });
    expect(calls).not.toContain('LABEL');
    expect(out).toContain('pernah dicabut cipansor-bot');
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

  it('re-labels when the removal was by github-actions[bot]', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_EVENTS: unlabeledBy(['github-actions[bot]']),
    });
    expect(calls).toContain('--add-label duplicate');
    expect(out).toContain('Labelled #958');
  });

  it('re-labels when the removal was by a human', () => {
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
    expect(out).toContain('::warning::');
    expect(out).toContain('events unreadable');
  });

  it('retries the rollback twice, then errors, when comment and rollback both fail', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_FAIL_COMMENT: '1',
      GH_STUB_FAIL_UNLABEL: '1',
    });
    expect(calls.split('--remove-label').length - 1).toBe(2);
    expect(out).toContain('::error::');
    expect(out).toContain('could not remove the label either');
  });

  it('re-applies the label (without a second comment) when a human removed it after linking', () => {
    // The link comment (marker) is present, so the detector already ran. A human
    // removed the label; that is not a verdict, so the label comes back — but the
    // comment is kept, so no second link is posted.
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_COMMENTS: JSON.stringify([{ body: 'see #800 <!-- duplicate-detect -->' }]),
      GH_STUB_EVENTS: events([
        { event: 'labeled', login: 'cipansor-bot' },
        { event: 'unlabeled', login: 'someone' },
      ]),
    });
    expect(calls).toContain('--add-label duplicate');
    expect(calls).not.toContain('COMMENT');
    expect(out).toContain('Re-applied the duplicate label on #958');
  });

  it('re-applies the label when github-actions[bot] removed it after linking', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_COMMENTS: JSON.stringify([{ body: 'see #800 <!-- duplicate-detect -->' }]),
      GH_STUB_EVENTS: events([
        { event: 'labeled', login: 'cipansor-bot' },
        { event: 'unlabeled', login: 'github-actions[bot]' },
      ]),
    });
    expect(calls).toContain('--add-label duplicate');
    expect(calls).not.toContain('COMMENT');
    expect(out).toContain('Re-applied the duplicate label on #958');
  });

  it('leaves the issue alone when it is linked and no removal is recorded', () => {
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_COMMENTS: JSON.stringify([{ body: 'see #800 <!-- duplicate-detect -->' }]),
      GH_STUB_EVENTS: events([{ event: 'labeled', login: 'cipansor-bot' }]),
    });
    expect(calls).not.toContain('LABEL');
    expect(out).toContain('#958 was already linked');
  });

  it('re-detects after its own rollback (rollback marker present, link never written)', () => {
    // The comment failed and the label was rolled back by the trusted account in
    // one run; the rollback marker says so. The issue is labelled again on the
    // next sweep rather than treated as a permanent verdict.
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_COMMENTS: JSON.stringify([{ body: '<!-- duplicate-detect:rollback -->' }]),
      GH_STUB_EVENTS: unlabeledBy(['cipansor-bot']),
    });
    expect(calls).toContain('--add-label duplicate');
    expect(out).toContain('Labelled #958');
  });

  it('does not read a triage removal as its own rollback (labeled then unlabeled by the bot, no marker)', () => {
    // Round-4 finding: a bot removal beside a label-add with no rollback marker is
    // a triage decision, not this script's rollback — the issue stays unlabelled.
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

  it('does not touch the issue in the relabel path under DUPLICATE_DETECT_DRY_RUN', () => {
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
    expect(out).toContain('would re-apply the duplicate label on #958');
  });

  it('honours a trusted removal after a successful link even if a rollback marker lingers', () => {
    // An earlier run rolled back (marker), a later run linked the issue; the marker
    // is now stale. A trusted removal of the label is a verdict all the same.
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

  it('honours a trusted removal that was not a rollback even without a marker', () => {
    // A trusted `unlabeled` that does not directly follow a trusted `labeled` is
    // a maintainer's verdict, so the issue is left alone.
    const { out, calls } = run({
      GH_STUB_ISSUES: issues([
        { number: 800, title: `${WATCH}38324975861 failed` },
        { number: 958, title: `${WATCH}42569593649 failed` },
      ]),
      GH_STUB_EVENTS: events([
        { event: 'labeled', login: 'cipansor-bot' },
        { event: 'unlabeled', login: 'someone' },
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
