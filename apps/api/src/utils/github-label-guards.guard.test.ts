import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { createHash } from 'crypto';

/**
 * Behaviour the shapes of `duplicate-sweep.sh` and `issue-label-sync.sh` hide,
 * driven against a stub `gh`:
 *
 *  - a duplicate whose description was edited after the warning, or that a
 *    person answered, must stay open; only an untouched issue (or one only a
 *    bot commented on) closes. The edit is detected from the body hash recorded
 *    in the warning, not from updatedAt;
 *  - the label sync must reconcile *every* issue a PR closes, fail when two of
 *    them disagree, and leave the PR's labels alone when it fails;
 *  - a failed closing-issues query must fail the check, not look like "closes
 *    no issue".
 *
 * Each check fails against the pre-review script and passes after it.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SWEEP = join(REPO_ROOT, '.github', 'scripts', 'duplicate-sweep.sh');
const SYNC = join(REPO_ROOT, '.github', 'scripts', 'issue-label-sync.sh');

const MARK = '<!-- duplicate-sweep:warned -->';
const AI = 'This comment was created by an AI agent';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const STUB = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "$GH_STUB_LOG"; }
case "$1" in
  api)
    case "$*" in
      *graphql*)
        [ "\${GH_STUB_CLOSING_FAIL:-}" = "1" ] && { echo "gh: graphql unavailable" >&2; exit 1; }
        printf '%s\\n' "\${GH_STUB_CLOSING:-}" ;;
      *check-runs*)
        log "CHECKRUN $*"
        [ "\${GH_STUB_CHECKRUN_FAIL:-}" = "1" ] && { echo "gh: check-runs 403" >&2; exit 1; } ;;
      *"/comments"*)
        log "API $*"
        printf '%s\\n' "\${GH_STUB_COMMENTS:-}"
        case "$*" in *--paginate*) [ -n "\${GH_STUB_PAGE2:-}" ] && printf '%s\\n' "\${GH_STUB_PAGE2}" ;; esac ;;
    esac ;;
  issue)
    case "$2" in
      list) log "API $*"; printf '%s\\n' "\${GH_STUB_ISSUE_LIST:-}" ;;
      view) case "$*" in
          *"--json body"*) printf '%s\\n' "\${GH_STUB_BODY:-}" ;;
          *) eval "printf '%s\\n' \\"\\\${GH_STUB_ISSUE_LABELS_$3:-}\\"" ;;
        esac ;;
      comment) log "COMMENT $*" ;;
      close) log "CLOSE $3"; log "CMD $*" ;;
    esac ;;
  pr)
    case "$2" in
      view) case "$*" in
          *"--json headRefOid"*) printf '%s\\n' "\${GH_STUB_PR_HEAD:-deadbeef}" ;;
          *"--json body"*) printf '%s\\n' "\${GH_STUB_PR_BODY:-}" ;;
          *) printf '%s\\n' "\${GH_STUB_PR_LABELS:-}" ;;
        esac ;;
      edit) log "EDIT $*" ;;
      comment) log "COMMENT $*" ;;
      close) log "CLOSE $3"; log "CMD $*" ;;
      list) log "API $*"; printf '%s\\n' "\${GH_STUB_PRS:-}" ;;
    esac ;;
esac
exit 0
`;

let dir: string;
let log: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'issue-guards-'));
  writeFileSync(join(dir, 'gh'), STUB, { mode: 0o755 });
  log = join(dir, 'calls.log');
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(script: string, env: Record<string, string>, args: string[] = []) {
  writeFileSync(log, '');
  const r = spawnSync('sh', [script, ...args], {
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

const WARNED = '2020-01-01T00:00:00Z';
const BODY = 'the original report';
// The warning records the hash of the body at warn time, in three-field form:
// created_at <TAB> author association <TAB> body.
const warningLine = `${WARNED}\tmaintainer\tWarning ${MARK} <!-- duplicate-sweep:hash:${sha(BODY)} -->`;

describe('duplicate-sweep.sh', () => {
  it('closes a duplicate warned about long ago with no reply or edit', () => {
    const { calls } = run(SWEEP, {
      GH_STUB_ISSUE_LIST: '7',
      GH_STUB_COMMENTS: warningLine,
      GH_STUB_BODY: BODY,
    });
    expect(calls).toContain('CLOSE 7');
  });

  it('keeps a duplicate open when its description was edited after the warning', () => {
    const { out, calls } = run(SWEEP, {
      GH_STUB_ISSUE_LIST: '7',
      GH_STUB_COMMENTS: warningLine,
      GH_STUB_BODY: 'a reproduction was added',
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(out).toContain('edited after the warning');
  });

  it('keeps a duplicate open when a person replied after the warning', () => {
    const { out, calls } = run(SWEEP, {
      GH_STUB_ISSUE_LIST: '7',
      GH_STUB_COMMENTS: `${warningLine}\n2020-01-02T00:00:00Z\treporter\tIt is not a duplicate because X`,
      GH_STUB_BODY: BODY,
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(out).toContain('reply after the warning');
  });

  it('still closes when only the automation account commented after the warning', () => {
    // The anti-loop guard is the author, not a footer: a `cipansor-bot` comment
    // (a plain User account, not a `*[bot]` App) is automated and must not
    // count as a person's reply.
    const { calls } = run(SWEEP, {
      GH_STUB_ISSUE_LIST: '7',
      GH_STUB_COMMENTS: `${warningLine}\n2020-01-02T00:00:00Z\tcipansor-bot\tTriase selesai.`,
      GH_STUB_BODY: BODY,
    });
    expect(calls).toContain('CLOSE 7');
  });

  it('ignores a bot account reply', () => {
    const { calls } = run(SWEEP, {
      GH_STUB_ISSUE_LIST: '7',
      GH_STUB_COMMENTS: `${warningLine}\n2020-01-02T00:00:00Z\tgithub-actions[bot]\ttriage result`,
      GH_STUB_BODY: BODY,
    });
    expect(calls).toContain('CLOSE 7');
  });

  it('records the body hash and no AI footer in its warning', () => {
    const { calls } = run(SWEEP, {
      GH_STUB_ISSUE_LIST: '7',
      GH_STUB_COMMENTS: '',
      GH_STUB_BODY: BODY,
    });
    expect(calls).toContain('COMMENT');
    // No AI-disclosure footer: the account name marks the comment automated.
    expect(calls).not.toContain(AI);
    expect(calls).toContain(`duplicate-sweep:hash:${sha(BODY)}`);
  });

  it('paginates the comment list so a later reply is seen', () => {
    // The warning is on page 1; a person's reply only appears on page 2. A
    // single-page read would miss it and close the issue.
    const { out, calls } = run(SWEEP, {
      GH_STUB_ISSUE_LIST: '7',
      GH_STUB_COMMENTS: warningLine,
      GH_STUB_PAGE2: '2020-01-02T00:00:00Z\treporter\tIt is not a duplicate because Y',
      GH_STUB_BODY: BODY,
    });
    expect(calls).toContain('--paginate');
    expect(out).toContain('reply after the warning');
    expect(calls).not.toContain('CLOSE 7');
  });

  it('leaves an issue open when its warning carries no body hash', () => {
    // A warning posted before the hash marker existed gives no way to tell
    // whether the body changed; the sweep must not close on that guess.
    const { out, calls } = run(SWEEP, {
      GH_STUB_ISSUE_LIST: '7',
      GH_STUB_COMMENTS: `${WARNED}\tmaintainer\tWarning ${MARK}`,
      GH_STUB_BODY: BODY,
    });
    expect(calls).not.toContain('CLOSE 7');
    expect(out).toContain('without a description hash');
  });

  it('sweeps pull requests labelled duplicate-pr too', () => {
    const { calls } = run(SWEEP, {
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PRS: '9',
      GH_STUB_PR_BODY: BODY,
    });
    // maintenance: a PR list was queried under the duplicate-pr label
    expect(calls).toContain('--label duplicate-pr');
    expect(calls).toContain('pr comment 9');
  });

  it('closes a stale duplicate pull request with pr close, not issue close', () => {
    const { calls } = run(SWEEP, {
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PRS: '9',
      GH_STUB_COMMENTS: warningLine,
      GH_STUB_PR_BODY: BODY,
    });
    expect(calls).toContain('CLOSE 9');
    expect(calls).toContain('CMD pr close 9');
    expect(calls).not.toContain('issue close 9');
  });

  it('keeps a duplicate PR open when its description was edited', () => {
    const { out, calls } = run(SWEEP, {
      GH_STUB_ISSUE_LIST: '',
      GH_STUB_PRS: '9',
      GH_STUB_COMMENTS: warningLine,
      GH_STUB_PR_BODY: 'a link to the distinct fix was added',
    });
    expect(calls).not.toContain('CLOSE 9');
    expect(out).toContain('edited after the warning');
  });
});

describe('issue-label-sync.sh', () => {
  it('fails when two issues a PR closes disagree on the type', () => {
    const { status, out } = run(
      SYNC,
      {
        GH_STUB_CLOSING: '3\n4',
        GH_STUB_PR_LABELS: 'bug\npriority:high',
        GH_STUB_ISSUE_LABELS_3: 'bug\npriority:high',
        GH_STUB_ISSUE_LABELS_4: 'enhancement\npriority:high',
      },
      ['7']
    );
    expect(status).toBe(1);
    expect(out).toContain('disagree on type');
  });

  it('does not change the PR labels when the issues disagree', () => {
    const { calls } = run(
      SYNC,
      {
        GH_STUB_CLOSING: '3\n4',
        GH_STUB_PR_LABELS: 'bug\npriority:high',
        GH_STUB_ISSUE_LABELS_3: 'bug\npriority:low',
        GH_STUB_ISSUE_LABELS_4: 'enhancement\npriority:critical',
      },
      ['7']
    );
    expect(calls).not.toContain('EDIT');
  });

  it('fails when the closing-issues query errors', () => {
    const { status, out } = run(SYNC, { GH_STUB_CLOSING_FAIL: '1' }, ['7']);
    expect(status).toBe(1);
    expect(out).toContain('Could not read the issues');
  });

  it('passes when every issue a PR closes agrees', () => {
    const { status, out } = run(
      SYNC,
      {
        GH_STUB_CLOSING: '3\n4',
        GH_STUB_PR_LABELS: 'bug\npriority:high',
        GH_STUB_ISSUE_LABELS_3: 'bug\npriority:high',
        GH_STUB_ISSUE_LABELS_4: 'bug\npriority:high',
      },
      ['7']
    );
    expect(status).toBe(0);
    expect(out).toContain('in sync');
  });

  it('has nothing to sync when the PR closes no issue', () => {
    const { status, out } = run(SYNC, { GH_STUB_CLOSING: '' }, ['7']);
    expect(status).toBe(0);
    expect(out).toContain('closes no issue');
  });

  it('re-checks every open PR that closes a relabelled issue', () => {
    const { status } = run(
      SYNC,
      {
        GH_STUB_PRS: '7',
        GH_STUB_CLOSING: '3',
        GH_STUB_PR_LABELS: 'bug\npriority:high',
        GH_STUB_ISSUE_LABELS_3: 'bug\npriority:high',
      },
      ['--issue', '3']
    );
    expect(status).toBe(0);
  });

  it('publishes one check run against the PR head, not the default branch', () => {
    const { calls } = run(
      SYNC,
      {
        GH_STUB_PRS: '7',
        GH_STUB_CLOSING: '3',
        GH_STUB_PR_HEAD: 'sha7',
        GH_STUB_PR_LABELS: 'bug\npriority:high',
        GH_STUB_ISSUE_LABELS_3: 'bug\npriority:high',
      },
      ['--issue', '3']
    );
    expect(calls).toContain('CHECKRUN');
    expect(calls).toContain('head_sha=sha7');
    expect(calls).toContain('conclusion=success');
  });

  it('publishes a failing check run on the PR head when the relabel breaks sync', () => {
    const { status, calls } = run(
      SYNC,
      {
        GH_STUB_PRS: '7',
        GH_STUB_CLOSING: '3',
        GH_STUB_PR_HEAD: 'sha7',
        GH_STUB_PR_LABELS: 'bug\npriority:high',
        GH_STUB_ISSUE_LABELS_3: 'enhancement\npriority:high',
      },
      ['--issue', '3']
    );
    expect(status).toBe(1);
    expect(calls).toContain('head_sha=sha7');
    expect(calls).toContain('conclusion=failure');
  });

  it('corrects a stale priority with a single edit', () => {
    const { calls } = run(
      SYNC,
      {
        GH_STUB_CLOSING: '3',
        GH_STUB_PR_LABELS: 'bug\npriority:low',
        GH_STUB_ISSUE_LABELS_3: 'bug\npriority:high',
      },
      ['7']
    );
    const edits = calls.split('\n').filter((l) => l.startsWith('EDIT'));
    expect(edits).toHaveLength(1);
    expect(edits[0]).toContain('--add-label priority:high');
    expect(edits[0]).toContain('--remove-label priority:low');
  });

  it('fails a fork PR whose labels differ, naming what a maintainer must apply', () => {
    const { status, out, calls } = run(
      SYNC,
      {
        READ_ONLY: '1',
        GH_STUB_CLOSING: '3',
        GH_STUB_PR_LABELS: 'bug\npriority:low',
        GH_STUB_ISSUE_LABELS_3: 'bug\npriority:high',
      },
      ['7']
    );
    // Read-only, so no edit; but the check must not pass with the labels wrong.
    expect(status).toBe(1);
    expect(calls).not.toContain('EDIT');
    expect(out).toContain('from a fork');
    expect(out).toContain('priority:high');
  });

  it('passes a fork PR whose labels already match', () => {
    const { status } = run(
      SYNC,
      {
        READ_ONLY: '1',
        GH_STUB_CLOSING: '3',
        GH_STUB_PR_LABELS: 'bug\npriority:high',
        GH_STUB_ISSUE_LABELS_3: 'bug\npriority:high',
      },
      ['7']
    );
    expect(status).toBe(0);
  });

  it('fails the issue-event run when the check run cannot be published', () => {
    // The POST is the only thing that lands the outcome on the PR head; a silent
    // failure would leave the previous (possibly green) check in place.
    const { status, out } = run(
      SYNC,
      {
        GH_STUB_PRS: '7',
        GH_STUB_CLOSING: '3',
        GH_STUB_PR_HEAD: 'sha7',
        GH_STUB_PR_LABELS: 'bug\npriority:high',
        GH_STUB_ISSUE_LABELS_3: 'bug\npriority:high',
        GH_STUB_CHECKRUN_FAIL: '1',
      },
      ['--issue', '3']
    );
    expect(status).toBe(1);
    expect(out).toContain('could not publish a check run');
  });
});
