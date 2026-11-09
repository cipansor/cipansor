import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { createHash } from 'crypto';

/**
 * Behaviour `stale-sweep.sh` hides, driven against a stub `gh`:
 *
 *  - the timers are the retired `Penjaga issue` prompt's: `needs-info` closes
 *    at 20 quiet days, `question` at 15, anything else at 104;
 *  - an issue past its close day that was never warned about is warned, not
 *    closed — the author always gets a window, and the warning buys the full
 *    grace window (an issue warned today is not closed tomorrow);
 *  - a person's reply after the warning, or an exempt label, keeps it open;
 *  - an edit to the description with no comment is also an answer: it is caught
 *    by comparing the hash recorded in the warning, since GitHub bumps
 *    `updatedAt` for comments too;
 *  - removing the `stale` label a warning applied cancels the close;
 *  - a reply only governs the cycle it answered: the sweep warns again when the
 *    issue goes quiet a second time rather than reading the same old reply on
 *    every run;
 *  - a comment by the automation account, or by a GitHub App, is not a person;
 *  - pull requests are never touched (`gh issue list` does not return them, and
 *    the script must never reach for `gh pr`).
 *
 * The sweep holds no state between runs: it reads the warning's timestamp and
 * description hash back from its own markers, so the clock and the body are what
 * decide, not a stored field.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SWEEP = join(REPO_ROOT, '.github', 'scripts', 'stale-sweep.sh');

const MARK = '<!-- stale-sweep:warned -->';

const STUB = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "$GH_STUB_LOG"; }
case "$1" in
  api)
    case "$*" in
      *"/comments"*)
        log "API $*"
        printf '%s\\n' "\${GH_STUB_COMMENTS:-}"
        case "$*" in *--paginate*) [ -n "\${GH_STUB_PAGE2:-}" ] && printf '%s\\n' "\${GH_STUB_PAGE2}" ;; esac ;;
    esac ;;
  issue)
    case "$2" in
      list) log "API $*"; printf '%s\\n' "\${GH_STUB_ISSUE_LIST:-}" ;;
      view) log "VIEW $*"; printf '%s\\n' "\${GH_STUB_BODY:-}" ;;
      comment) log "COMMENT $3" ;;
      edit) log "EDIT $*" ;;
      close) log "CLOSE $3"; log "CMD $*" ;;
    esac ;;
  pr)
    log "PR $*" ;;
esac
exit 0
`;

let dir: string;
let log: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'stale-sweep-'));
  writeFileSync(join(dir, 'gh'), STUB, { mode: 0o755 });
  log = join(dir, 'calls.log');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(env: Record<string, string>) {
  writeFileSync(log, '');
  const r = spawnSync('sh', [SWEEP], {
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

// ISO-8601 in the shape `gh --json createdAt` prints, N days before now.
const daysAgo = (d: number) =>
  new Date(Date.now() - d * 86400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

// A listing row is `number|createdAt|labels`.
const row = (n: number, days: number, labels: string) => `${n}|${daysAgo(days)}|${labels}`;

const sha = (t: string) => createHash('sha256').update(t).digest('hex');
const EMPTY_HASH = sha('');

// The warning shapes the sweep now posts. `stale` marks a warning that applied
// the `stale` label (so a later removal is recognisable); the hash lets a later
// run see an edit that left no comment.
const warned = (at = daysAgo(30), hash = EMPTY_HASH) =>
  `${at}\tcipansor-bot\tWarning ${MARK} <!-- stale-sweep:at:${at} --> <!-- stale-sweep:hash:${hash} -->`;
const warnedStale = (at = daysAgo(30), hash = EMPTY_HASH) =>
  `${at}\tcipansor-bot\tWarning ${MARK} <!-- stale-sweep:at:${at} --> <!-- stale-sweep:stale --> <!-- stale-sweep:hash:${hash} -->`;

describe('stale-sweep.sh', () => {
  it('closes a needs-info issue warned about and left unanswered past the grace window', () => {
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,needs-info,priority:medium'),
      GH_STUB_COMMENTS: warned(),
      GH_STUB_BODY: '',
    });
    expect(calls).toContain('CLOSE 7');
    expect(calls).toContain('--reason not planned');
  });

  it('warns, rather than closes, an issue past its close day that was never warned about', () => {
    const { out, calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,needs-info,priority:medium'),
      GH_STUB_COMMENTS: '',
      GH_STUB_BODY: '',
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(calls).toContain('COMMENT 7');
    expect(out).toContain('past the 20d close day');
  });

  it('does not close an issue warned less than the grace window ago', () => {
    // Past the close day but warned only two days ago: the author must still get
    // the full window, not be closed the run after the warning.
    const { calls, out } = run({
      GH_STUB_ISSUE_LIST: row(7, 60, 'bug,needs-info,priority:medium'),
      GH_STUB_COMMENTS: warned(daysAgo(2)),
      GH_STUB_BODY: '',
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(out).toContain('grace period');
  });

  it('marks an issue stale and warns at the question timer, before the close day', () => {
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 10, 'question,priority:low'),
      GH_STUB_COMMENTS: '',
      GH_STUB_BODY: '',
    });
    expect(calls).toContain('--add-label stale');
    expect(calls).toContain('COMMENT 7');
    expect(calls).not.toContain('CLOSE 7');
  });

  it('leaves an issue alone before its warn day', () => {
    const { out, calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 5, 'question,priority:low'),
      GH_STUB_COMMENTS: '',
      GH_STUB_BODY: '',
    });
    expect(calls).not.toContain('COMMENT 7');
    expect(calls).not.toContain('CLOSE 7');
    expect(out).toContain('nothing to do');
  });

  it('keeps an issue open when a person replied after the warning', () => {
    const { out, calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,needs-info,priority:medium'),
      GH_STUB_COMMENTS: `${warned()}\n${daysAgo(2)}\treporter\tStill working on it`,
      GH_STUB_BODY: '',
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(out).toContain('reply after the warning');
  });

  it('keeps an issue open when the description was edited after the warning', () => {
    // A body edit leaves no comment: only the hash recorded in the warning makes
    // it visible. The author answered by editing, so the issue is alive.
    const { calls, out } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'question,stale,priority:low'),
      GH_STUB_COMMENTS: warnedStale(),
      GH_STUB_BODY: 'more detail was added',
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(out).toContain('edited after the warning');
  });

  it('keeps an issue open when its stale label was removed after the warning', () => {
    // The warning says removing `stale` keeps the issue open; a maintainer who
    // did so already reversed the decision, and the sweep must not close on it.
    const { calls, out } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'question,priority:low'),
      GH_STUB_COMMENTS: warnedStale(),
      GH_STUB_BODY: '',
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(out).toContain('stale label removed after the warning');
  });

  it('closes an issue whose stale label is still present and whose body is unchanged', () => {
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'question,stale,priority:low'),
      GH_STUB_COMMENTS: warnedStale(),
      GH_STUB_BODY: '',
    });
    expect(calls).toContain('CLOSE 7');
  });

  it('honours the newest warning, not the first, after a reply', () => {
    // A reply restarts the cycle and the sweep posts a fresh warning; a stale
    // first marker must not let an old reply suppress the close forever.
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 120, 'question,stale,priority:low'),
      GH_STUB_COMMENTS: `${warned(daysAgo(90))}\n${daysAgo(60)}\treporter\tstill relevant\n${warnedStale(daysAgo(20))}`,
      GH_STUB_BODY: '',
    });
    expect(calls).toContain('CLOSE 7');
  });

  it('warns again after a reply goes quiet, instead of never closing', () => {
    // Once someone replied, the reply is in the history forever; the sweep must
    // not read it on every run and skip the timer for good. After the cycle
    // resets and the issue goes quiet past the close day, it is warned again.
    const { out, calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 200, 'question,priority:low'),
      GH_STUB_COMMENTS: `${warned(daysAgo(120))}\n${daysAgo(110)}\treporter\tstill relevant`,
      GH_STUB_BODY: '',
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(calls).toContain('COMMENT 7');
    expect(out).toContain('past the 15d close day');
  });

  it('does not count the automation account as a person replying', () => {
    // `cipansor-bot` is a plain User account, not a `*[bot]` App, so it is
    // matched by login; a comment by it must not keep an issue open.
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,needs-info,priority:medium'),
      GH_STUB_COMMENTS: `${warned()}\n${daysAgo(2)}\tcipansor-bot\tTriase selesai.`,
      GH_STUB_BODY: '',
    });
    expect(calls).toContain('CLOSE 7');
  });

  it('does not count a GitHub App comment as a person replying', () => {
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,needs-info,priority:medium'),
      GH_STUB_COMMENTS: `${warned()}\n${daysAgo(2)}\tgithub-actions[bot]\ttriage result`,
      GH_STUB_BODY: '',
    });
    expect(calls).toContain('CLOSE 7');
  });

  it('exempts pending-maintainer, ready, blocked, in-progress and duplicate', () => {
    for (const label of ['pending-maintainer', 'ready', 'blocked', 'in-progress', 'duplicate']) {
      const { out, calls } = run({
        GH_STUB_ISSUE_LIST: row(7, 400, `bug,${label},priority:medium`),
        GH_STUB_COMMENTS: '',
        GH_STUB_BODY: '',
      });
      expect(calls, label).not.toContain('CLOSE 7');
      expect(calls, label).not.toContain('COMMENT 7');
      expect(out, label).toContain('exempt');
    }
  });

  it('never touches a pull request', () => {
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(9, 400, 'bug,priority:medium'),
      GH_STUB_COMMENTS: '',
      GH_STUB_BODY: '',
    });
    expect(calls).not.toContain('PR ');
    expect(calls).not.toContain('CLOSE 9');
  });

  it('paginates the comment list so a later reply is seen', () => {
    const { out, calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,needs-info,priority:medium'),
      GH_STUB_COMMENTS: warned(),
      GH_STUB_PAGE2: `${daysAgo(1)}\treporter\tPlease keep this open`,
      GH_STUB_BODY: '',
    });
    expect(calls).toContain('--paginate');
    expect(calls).not.toContain('CLOSE 7');
    expect(out).toContain('reply after the warning');
  });

  it('writes nothing when STALE_SWEEP_DRY_RUN is set', () => {
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,needs-info,priority:medium'),
      GH_STUB_COMMENTS: warned(),
      GH_STUB_BODY: '',
      STALE_SWEEP_DRY_RUN: '1',
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(calls).not.toContain('COMMENT 7');
  });
});
