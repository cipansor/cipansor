import { describe, it, expect } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * `.github/scripts/issue-claim.sh` moves an issue `ready` -> `in-progress` when a
 * pull request opens for it. The rule is deliberately narrow and is driven here
 * against a stub `gh`:
 *
 *  - `ready` becomes `in-progress` in ONE edit (both flags together), so the two
 *    labels never coexist on the issue;
 *  - an issue already `in-progress` is left alone (idempotent);
 *  - an issue that is neither `ready` nor `in-progress` (question/blocked/none)
 *    is NOT claimed — a PR alone must not declare work started;
 *  - a closed issue is never touched;
 *  - a fork PR (read-only token) fails visibly instead of passing silently.
 *
 * Plus the contract the workflow and the deploy script share: the workflow fires
 * on `pull_request: opened` and on `issues: labeled` (the reverse order), and
 * `Tiket jadi PR` (SDLC 06) no longer does the move itself now that Actions owns
 * it.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, '.github', 'scripts', 'issue-claim.sh');
const WORKFLOW = join(REPO_ROOT, '.github', 'workflows', 'issue-claim.yml');
const DEPLOY = join(REPO_ROOT, 'scripts', 'deploy-sdlc-agents.py');

const STUB = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "$GH_STUB_LOG"; }
case "$1" in
  api)
    case "$*" in
      *closingIssuesReferences*)
        [ -n "\${GH_STUB_CLOSING_FAIL:-}" ] && exit 1
        printf '%s\\n' "\${GH_STUB_CLOSING:-}" ;;
      *"/issues/"*"/labels"*) printf '%s\\n' "\${GH_STUB_LABELS:-}" ;;
    esac ;;
  issue)
    case "$*" in
      *edit*) log "EDIT $*" ;;
    esac ;;
  pr)
    case "$*" in
      *list*) printf '%s\\n' "\${GH_STUB_PRS:-}" ;;
    esac ;;
esac
exit 0
`;

function run(args: string[], env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'issue-claim-'));
  const bin = join(dir, 'gh');
  writeFileSync(bin, STUB, { mode: 0o755 });
  const logPath = join(dir, 'log');
  writeFileSync(logPath, '');
  const res = spawnSync('sh', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${dir}:${process.env.PATH}`,
      REPO: 'cipansor/cipansor',
      GH_TOKEN: 'x',
      GH_STUB_LOG: logPath,
      ...env,
    },
  });
  const log = readFileSync(logPath, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '', log };
}

describe('issue-claim.sh', () => {
  it('moves ready -> in-progress in one edit when a PR opens', () => {
    const r = run(['42'], {
      GH_STUB_CLOSING: '7',
      GH_STUB_LABELS: 'bug\nready\npriority:medium',
    });
    expect(r.status).toBe(0);
    expect(r.log).toContain(
      'EDIT issue edit 7 --repo cipansor/cipansor --add-label in-progress --remove-label ready'
    );
    expect(r.stdout).toContain("'ready' -> 'in-progress'");
  });

  it('is idempotent when the issue is already in-progress', () => {
    const r = run(['42'], {
      GH_STUB_CLOSING: '7',
      GH_STUB_LABELS: 'bug\nin-progress\npriority:medium',
    });
    expect(r.status).toBe(0);
    expect(r.log).not.toContain('EDIT');
    expect(r.stdout).toContain('already in-progress');
  });

  it('refuses to claim an issue that is neither ready nor in-progress', () => {
    // A `question` issue a PR links must not be silently declared started; the
    // PR-template guard keeps failing until it is genuinely `ready`.
    for (const labels of ['question\nbug', 'blocked\nbug', 'bug\npriority:low']) {
      const r = run(['42'], { GH_STUB_CLOSING: '7', GH_STUB_LABELS: labels });
      expect(r.status).toBe(0);
      expect(r.log).not.toContain('EDIT');
      expect(r.stdout).toContain('refusing to mark it in-progress');
    }
  });

  it('claims the reverse order: a PR exists and the issue becomes ready later', () => {
    const r = run(['--issue', '7'], {
      GH_STUB_PRS: '42',
      GH_STUB_LABELS: 'bug\nready',
    });
    expect(r.status).toBe(0);
    expect(r.log).toContain('EDIT issue edit 7');
  });

  it('does nothing when no open PR closes the issue', () => {
    const r = run(['--issue', '7'], { GH_STUB_PRS: '', GH_STUB_LABELS: 'ready' });
    expect(r.status).toBe(0);
    expect(r.log).not.toContain('EDIT');
    expect(r.stdout).toContain('No open PR closes issue #7');
  });

  it('fails visibly on a fork PR instead of passing silently', () => {
    const r = run(['42'], {
      GH_STUB_CLOSING: '7',
      GH_STUB_LABELS: 'bug\nready',
      READ_ONLY: '1',
    });
    expect(r.status).not.toBe(0);
    expect(r.log).not.toContain('EDIT');
    expect(r.stdout + r.stderr).toContain('from a fork');
  });

  it('does not treat an unreadable close list as "closes no issue"', () => {
    const r = run(['42'], { GH_STUB_CLOSING_FAIL: '1' });
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toContain('not treating that as an empty set');
  });

  it('wires the workflow to the pull request and label events, pinned and scoped', () => {
    const wf = readFileSync(WORKFLOW, 'utf8');
    expect(wf).toMatch(/pull_request:\s*\n\s*types:\s*\[opened/);
    expect(wf).toMatch(/issues:\s*\n\s*types:\s*\[labeled\]/);
    expect(wf).toContain('issues: write');
    // Every Action is pinned to a full SHA (repository rule).
    expect(wf).toMatch(/uses:\s*actions\/checkout@[0-9a-f]{40}/);
    expect(wf).not.toMatch(/uses:\s*actions\/checkout@v\d/);
    expect(wf).toContain('issue-claim.sh');
  });

  it('removes the hand-rolled claim from Tiket jadi PR, now that Actions owns it', () => {
    const script = readFileSync(DEPLOY, 'utf8');
    const at = script.indexOf('"SDLC 06": f"""');
    const tail = script.slice(at, script.indexOf('""",', at));
    // The prompt must not instruct the agent to move the label itself any more:
    // two owners for one move is what the deterministic workflow replaces.
    expect(tail).not.toContain('pasang `in-progress` pada issue');
    expect(tail).not.toMatch(/CABUT `ready`/);
    expect(tail).toContain('issue-claim');
  });
});
