import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

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

  it('acts only on a failure on main', () => {
    expect(BRIDGE).toMatch(/conclusion == 'failure'/);
    expect(BRIDGE).toMatch(/head_branch == 'main'/);
    // A fork's pull request from a branch named `main` runs CI here too, with
    // head_branch 'main'; only this repository's own main may report.
    expect(BRIDGE).toMatch(/head_repository\.full_name == github\.repository/);
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
});
