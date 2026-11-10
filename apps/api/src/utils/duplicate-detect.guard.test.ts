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

// The stub answers the two reads the script makes and logs the two writes.
// `index_rows` pipes `gh api --paginate` straight into the script's own `jq`,
// so the issues listing is returned RAW (no `--jq`); the comments read passes
// `--jq '.[].body'`, so the stub honours `--jq` there — otherwise the script's
// real expression would never run and the marker check would be untested.
const STUB = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "$GH_STUB_LOG"; }
if [ "$1" = "issue" ]; then
  case "$2" in
    edit) log "LABEL $*" ;;
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
