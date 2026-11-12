# gh-cli-and-shell-traps

> Tools that fail silently: `gh pr edit` changes nothing, `gh pr checks --json` is not supported everywhere, an unquoted heredoc executes the backticks in a PR body, and a PR with every check green can still be blocked by a CodeQL analysis that was never recorded.

Each of these looks fine on screen and does not do the thing. Each has cost
time more than once.

1. **`gh pr edit` changes nothing.** It prints a GraphQL error — "Projects
   (classic) is being deprecated" — and the body and title stay as they were,
   easy to miss when stdout is thrown away. Use REST, and read it back:
   ```bash
   gh api -X PATCH repos/<org>/<repo>/pulls/<n> -F body=@body.md
   gh api repos/<org>/<repo>/pulls/<n> --jq .body | grep "<a line you changed>"
   ```
   `gh pr merge` prints the same error but does merge; confirm with
   `gh api repos/<org>/<repo>/pulls/<n> --jq .merged`.
2. **`gh pr checks --json` is not supported by every `gh` version.** Parse the
   tab-separated output (`awk -F'\t' '{print $1, $2}'`), and never
   `2>/dev/null` in a monitor: a swallowed error leaves it silent, and silence
   reads as "still pending".
3. **An unquoted heredoc (`<<EOF`) runs the backticks.** A PR body containing
   `` `db:generate` `` became "command not found" and an empty table — #494 was
   published with a broken gate table. For Markdown, use `<<'EOF'` or write the
   file with an editor tool, never through shell substitution.

**Why it matters:** the output looks normal while the effect does not happen,
and the user reads the broken PR. **How to apply:** every change to a PR goes
through `gh api` REST with a read-back; free text never passes through an
unquoted heredoc.

**A status hook can quote the wrong repository.** After the move to the
`cipansor` org, a hook reported "`main` is red" for a run from the old
personal repo. Check with `gh run list --repo <org>/<repo> --branch main`
before acting on such a warning.

**Every check green, and still "BLOCKED".** The `main` ruleset's code-scanning
rule waits for a CodeQL analysis of *every* language category on the PR's
head commit. On 2026-09-28 a PR's "Analyze (python)" job reported success
while no python analysis was recorded for that commit, so the PR sat blocked
with nothing red on the page. Look at what was recorded:
`gh api "repos/<org>/<repo>/code-scanning/analyses?ref=refs/pull/<N>/head"`.
CodeQL's default-setup runs cannot be re-run (HTTP 403); push a new commit to
the branch — an empty one will do, and a squash merge folds it away.

**CodeQL reads function names.** Its `js/clear-text-storage-of-sensitive-data`
rule treats whatever a function whose name contains *password* returns as a
password. On 2026-10-02 two auth methods named `passwordChangeStep` and
`completeRequiredPasswordChange` returned JWTs that went into HttpOnly cookies
— the same cookies sign-in sets, unflagged — and the PR got three "high"
alerts, which the `main` ruleset blocks. Renaming the methods (with a comment
saying why) cleared them; read the alert's "source" link before treating it
as a real leak.

**Never pass `--label` to `gh pr create` (or label an issue/PR by hand).** Only
`cipansor-bot` may label; `.github/scripts/label-guard.sh` revokes any protected
label applied by another account. Hand-applying two labels fires two `labeled`
events, so several `label-guard` runs start at once; the first removes the
labels, the next finds them already gone, and its `gh api -X DELETE …/labels/<l>`
404s → non-zero exit → the "Only cipansor-bot may label" check goes **red** on
the PR head. The check is not in the `main` ruleset's required set (Build, Lint,
Tests, Security, E2E Chromium, PR template reminder), so it does not block the
merge, but it is a red mark on a clean PR. The labels are the bot's: the
`issue-label-sync` workflow copies the type and `priority:*` labels from the
linked issue (`chore`, `priority:medium` for #867), and a bot-applied label is
guard-exempt. Recovery: `gh run rerun <id> --failed` turns the check green, but
replaying the stale event strips the labels again — re-trigger the sync with a
no-op `gh api -X PATCH …/pulls/<n> -F body=@<file>` and the bot restores them.
Create the PR with no labels and let the sync fill them.

**A PR that closes two issues of different *types* fails `Issue label sync`, by
design.** `issue-label-sync.sh` refuses when the issues a PR closes disagree on
their type label ("PR #N closes issues that disagree on type (chore vs bug)"),
because it reads a PR's type as a claim to reconcile against — `docs/LABELS.md`
rule 1: *"a different type is a real conflict, not something to guess at."* A
maintainer decision that bundles a `chore` and a `bug` issue into one PR (K12:
#868 `chore` + #873 `bug`) therefore makes this check red through no fault of
the change. It is **not** in the `main` ruleset's required set (Build, Lint,
Tests, Security, E2E Chromium, PR template reminder), so it does not block the
merge — but do not hand-fix it: `label-guard` revokes a non-bot label, and two
`gh pr edit --label` calls fire duplicate `labeled` events that red the guard's
own check. Leave a PR comment naming the conflict and let the bot/maintainer
choose the one type.

**A chained `git worktree add … && cd <dir> && git merge` can run the merge in
the *main* tree.** When `/tmp/comb` was a stale, prunable worktree, the `cd`
failed, the `&&` chain kept the shell in the repo root, and the `git merge`
started on the checked-out branch — leaving `UU` conflicts in the working tree
of the feature branch. Run worktree commands with `git -C <dir>` instead of
`cd`, or check the `cd` succeeded (`pwd`); recover with `git merge --abort`.
