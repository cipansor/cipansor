import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';

/**
 * The PR lifecycle guard (`.github/scripts/pr-lifecycle.sh`, run by
 * `.github/workflows/pr-lifecycle.yml`) reacts to a finished CI/E2E run or a
 * review: it leaves a red PR open and dispatches the `Gerbang tinjau PR` review gate once
 * every check is green. It must never approve or merge.
 *
 * An earlier revision called `gh pr review --approve` once every check was
 * green, its labels matched the linked issue, and `reviewDecision` was not
 * `CHANGES_REQUESTED`. A green PR can still carry unresolved review threads,
 * so that approved a diff nobody had read — the defect `Gerbang tinjau PR`'s review gate
 * exists to prevent. Approval is the review gate's job; a guard test keeps the
 * lifecycle script from quietly growing an approval back.
 *
 * A later revision also reverted a ready PR to draft on red CI or a
 * changes-requested review. That only hid work in progress; the failing checks
 * are already on the PR, and a human decides when to draft. A guard test keeps
 * the revert from coming back too.
 */

const REPO = resolve(__dirname, '..', '..', '..', '..');
const SCRIPT = '.github/scripts/pr-lifecycle.sh';
const WORKFLOW = '.github/workflows/pr-lifecycle.yml';

const lines = (p: string) =>
  readFileSync(join(REPO, p), 'utf8')
    .split('\n')
    .map((line, i) => ({ text: line, n: i + 1 }));

// A line that runs something, not a comment or a message mentioning it.
const runs = (line: string) => !/^\s*#/.test(line) && !/^\s*echo\b/.test(line);

// A `gh pr review`/`gh pr merge` call.
const prVerb = (line: string) => /(^|\s)(gh\s+)?pr\s+(review|merge)\b/.test(line);

/**
 * Every way the script could approve: the `gh pr review --approve` verb, and
 * the same act through the API — a REST review with `event=APPROVE`, or the
 * GraphQL `addPullRequestReview` / `submitPullRequestReview` mutations. The
 * guard used to know only the first, so an approval written as
 * `gh api …/pulls/N/reviews -f event=APPROVE` passed it.
 */
const approves = (line: string) =>
  runs(line) &&
  ((prVerb(line) && /\bapprove\b/.test(line)) ||
    /event[=:]\s*"?APPROVE\b/.test(line) ||
    /\b(addPullRequestReview|submitPullRequestReview)\b/.test(line));

/** Every way it could merge: the verb, the REST merge endpoint, GraphQL, auto-merge. */
const merges = (line: string) =>
  runs(line) &&
  ((prVerb(line) && /\bmerge\b/.test(line)) ||
    /pulls\/[^\s/]+\/merge\b/.test(line) ||
    /\b(mergePullRequest|enablePullRequestAutoMerge)\b|merge-async|--auto\b/.test(line));

describe('the guard recognises every form of the act', () => {
  // What would have to change for the guard to go red? Each of these.
  it.each([
    'gh pr review "$PR" --approve',
    'gh api -X POST "repos/$REPO/pulls/$PR/reviews" -f event=APPROVE',
    'gh api "repos/$REPO/pulls/$PR/reviews" -F event="APPROVE" -f body=ok',
    "gh api graphql -f query='mutation { addPullRequestReview(input: {event: APPROVE}) { clientMutationId } }'",
  ])('flags an approval: %s', (line) => {
    expect(approves(line)).toBe(true);
  });

  it.each([
    'gh pr merge "$PR" --squash',
    'gh api -X PUT "repos/$REPO/pulls/$PR/merge"',
    "gh api graphql -f query='mutation { enablePullRequestAutoMerge(input: {}) { clientMutationId } }'",
  ])('flags a merge: %s', (line) => {
    expect(merges(line)).toBe(true);
  });

  it('does not flag a comment or a message that names the act', () => {
    expect(approves("# Approval is the review gate's job, never `gh pr review --approve`.")).toBe(
      false
    );
    expect(merges('echo "merge is the maintainer\'s call"')).toBe(false);
    expect(approves('gh api "repos/$REPO/pulls/$PR/reviews" --jq \'.[].state\'')).toBe(false);
  });
});

describe('PR lifecycle guard never approves or merges', () => {
  it.each([SCRIPT, WORKFLOW])('%s has no approving call', (file) => {
    const offenders = lines(file)
      .filter(({ text }) => approves(text))
      .map(({ text, n }) => `${file}:${n}: ${text.trim()}`);
    expect(offenders).toEqual([]);
  });

  it.each([SCRIPT, WORKFLOW])('%s has no merging call', (file) => {
    const offenders = lines(file)
      .filter(({ text }) => merges(text))
      .map(({ text, n }) => `${file}:${n}: ${text.trim()}`);
    expect(offenders).toEqual([]);
  });

  it('the script does not convert a red or changes-requested PR to draft', () => {
    const source = readFileSync(join(REPO, SCRIPT), 'utf8');
    // A draft revert was the old behaviour; the guard keeps it from returning.
    expect(source).not.toContain('gh pr ready');
    expect(source).not.toContain('--undo');
  });

  it('the workflow runs when a ready docs PR turns ready', () => {
    const wf = readFileSync(join(REPO, WORKFLOW), 'utf8');
    // A docs-only PR's scope job skips Lint/Build/Tests/E2E, so CI finishes
    // while the PR is still a draft; the ready transition is then the only
    // event left to start the lifecycle. A `workflow_run`-only trigger never
    // sees it, so the PR is never reviewed — the ready trigger is what closes
    // that gap, and the job `if` must admit the pull_request event too.
    expect(wf).toMatch(/pull_request:\s*\n\s*types:\s*\[ready_for_review\]/);
    expect(wf).toContain(
      "github.event_name == 'pull_request' && github.event.pull_request.number != null"
    );
  });

  it('LABELS.md names the review gate as the approver', () => {
    const doc = readFileSync(join(REPO, 'docs/LABELS.md'), 'utf8');
    expect(doc).toMatch(/review gate/i);
  });
});
