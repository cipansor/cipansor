import { describe, it, expect } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * `.github/workflows/main-failure-bridge.yml` reports a failed CI/E2E run on
 * `main` as a GitHub issue, deterministically. It replaced the `Pemantau
 * deployment` automation (SDLC 12, retired 2026-11-12): the OpenHands GitHub
 * webhook cannot see `workflow_run`, so the bridge is the reliable path, and a
 * red `main` needs a visible issue, not an LLM sandbox. Its shape is a contract:
 *
 *  - it fires only on a finished, FAILED run of a workflow that actually runs
 *    on `main`, never on a failure mid-PR;
 *  - it skips while `main` is still red, so one ongoing breakage does not file
 *    a second issue;
 *  - it opens the issue itself (no dispatch, no API key) and stays harmless;
 *  - the deterministic rules live in `.github/scripts/main-failure-report.sh`.
 */

const REPO = resolve(__dirname, '..', '..', '..', '..');
const BRIDGE = readFileSync(
  resolve(REPO, '.github', 'workflows', 'main-failure-bridge.yml'),
  'utf8'
);
const SCRIPT = readFileSync(resolve(REPO, '.github', 'scripts', 'main-failure-report.sh'), 'utf8');
const SCRIPT_PATH = join(REPO, '.github', 'scripts', 'main-failure-report.sh');
const E2E = readFileSync(resolve(REPO, '.github', 'workflows', 'e2e-tests.yml'), 'utf8');

// A stub `gh` that answers the two reads the report makes — the open-issue list
// and the issue create/comment writes — so the failure path can be driven.
const STUB = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "$GH_STUB_LOG"; }
case "$1" in
  issue)
    case "$*" in
      *"list"*) [ "\${GH_STUB_LIST_FAIL:-}" = "1" ] && exit 1
                printf '%s\\n' "\${GH_STUB_LIST:-}" ;;
      *"comment"*) log "COMMENT $*" ;;
      *"create"*) log "CREATE $*" ;;
    esac ;;
esac
exit 0
`;

function runReport(env: Record<string, string> = {}, conclusion = 'failure') {
  const dir = mkdtempSync(join(tmpdir(), 'main-failure-'));
  const bin = join(dir, 'gh');
  writeFileSync(bin, STUB, { mode: 0o755 });
  const logPath = join(dir, 'log');
  writeFileSync(logPath, '');
  const res = spawnSync(
    'sh',
    [SCRIPT_PATH, 'CI', '123', 'abcdef1234567890', 'https://run', 'main', conclusion],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH}`,
        REPO: 'cipansor/cipansor',
        GH_TOKEN: 'x',
        GH_STUB_LOG: logPath,
        ...env,
      },
    }
  );
  const log = readFileSync(logPath, 'utf8');
  rmSync(dir, { recursive: true, force: true });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '', log };
}

