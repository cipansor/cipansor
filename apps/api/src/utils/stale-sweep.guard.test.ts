import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * Behaviour `stale-sweep.sh` hides, driven against a stub `gh`:
 *
 *  - the timers are the retired `Penjaga issue` prompt's: `needs-info` closes
 *    at 20 quiet days, `question` at 15, anything else at 104;
 *  - an issue past its close day that was never warned about is warned, not
 *    closed — the author always gets a window;
 *  - a person's reply after the warning, or an exempt label, keeps it open;
 *  - a comment by the automation account, or by a GitHub App, is not a person;
 *  - pull requests are never touched (`gh issue list` does not return them, and
 *    the script must never reach for `gh pr`).
 *
 * The sweep holds no state between runs: it reads the warning's timestamp back
 * from its own marker, so the clock is what decides, not a stored field.
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

const WARNED_AT = daysAgo(30);
const warned = (at = WARNED_AT) =>
  `${at}\tcipansor-bot\tWarning ${MARK} <!-- stale-sweep:at:${at} -->`;

describe('stale-sweep.sh', () => {
  it('closes a needs-info issue warned about and left unanswered past the grace window', () => {
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,needs-info,priority:medium'),
      GH_STUB_COMMENTS: warned(),
    });
    expect(calls).toContain('CLOSE 7');
    expect(calls).toContain('--reason not planned');
  });

  it('warns, rather than closes, an issue past its close day that was never warned about', () => {
    const { out, calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,needs-info,priority:medium'),
      GH_STUB_COMMENTS: '',
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(calls).toContain('COMMENT 7');
    expect(out).toContain('past the 20d close day');
  });

  it('marks an issue stale and warns at the question timer, before the close day', () => {
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 10, 'question,priority:low'),
      GH_STUB_COMMENTS: '',
    });
    expect(calls).toContain('--add-label stale');
    expect(calls).toContain('COMMENT 7');
    expect(calls).not.toContain('CLOSE 7');
  });

  it('leaves an issue alone before its warn day', () => {
    const { out, calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 5, 'question,priority:low'),
      GH_STUB_COMMENTS: '',
    });
    expect(calls).not.toContain('COMMENT 7');
    expect(calls).not.toContain('CLOSE 7');
    expect(out).toContain('nothing to do');
  });

  it('keeps an issue open when a person replied after the warning', () => {
    const { out, calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,needs-info,priority:medium'),
      GH_STUB_COMMENTS: `${warned()}\n${daysAgo(2)}\treporter\tStill working on it`,
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(out).toContain('reply after the warning');
  });

  it('does not count the automation account as a person replying', () => {
    // `cipansor-bot` is a plain User account, not a `*[bot]` App, so it is
    // matched by login; a comment by it must not keep an issue open.
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,needs-info,priority:medium'),
      GH_STUB_COMMENTS: `${warned()}\n${daysAgo(2)}\tcipansor-bot\tTriase selesai.`,
    });
    expect(calls).toContain('CLOSE 7');
  });

  it('does not count a GitHub App comment as a person replying', () => {
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,needs-info,priority:medium'),
      GH_STUB_COMMENTS: `${warned()}\n${daysAgo(2)}\tgithub-actions[bot]\ttriage result`,
    });
    expect(calls).toContain('CLOSE 7');
  });

  it('exempts pending-maintainer, ready, blocked, in-progress and duplicate', () => {
    for (const label of ['pending-maintainer', 'ready', 'blocked', 'in-progress', 'duplicate']) {
      const { out, calls } = run({
        GH_STUB_ISSUE_LIST: row(7, 400, `bug,${label},priority:medium`),
        GH_STUB_COMMENTS: '',
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
    });
    expect(calls).not.toContain('PR ');
    expect(calls).not.toContain('CLOSE 9');
  });

  it('paginates the comment list so a later reply is seen', () => {
    const { out, calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,needs-info,priority:medium'),
      GH_STUB_COMMENTS: warned(),
      GH_STUB_PAGE2: `${daysAgo(1)}\treporter\tPlease keep this open`,
    });
    expect(calls).toContain('--paginate');
    expect(calls).not.toContain('CLOSE 7');
    expect(out).toContain('reply after the warning');
  });

  it('writes nothing when STALE_SWEEP_DRY_RUN is set', () => {
    const { calls } = run({
      GH_STUB_ISSUE_LIST: row(7, 40, 'bug,needs-info,priority:medium'),
      GH_STUB_COMMENTS: warned(),
      STALE_SWEEP_DRY_RUN: '1',
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(calls).not.toContain('COMMENT 7');
  });
});
