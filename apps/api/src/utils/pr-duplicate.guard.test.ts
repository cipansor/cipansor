import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * Behaviour `pr-duplicate.sh` hides, driven against a stub `gh`:
 *
 *  - two open PRs closing the same issue -> the *newest* is labelled
 *    `duplicate-pr`, the older one (a maintainer is already reviewing it) is not;
 *  - a PR that is the only one closing its issue is never labelled;
 *  - a draft PR is skipped (a draft is not yet claiming the issue);
 *  - a PR already labelled is left alone (idempotent);
 *  - `PR_DUPLICATE_DRY_RUN` proves the whole path without writing.
 *
 * The script only labels; `duplicate-sweep.sh` owns warning and closing, so no
 * second closer is introduced.
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, '.github', 'scripts', 'pr-duplicate.sh');

// The stub honours `--jq`, so the script's real jq expression is what turns the
// JSON array into `pr<TAB>issue` rows. A stub that ignored `--jq` would hide the
// only logic worth testing.
const STUB = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "$GH_STUB_LOG"; }
JQ=""
prev=""
for a in "$@"; do
  [ "$prev" = "--jq" ] && JQ="$a"
  prev="$a"
done
case "$1" in
  pr)
    case "$2" in
      list) if [ -n "$JQ" ]; then printf '%s' "\${GH_STUB_PRS:-[]}" | jq -r "$JQ"; else printf '%s\\n' "\${GH_STUB_PRS:-}"; fi ;;
      view) printf '%s\\n' "\${GH_STUB_LABELS:-}" ;;
      edit) log "EDIT $*" ;;
    esac ;;
esac
exit 0
`;

let dir: string;
let log: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pr-duplicate-'));
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

// gh pr list --json emits one JSON object per line? No: it emits an array. The
// jq expression turns it into `pr<TAB>issue` rows, so the stub feeds the array
// and the real jq runs. Keep the fixtures as the raw JSON array.
const prs = (rows: Array<[number, boolean, number[]]>) =>
  JSON.stringify(
    rows.map(([number, isDraft, closing]) => ({
      number,
      isDraft,
      closingIssuesReferences: closing.map((n) => ({ number: n })),
    }))
  );

describe('pr-duplicate.sh', () => {
  it('labels the newest PR when two open PRs close the same issue', () => {
    const { calls } = run({
      GH_STUB_PRS: prs([
        [101, false, [857]],
        [102, false, [857]],
      ]),
    });
    expect(calls).toContain('EDIT pr edit 102');
    expect(calls).not.toContain('EDIT pr edit 101');
    expect(calls).toContain('--add-label duplicate-pr');
  });

  it('never labels a PR that is the only one closing its issue', () => {
    const { out, calls } = run({ GH_STUB_PRS: prs([[101, false, [900]]]) });
    expect(calls).not.toContain('EDIT');
    expect(out).toContain('Tidak ada PR terbuka');
  });

  it('skips a draft PR when picking the duplicate', () => {
    // The draft (102) is newer but not claiming the issue; the older open PR is
    // the only real claim, so nothing is labelled.
    const { calls } = run({
      GH_STUB_PRS: prs([
        [101, false, [857]],
        [102, true, [857]],
      ]),
    });
    expect(calls).not.toContain('EDIT');
  });

  it('leaves a PR already labelled duplicate-pr alone', () => {
    const { out, calls } = run({
      GH_STUB_PRS: prs([
        [101, false, [857]],
        [102, false, [857]],
      ]),
      GH_STUB_LABELS: 'duplicate-pr',
    });
    expect(calls).not.toContain('EDIT');
    expect(out).toContain('sudah berlabel');
  });

  it('writes nothing under PR_DUPLICATE_DRY_RUN', () => {
    const { calls } = run({
      GH_STUB_PRS: prs([
        [101, false, [857]],
        [102, false, [857]],
      ]),
      PR_DUPLICATE_DRY_RUN: '1',
    });
    expect(calls).not.toContain('EDIT');
  });
});
