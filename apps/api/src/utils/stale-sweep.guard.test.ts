import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { createHash } from 'crypto';

/**
 * Behaviour `stale-sweep.sh` hides, driven against a stub `gh`:
 *
 *  - the timers are the retired `Penjaga issue` prompt's: `question` closes
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
      *"/reviews"*)
        log "API $*"
        printf '%s\\n' "\${GH_STUB_REVIEWS:-}" ;;
      *"/pulls/"*"/comments"*)
        log "API $*"
        printf '%s\\n' "\${GH_STUB_DIFF_COMMENTS:-}" ;;
      *"/commits/"*)
        log "API $*"
        printf '%s\\n' "\${GH_STUB_COMMIT_DATE:-}" ;;
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
    case "$2" in
      list) log "PRLIST $*"; printf '%s\\n' "\${GH_STUB_PR_LIST:-}" ;;
      comment) log "PRCOMMENT $3" ;;
      close) log "PRCLOSE $3" ;;
      *) log "PR $*" ;;
    esac ;;
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
// The one-line marker the sweep posts when it first notices an edit, so the new
// cycle's clock starts at the edit rather than at the pre-edit idle age.
const seen = (at = daysAgo(20), hash = EMPTY_HASH) =>
  `${at}\tcipansor-bot\t<!-- stale-sweep:seen:at:${at} hash:${hash} -->`;

// --- pull-request fixtures ---------------------------------------------------
const PR_MARK = '<!-- stale-sweep:pr:warned -->';
const PR_NOISSUE = '<!-- stale-sweep:pr:noissue -->';

// A PR listing row is `number|isDraft|authorIsBot|createdAt|headOid|issues`.
const prRow = (
  n: number,
  opts: { days: number; head?: string; issues?: string; draft?: boolean; bot?: boolean }
) =>
  `${n}|${opts.draft ? 'true' : 'false'}|${opts.bot ? 'true' : 'false'}|${daysAgo(
    opts.days
  )}|${opts.head ?? 'aaaa'}|${opts.issues ?? ''}`;

// A warning comment on a PR: the marker, the timestamp, an optional `noissue`
// marker, and the head it saw. One line, as the `--jq` collapses newlines.
const prWarned = (at = daysAgo(10), head = 'aaaa', kind: 'hasissue' | 'noissue' = 'hasissue') =>
  `${at}\tcipansor-bot\tWarning ${PR_MARK} <!-- stale-sweep:at:${at} -->${
    kind === 'noissue' ? ` ${PR_NOISSUE}` : ''
  } <!-- stale-sweep:head:${head} -->`;

describe('stale-sweep.sh', () => {
  it('closes a question issue warned about and left unanswered past the grace window', () => {
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,question,priority:medium'),
      GH_STUB_COMMENTS: warned(),
      GH_STUB_BODY: '',
    });
    expect(calls).toContain('CLOSE 7');
    expect(calls).toContain('--reason not planned');
  });

  it('warns, rather than closes, an issue past its close day that was never warned about', () => {
    const { out, calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,question,priority:medium'),
      GH_STUB_COMMENTS: '',
      GH_STUB_BODY: '',
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(calls).toContain('COMMENT 7');
    expect(out).toContain('past the 15d close day');
  });

  it('does not close an issue warned less than the grace window ago', () => {
    // Past the close day but warned only two days ago: the author must still get
    // the full window, not be closed the run after the warning.
    const { calls, out } = run({
      GH_STUB_ISSUE_LIST: row(7, 60, 'bug,question,priority:medium'),
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
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,question,priority:medium'),
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

  it('records the edit and restarts the clock, so a fresh edit is not closed', () => {
    // The bug this guards: the idle timer counts from the last human comment or
    // the creation date, and an edit leaves neither. Without recording the edit,
    // the next run would read the pre-edit age (50d here) and close a description
    // that was updated today.
    const { calls, out } = run({
      GH_STUB_ISSUE_LIST: row(7, 50, 'question,priority:low'),
      GH_STUB_COMMENTS: warned(daysAgo(42)),
      GH_STUB_BODY: 'detail added today',
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(calls).toContain('COMMENT 7');
    expect(out).toContain('Recorded the edit to #7');
    expect(out).toContain('idle 0d');
  });

  it('does not let an old warning close the cycle an edit restarted', () => {
    // The warning is 90 days old and the issue looks idle, but the edit recorded
    // after it began a cycle that was never warned about. Closing here would skip
    // the warning the author is owed for the new cycle, so it warns instead.
    const { calls, out } = run({
      GH_STUB_ISSUE_LIST: row(7, 200, 'question,stale,priority:low'),
      GH_STUB_COMMENTS: `${warned(daysAgo(90), 'deadbeef')}\n${seen(daysAgo(20), sha('edited body'))}`,
      GH_STUB_BODY: 'edited body',
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(out).toContain('edited after the warning');
    expect(calls).toContain('COMMENT 7');
  });

  it('restarts the clock when the description is reverted to an older seen hash', () => {
    // A `seen` marker older than the newest warning no longer governs: the
    // warning's hash is the record in force. Reverting the description to the
    // text an old `seen` marker recorded must not read as "unedited" — that
    // would close an issue edited today on its pre-edit age.
    const { calls, out } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'question,priority:low'),
      GH_STUB_COMMENTS: `${seen(daysAgo(20), sha('body A'))}\n${warned(daysAgo(10), sha('body B'))}`,
      GH_STUB_BODY: 'body A',
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(out).toContain('Recorded the edit to #7');
    expect(out).toContain('idle 0d');
  });

  it('closes the cycle an edit opened once that cycle has been warned and gone quiet', () => {
    // The full life of a restarted cycle: the edit (recorded 80 days ago) spent
    // the first warning; a fresh warning 20 days ago (whose hash matches the body,
    // so no newer edit) has now run its grace window.
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 200, 'question,stale,priority:low'),
      GH_STUB_COMMENTS: `${warned(daysAgo(90), 'deadbeef')}\n${seen(daysAgo(80), sha('edited body'))}\n${warnedStale(daysAgo(20), sha('edited body'))}`,
      GH_STUB_BODY: 'edited body',
    });
    expect(calls).toContain('CLOSE 7');
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
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,question,priority:medium'),
      GH_STUB_COMMENTS: `${warned()}\n${daysAgo(2)}\tcipansor-bot\tTriase selesai.`,
      GH_STUB_BODY: '',
    });
    expect(calls).toContain('CLOSE 7');
  });

  it('does not count a GitHub App comment as a person replying', () => {
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,question,priority:medium'),
      GH_STUB_COMMENTS: `${warned()}\n${daysAgo(2)}\tgithub-actions[bot]\ttriage result`,
      GH_STUB_BODY: '',
    });
    expect(calls).toContain('CLOSE 7');
  });

  it('warns again after an edit goes quiet, instead of never closing', () => {
    // An edit ends the cycle (like a reply), so the stale hash cannot exempt the
    // issue forever: after the issue goes quiet a second time it is warned again.
    // The recorded edit is 40 days old (past question's 15-day close day), so the
    // cycle it opened is warned afresh rather than closed with no notice.
    const { out, calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 50, 'question,priority:low'),
      GH_STUB_COMMENTS: `${warned(daysAgo(60))}\n${seen(daysAgo(40), sha('detail added on day 9'))}`,
      GH_STUB_BODY: 'detail added on day 9',
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(calls).toContain('COMMENT 7');
    expect(out).toContain('past the 15d close day');
  });

  it('spends the recorded edit when the description changes again, starting a new cycle', () => {
    // The `seen` marker is bound to the body it recorded. A second edit makes the
    // hash mismatch, so it is a new cycle: the clock restarts again rather than
    // reusing the first edit's age.
    const { out, calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 200, 'question,priority:low'),
      GH_STUB_COMMENTS: `${warned(daysAgo(90), 'deadbeef')}\n${seen(daysAgo(40), sha('first edit'))}`,
      GH_STUB_BODY: 'a second edit',
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(out).toContain('Recorded the edit to #7');
    expect(out).toContain('idle 0d');
  });

  it('does not treat a bot comment or a label change as an edit', () => {
    // Only the description hash decides an edit. A bot comment and a label change
    // both bump `updatedAt`, which is why it is not the signal; neither may
    // restart the clock.
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,question,priority:medium'),
      GH_STUB_COMMENTS: `${warned()}\n${daysAgo(2)}\tcipansor-bot\tTriase selesai.`,
      GH_STUB_BODY: '',
    });
    expect(calls).toContain('CLOSE 7');
  });

  it('keeps the stale label a restarted cycle still needs, so the new warning matches it', () => {
    // A reply nine days ago is past the warn day but not the close day: the sweep
    // restarts the cycle and warns again. The `stale` label must stay in place, or
    // the next run reads its absence as a maintainer cancellation and exempts the
    // issue forever.
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 9, 'question,stale,priority:low'),
      GH_STUB_COMMENTS: `${warned(daysAgo(30))}\n${daysAgo(9)}\treporter\tstill here`,
      GH_STUB_BODY: '',
    });
    expect(calls).not.toContain('--remove-label stale');
    expect(calls).toContain('COMMENT 7');
    expect(calls).not.toContain('CLOSE 7');
  });

  it('re-applies the stale label when a warning is issued at the warn day without it', () => {
    // Recovery case: if the label is somehow absent when a warn-day warning goes
    // out, it is applied so the warning's `stale` marker and the label agree.
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 9, 'question,priority:low'),
      GH_STUB_COMMENTS: '',
      GH_STUB_BODY: '',
    });
    expect(calls).toContain('--add-label stale');
    expect(calls).toContain('COMMENT 7');
  });

  it('drops a stale label a spent cycle left behind when the issue is still active', () => {
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 3, 'question,stale,priority:low'),
      GH_STUB_COMMENTS: `${warned(daysAgo(30))}\n${daysAgo(3)}\treporter\tstill here`,
      GH_STUB_BODY: '',
    });
    expect(calls).toContain('--remove-label stale');
    expect(calls).not.toContain('--add-label stale');
    expect(calls).not.toContain('COMMENT 7');
  });

  it('exempts ready, blocked, in-progress and duplicate', () => {
    // `pending-maintainer` and `needs-info` were removed from the taxonomy on
    // 2026-11-11, so they are no longer exempt (an issue carrying one is just a
    // plain issue now). `question` is not exempt either — it has its own timer.
    for (const label of ['ready', 'blocked', 'in-progress', 'duplicate']) {
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
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,question,priority:medium'),
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
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,question,priority:medium'),
      GH_STUB_COMMENTS: warned(),
      GH_STUB_BODY: '',
      STALE_SWEEP_DRY_RUN: '1',
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(calls).not.toContain('COMMENT 7');
  });
});

describe('stale-sweep.sh: pull requests', () => {
  it('warns a PR that links no issue, and closes it after 5 days', () => {
    const warnedNoIssue = run({
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PR_LIST: prRow(50, { days: 1 }),
      GH_STUB_COMMENTS: '',
    });
    expect(warnedNoIssue.calls).toContain('PRCOMMENT 50');
    expect(warnedNoIssue.calls).not.toContain('PRCLOSE 50');
    expect(warnedNoIssue.out).toContain('no linked issue');

    const closed = run({
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PR_LIST: prRow(50, { days: 30 }),
      GH_STUB_COMMENTS: prWarned(daysAgo(6), 'aaaa', 'noissue'),
    });
    expect(closed.calls).toContain('PRCLOSE 50');
  });

  it('does not close a no-issue PR whose warning is younger than 5 days', () => {
    const { calls, out } = run({
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PR_LIST: prRow(50, { days: 3 }),
      GH_STUB_COMMENTS: prWarned(daysAgo(2), 'aaaa', 'noissue'),
    });
    expect(calls).not.toContain('PRCLOSE 50');
    expect(out).toContain('within the 5d window');
  });

  it('lets a push reset the no-issue clock only by linking an issue', () => {
    // A new head does NOT buy another window: the defect (no linked issue) is
    // untouched, so the PR still closes on the original clock.
    const { calls } = run({
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PR_LIST: prRow(50, { days: 30, head: 'bbbb' }),
      GH_STUB_COMMENTS: prWarned(daysAgo(6), 'aaaa', 'noissue'),
    });
    expect(calls).toContain('PRCLOSE 50');
  });

  it('restarts the no-issue cycle once an issue is linked', () => {
    const { calls, out } = run({
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PR_LIST: prRow(50, { days: 30, issues: '9' }),
      GH_STUB_COMMENTS: prWarned(daysAgo(6), 'aaaa', 'noissue'),
    });
    expect(calls).not.toContain('PRCLOSE 50');
    expect(out).toContain('changed state after its warning');
  });

  it('warns and closes a PR that links an issue, with no label written', () => {
    const warn = run({
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PR_LIST: prRow(51, { days: 95, issues: '9' }),
      GH_STUB_COMMENTS: '',
    });
    expect(warn.calls).toContain('PRCOMMENT 51');
    expect(warn.out).toContain('Warned PR #51');

    const close = run({
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PR_LIST: prRow(51, { days: 120, issues: '9' }),
      GH_STUB_COMMENTS: prWarned(daysAgo(10), 'aaaa', 'hasissue'),
    });
    expect(close.calls).toContain('PRCLOSE 51');
  });

  it('never adds a label to a pull request', () => {
    const { calls } = run({
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PR_LIST: prRow(51, { days: 95, issues: '9' }),
      GH_STUB_COMMENTS: '',
    });
    expect(calls).not.toContain('--add-label');
    expect(calls).not.toContain('EDIT');
  });

  it('keeps a PR open when a person replied after the warning', () => {
    const { calls, out } = run({
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PR_LIST: prRow(51, { days: 120, issues: '9' }),
      GH_STUB_COMMENTS: `${prWarned(daysAgo(10), 'aaaa', 'hasissue')}\n${daysAgo(1)}\treviewer\tmasih dikerjakan`,
    });
    expect(calls).not.toContain('PRCLOSE 51');
    expect(out).toContain('has a reply after the warning');
  });

  it('lets a new head commit reset the linked-issue clock', () => {
    const { calls, out } = run({
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PR_LIST: prRow(51, { days: 120, head: 'cccc', issues: '9' }),
      GH_STUB_COMMENTS: prWarned(daysAgo(10), 'aaaa', 'hasissue'),
    });
    expect(calls).not.toContain('PRCLOSE 51');
    expect(out).toContain('changed state after its warning');
  });

  it('leaves a draft or bot-authored PR alone', () => {
    for (const opts of [
      { days: 400, draft: true },
      { days: 400, bot: true },
    ]) {
      const { calls, out } = run({
        GH_STUB_ISSUE_LIST: '',
        GH_STUB_PR_LIST: prRow(52, opts),
        GH_STUB_COMMENTS: '',
      });
      expect(calls, JSON.stringify(opts)).not.toContain('PRCLOSE 52');
      expect(calls, JSON.stringify(opts)).not.toContain('PRCOMMENT 52');
      expect(out, JSON.stringify(opts)).toContain('leaving it alone');
    }
  });

  it('writes no PR comment or close under DRY_RUN', () => {
    const { calls } = run({
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PR_LIST: `${prRow(50, { days: 1 })}\n${prRow(51, { days: 95, issues: '9' })}`,
      GH_STUB_COMMENTS: '',
      STALE_SWEEP_DRY_RUN: '1',
    });
    expect(calls).not.toContain('PRCOMMENT');
    expect(calls).not.toContain('PRCLOSE');
  });

  it('counts the head commit as activity, so a fresh push keeps the PR open', () => {
    // The idle clock used to run from the comment/creation date only, so a PR
    // created long ago but pushed today still read as idle for its whole life and
    // was warned again and closed a week later — even though the commit was a
    // week old at most.
    const { calls, out } = run({
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PR_LIST: prRow(50, { days: 120, head: 'bbbb', issues: '9' }),
      GH_STUB_COMMENTS: '',
      GH_STUB_COMMIT_DATE: daysAgo(0),
    });
    expect(calls).not.toContain('PRCOMMENT');
    expect(calls).not.toContain('PRCLOSE');
    expect(out).toContain('nothing to do');
  });

  it('still warns a linked-issue PR whose head commit is genuinely old', () => {
    // The commit date must not exempt everything: a PR whose last commit is also
    // ancient is still stale.
    const { calls } = run({
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PR_LIST: prRow(50, { days: 200, head: 'bbbb', issues: '9' }),
      GH_STUB_COMMENTS: '',
      GH_STUB_COMMIT_DATE: daysAgo(200),
    });
    expect(calls).toContain('PRCOMMENT 50');
  });

  it('keeps a PR open when a reviewer submitted a review after the warning', () => {
    // A review is not an issue comment: it lives on `pulls/reviews`. Counting only
    // the comment list closed a PR that was under active review.
    const { calls, out } = run({
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PR_LIST: prRow(50, { days: 120, issues: '9' }),
      GH_STUB_COMMENTS: prWarned(daysAgo(10)),
      GH_STUB_REVIEWS: `${daysAgo(1)}\treviewer\tLooks close, one nit`,
    });
    expect(calls).not.toContain('PRCLOSE');
    expect(out).toContain('reply after the warning');
  });

  it('keeps a PR open when a reviewer left a diff comment after the warning', () => {
    const { calls, out } = run({
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PR_LIST: prRow(50, { days: 120, issues: '9' }),
      GH_STUB_COMMENTS: prWarned(daysAgo(10)),
      GH_STUB_DIFF_COMMENTS: `${daysAgo(1)}\treviewer\tThis line can be simpler`,
    });
    expect(calls).not.toContain('PRCLOSE');
    expect(out).toContain('reply after the warning');
  });

  it("does not let the bot's own review count as a person", () => {
    const { calls } = run({
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PR_LIST: prRow(50, { days: 120, issues: '9' }),
      GH_STUB_COMMENTS: prWarned(daysAgo(10)),
      GH_STUB_REVIEWS: `${daysAgo(1)}\tcipansor-bot\treviewed`,
    });
    expect(calls).toContain('PRCLOSE 50');
  });
});