describe('main-failure-bridge.yml', () => {
  it('triggers on a finished workflow_run only', () => {
    expect(BRIDGE).toMatch(/workflow_run:/);
    expect(BRIDGE).toMatch(/types:\s*\[completed\]/);
    expect(BRIDGE).not.toMatch(/^\s*push:/m);
    expect(BRIDGE).not.toMatch(/^\s*pull_request:/m);
  });

  it('watches the code checks on main, and leaves the deploys alone', () => {
    // Read the `workflows:` list itself, not the whole file: the comments name
    // the excluded workflows, so a whole-file check would be self-defeating.
    const list = BRIDGE.match(/workflows:\s*(\[[^\]]*\])/)?.[1] ?? '';
    expect(list).toContain('CI');
    expect(list).toContain('E2E Tests');
    // Listing a deploy here would open a second issue for one failed deploy;
    // the deploy watchdog was removed on 2026-11-11, so nothing reports them.
    expect(list).not.toContain('Deploy staging');
    expect(list).not.toContain('Deploy production');
  });

  it('acts only on a failure or cancellation on main', () => {
    // `cancelled` joined `failure` (#915): a job killed at its `timeout-minutes`
    // concludes `cancelled`, which `continue-on-error` does not absorb, so the
    // run went `cancelled` and the staging deploy was `skipped` with no report.
    expect(BRIDGE).toMatch(/conclusion == 'failure'/);
    expect(BRIDGE).toMatch(/conclusion == 'cancelled'/);
    // `success` and `skipped` must not be reported: a skipped run is the failure
    // this bridge already reports, not a problem of its own.
    expect(BRIDGE).not.toMatch(/conclusion == 'success'/);
    expect(BRIDGE).not.toMatch(/conclusion == 'skipped'/);
    expect(BRIDGE).toMatch(/head_branch == 'main'/);
    // A fork's pull request from a branch named `main` runs CI here too, with
    // head_branch 'main'; only this repository's own main may report.
    expect(BRIDGE).toMatch(/head_repository\.full_name == github\.repository/);
    // The conclusion is handed to the report, so the issue can name it.
    expect(BRIDGE).toMatch(/CONCLUSION:\s*\$\{\{\s*github\.event\.workflow_run\.conclusion\s*\}\}/);
    expect(BRIDGE).toMatch(/main-failure-report\.sh[^\n]*"\$CONCLUSION"/);
  });

  it('reads the tip of main as a SHA, with no scope it does not use', () => {
    // The tip must come from `commits/main` directly: check names carry the SHA
    // (`CI and E2E passed on <sha>`) and the check-run list is paginated, so a
    // name match silently yields an empty tip and the skip never fires. The
    // legacy `commits/main/status` endpoint is empty in this repo, so it is
    // wrong for the same reason.
    expect(BRIDGE).toMatch(/commits\/main" --jq \.sha/);
    expect(BRIDGE).not.toMatch(/commits\/main\/status/);
    expect(BRIDGE).not.toMatch(/select\(\.name == "CI and E2E passed"\)/);
    // `commits/main` is a contents read; the bridge reads no check runs, so it
    // holds no Checks scope (least privilege).
    expect(BRIDGE).not.toMatch(/^\s*checks: (read|write)$/m);
  });

  it('skips when the tip of main has moved past the failed run', () => {
    expect(BRIDGE).toMatch(/FAILED_SHA:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/);
    expect(BRIDGE).toMatch(/TIP" != "\$FAILED_SHA"/);
    expect(BRIDGE).toMatch(/skip=1/);
  });

  it('opens the issue deterministically, with no dispatch and no API key', () => {
    // `Pemantau deployment` is retired: no `/dispatch`, no `OPENHANDS_API_KEY`,
    // no monitor id. The bridge opens the issue itself through the checked-in
    // script, and needs `issues: write` to do it.
    expect(BRIDGE).not.toContain('/api/automation/v1/');
    expect(BRIDGE).not.toContain('OPENHANDS_API_KEY');
    expect(BRIDGE).not.toContain('MONITOR_ID');
    expect(BRIDGE).toMatch(/main-failure-report\.sh/);
    expect(BRIDGE).toMatch(/issues: write/);
    expect(BRIDGE).toMatch(/uses:\s*actions\/checkout@[0-9a-f]{40}/);
  });

  it('keeps one open issue per workflow, and adds a comment for a repeat', () => {
    // One problem, one issue: a second failure of the same workflow comments on
    // the open issue instead of opening a second one. The marker names the
    // workflow, so `CI` and `E2E Tests` keep separate issues.
    expect(SCRIPT).toContain('<!-- main-failure:${WORKFLOW} -->');
    expect(SCRIPT).toMatch(/gh issue list[^\n]*--state open/);
    expect(SCRIPT).toMatch(/gh issue comment "\$EXISTING"/);
    expect(SCRIPT).toMatch(/gh issue create/);
    expect(SCRIPT).toMatch(/--label bug --label priority:high/);
    // A failure to open the issue must not pass silently.
    expect(SCRIPT).toMatch(/exit 1/);
  });

  it('opens an issue when no open issue matches', () => {
    const r = runReport({ GH_STUB_LIST: '' });
    expect(r.status).toBe(0);
    expect(r.log).toContain('CREATE');
    expect(r.log).not.toContain('COMMENT');
  });

  it('comments on the open issue instead of opening a second one', () => {
    const r = runReport({ GH_STUB_LIST: '431' });
    expect(r.status).toBe(0);
    expect(r.log).toContain('COMMENT');
    expect(r.log).not.toContain('CREATE');
  });

  it('does not open a second issue when the list read fails', () => {
    // A failed listing is not an empty listing: treating it as one filed a
    // duplicate for a workflow that already had an issue (#1061 review).
    const r = runReport({ GH_STUB_LIST_FAIL: '1' });
    expect(r.status).not.toBe(0);
    expect(r.log).not.toContain('CREATE');
    expect(r.stdout + r.stderr).toContain('not treating that as none');
  });

  it('writes the issue in Indonesian prose', () => {
    // GitHub prose is Indonesian (AGENTS.md); only the workflow name and the
    // run link stay as they are. The title and opening line used to be English.
    expect(SCRIPT).toMatch(/TITLE="[^"]*Kegagalan/);
    expect(SCRIPT).toContain('$KIND pada');
    expect(SCRIPT).not.toContain('Deploy watchdog');
    expect(SCRIPT).not.toMatch(/failed on \\`\$BRANCH\\`/);
  });

  it('names the conclusion, so a cancellation is not flattened into a failure', () => {
    // #915: `cancelled` is reported too, and the report must say which one it
    // is — a reader who cannot tell a cancellation from an ordinary failure
    // still cannot act on it.
    const cancelled = runReport({ GH_STUB_LIST: '' }, 'cancelled');
    expect(cancelled.status).toBe(0);
    expect(cancelled.log).toContain('CREATE');
    // The issue body and title carry the conclusion verbatim.
    expect(cancelled.log).toContain('cancelled');
    // The prose distinguishes it: "dibatalkan", not "gagal".
    expect(cancelled.log).toContain('dibatalkan');
    // An ordinary failure keeps its own wording and does not claim cancellation.
    const failed = runReport({ GH_STUB_LIST: '' }, 'failure');
    expect(failed.log).toContain('gagal');
    expect(failed.log).not.toContain('dibatalkan');
  });

  it('keeps a hung cross-browser run a failure, not a cancelled run', () => {
    // The other half of #915 (root cause, K28): the cross-browser job is
    // `continue-on-error`, but a job killed at `timeout-minutes` concludes
    // `cancelled`, which `continue-on-error` does NOT absorb — so a hung WebKit
    // run turned the whole run `cancelled` and the staging deploy `skipped`.
    // Wrapping the command in `timeout` makes the STEP fail (exit 124), which
    // `continue-on-error` absorbs, so the run stays `success`.
    const step =
      E2E.match(/name: Run E2E tests \(\$\{\{ matrix\.browser \}\}\)\n\s*run: ([^\n]+)/)?.[1] ?? '';
    expect(step, 'the cross-browser test step wraps the command in `timeout`').toMatch(
      /^timeout --signal=TERM \d+ pnpm --filter web exec playwright test/
    );
    const seconds = Number(step.match(/^timeout --signal=TERM (\d+)/)?.[1]);
    expect(seconds).toBeGreaterThan(0);

    // The ceiling covers the WHOLE job — checkout, install, seed, build, start
    // the API, the test step and the post steps — while `timeout` starts only
    // when the test command does. So "seconds < ceiling" is not the contract: a
    // timeout of 44 minutes is under the 45-minute ceiling yet a hung run would
    // still be killed by the runner at 45 and conclude `cancelled`, the very
    // outcome #915 removes. The timeout must fit inside the ceiling TOGETHER
    // with preparation and teardown, or the wrap buys nothing. Read the ceiling
    // from the job, so the check tracks the workflow instead of a literal 45.
    const job = E2E.slice(E2E.indexOf('e2e-cross-browser:'));
    const ceilingSeconds = Number(job.match(/timeout-minutes:\s*(\d+)/)?.[1]) * 60;
    expect(ceilingSeconds, 'the cross-browser job sets a timeout-minutes ceiling').toBeGreaterThan(
      0
    );

    // Preparation (job start → the test step) and teardown (the test step → job
    // end), measured across the 68 cross-browser jobs of the 60 most recent
    // completed E2E runs (2026-11-16): preparation min 37s / mean 198s / p95
    // 230s / max 255s; teardown ≤ 10s. The allowance is the observed maximum
    // with margin, so the guard fails if a later timeout is raised past what the
    // ceiling can actually absorb — the "leaves ~5 minutes" claim in the
    // workflow is only true because preparation was measured, not assumed.
    const PREP_MAX = 255;
    const POST_MAX = 30;
    const MARGIN = 60;
    expect(seconds + PREP_MAX + POST_MAX + MARGIN).toBeLessThanOrEqual(ceilingSeconds);
  });
});
