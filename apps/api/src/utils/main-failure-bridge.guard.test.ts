import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * `.github/workflows/main-failure-bridge.yml` is the deterministic half of the
 * deployment monitor: GitHub Actions sees the finished result of every workflow
 * on `main` and dispatches the `Pemantau deployment` automation, which the
 * OpenHands GitHub webhook cannot do (its documented events are `pull_request`,
 * `issues`, `issue_comment`, `push`, `release`, `pull_request_review` — not
 * `workflow_run`). The automation's own `workflow_run` event is best-effort, so
 * this bridge is the reliable path and its shape is a contract:
 *
 *  - it fires only on a finished, FAILED run of a workflow that actually runs
 *    on `main`, never on a failure mid-PR;
 *  - it skips while `main` is still red, so one ongoing breakage does not file
 *    a second issue;
 *  - it dispatches by id and stays harmless when `OPENHANDS_API_KEY` is unset.
 */

const REPO = resolve(__dirname, '..', '..', '..', '..');
const BRIDGE = readFileSync(
  resolve(REPO, '.github', 'workflows', 'main-failure-bridge.yml'),
  'utf8'
);

describe('main-failure-bridge.yml', () => {
  it('triggers on a finished workflow_run only', () => {
    expect(BRIDGE).toMatch(/workflow_run:/);
    expect(BRIDGE).toMatch(/types:\s*\[completed\]/);
    expect(BRIDGE).not.toMatch(/^\s*push:/m);
    expect(BRIDGE).not.toMatch(/^\s*pull_request:/m);
  });

  it('watches the code checks on main, and leaves the deploys to deploy-watch', () => {
    // Read the `workflows:` list itself, not the whole file: the comments name
    // the excluded workflows, so a whole-file check would be self-defeating.
    const list = BRIDGE.match(/workflows:\s*(\[[^\]]*\])/)?.[1] ?? '';
    expect(list).toContain('CI');
    expect(list).toContain('E2E Tests');
    // deploy-watch.yml reports the deploys; listing them here too would open
    // a second issue for one failed deploy.
    expect(list).not.toContain('Deploy staging');
    expect(list).not.toContain('Deploy production');
  });

  it('acts only on a failure on main', () => {
    expect(BRIDGE).toMatch(/conclusion == 'failure'/);
    expect(BRIDGE).toMatch(/head_branch == 'main'/);
    // A fork's pull request from a branch named `main` runs CI here too, with
    // head_branch 'main'; only this repository's own main may dispatch.
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

  it('dispatches the monitor by id and needs no key to stay harmless', () => {
    expect(BRIDGE).toMatch(/\/api\/automation\/v1\/\$MONITOR_ID\/dispatch/);
    expect(BRIDGE).toMatch(/secrets\.OPENHANDS_API_KEY/);
    expect(BRIDGE).toMatch(/OPENHANDS_API_KEY is not set/);
  });

  it('builds the dispatch body with jq and fails visibly when it is refused', () => {
    // String interpolation let a workflow name break out of the JSON string.
    expect(BRIDGE).toMatch(/jq -n --arg run "\$RUN_ID" --arg wf "\$WORKFLOW"/);
    expect(BRIDGE).not.toMatch(/\\"workflow\\":\\"\$WORKFLOW/);
    // Nothing retries a dispatch, so an HTTP error must not pass silently.
    expect(BRIDGE).toMatch(/2\?\?\) echo "Dispatched/);
    expect(BRIDGE).toMatch(/exit 1/);
  });
});
