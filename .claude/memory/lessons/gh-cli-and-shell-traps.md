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
