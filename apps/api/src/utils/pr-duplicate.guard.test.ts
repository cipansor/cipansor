import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

/**
 * Behaviour `pr-duplicate.sh` hides, driven against a stub `gh`:
 *
 *  - two open PRs closing the same issue -> the *newest* is labelled
 *    `duplicate-pr` as a candidate, the older one (a maintainer is already
 *    reviewing it) is not;
 *  - a PR that is the only one closing its issue is never labelled;
 *  - a draft PR is skipped (a draft is not yet claiming the issue);
 *  - a PR already labelled is left alone (idempotent);
 *  - `PR_DUPLICATE_DRY_RUN` proves the whole path without writing.
 *
 * The script only labels, and the label is a candidate for a maintainer, never
 * an automatic close: nothing here closes a PR (docs/LABELS.md, rule 4).
 */
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, '.github', 'scripts', 'pr-duplicate.sh');
const SWEEP = join(REPO_ROOT, '.github', 'scripts', 'duplicate-sweep.sh');

// The stub honours `--jq`, so the script's real jq expression is what turns the
// JSON array into `pr<TAB>issue` rows. A stub that ignored `--jq` would hide the
// only logic worth testing. A `--label` query (the reconciliation listing) is
// answered from a separate fixture, so the two listings do not collide.
const STUB = `#!/bin/sh
log() { [ -n "\${GH_STUB_LOG:-}" ] && echo "$*" >> "$GH_STUB_LOG"; }
JQ=""
LABEL=""
prev=""
for a in "$@"; do
  [ "$prev" = "--jq" ] && JQ="$a"
  [ "$prev" = "--label" ] && LABEL="$a"
  prev="$a"
done
case "$1" in
  pr)
    case "$2" in
      list)
        if [ -n "$LABEL" ]; then printf '%s' "\${GH_STUB_LABELLED:-[]}" | jq -r "\${JQ:-.}"; else printf '%s' "\${GH_STUB_PRS:-[]}" | jq -r "\${JQ:-.}"; fi ;;
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

// `gh pr list --json` emits an array; the script's real jq turns it into
// `pr<TAB>issue` rows. Keep the fixtures as the raw JSON array.
const prs = (rows: Array<[number, boolean, number[]]>) =>
  JSON.stringify(
    rows.map(([number, isDraft, closing]) => ({
      number,
      isDraft,
      closingIssuesReferences: closing.map((n) => ({ number: n })),
    }))
  );
// The `--label duplicate-pr` listing: an array of `{number}` objects.
const labelled = (nums: number[]) => JSON.stringify(nums.map((number) => ({ number })));

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
    expect(out).toContain('nothing is closed automatically');
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
      GH_STUB_LABELLED: labelled([102]),
    });
    expect(calls).not.toContain('EDIT');
    expect(out).toContain('already carries');
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

  it('never closes a PR: no close command exists in the script', () => {
    // The whole point of the fix: a `duplicate-pr` label is a candidate for a
    // maintainer, and closing is a judgement this script must not make.
    const src = readFileSync(SCRIPT, 'utf8');
    expect(src).not.toMatch(/pr\s+close/);
  });

  it('does not sweep duplicate-pr PRs to closure', () => {
    // `duplicate-sweep.sh` must only ever close `duplicate` ISSUES; a PR labelled
    // `duplicate-pr` is left for a person.
    const src = readFileSync(SWEEP, 'utf8');
    expect(src).toContain('gh issue list');
    expect(src).not.toMatch(/gh\s+pr\s+(list|close)/);
  });
});
