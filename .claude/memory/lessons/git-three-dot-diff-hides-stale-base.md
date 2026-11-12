# git-three-dot-diff-hides-stale-base

> `git diff main...branch` cannot see that a branch is behind `main`. Measure from the merge base, re-measure before quoting an old warning, and merge paired PRs in a worktree before trusting two green checks.

## A stale branch looks identical to `main`

On 2026-08-15 a branch that "already existed" was checked with:

```
git log --oneline main..branch    # empty
git diff --stat main...branch     # empty
```

"Empty, empty" read as "identical to main", and 63 files of work went onto
it. It was **53 commits behind** and would have reverted #397–#404.

- `main..branch` lists commits the branch has that `main` lacks. An ancestor
  has none — right answer, wrong question.
- `main...branch` diffs **merge-base(main, branch)** against the branch. If
  the branch is an ancestor, the merge base *is* the branch, so the diff is
  empty **by definition** for any branch that is merely behind.

Ask the reverse question:

```
git log --oneline branch..main | wc -l     # commits the branch is MISSING
git diff --diff-filter=D --name-only $(git merge-base origin/main <branch>) <branch>
gh api repos/<org>/<repo>/compare/main...<branch> --jq '.behind_by'
```

The tells that were ignored for an hour: guard tests failing where CI is
green; a clean `git status` while `git show main:path | md5sum` differs from
the file on disk. Blob hashes settle it at once — `git rev-parse HEAD:path`
against `git rev-parse main:path`. And rebuild `packages/shared` after landing
on the right base ([branch-switch-stale-artifacts](./branch-switch-stale-artifacts.md)).

## Another agent's stale-tree commit on your branch

An automated collaborator once pushed a commit titled as a one-line dependency
fix whose diff was **54 files, 4,147 deletions**: it had committed a stale
snapshot of the whole tree on top. Nothing in the message hinted at it. Run
this on any commit a bot pushes to a branch you are on:

```
git show --stat <sha> | tail -3
```

**Recover without a force push** — the bot's commit descends from yours:

```
git branch -f safety/my-work <my-last-good-sha>
git reset --hard <my-last-good-sha>   # worktree = my work
git reset --soft <remote-tip-sha>     # HEAD = theirs, tree = mine
# re-apply what their commit actually meant to change, then commit
```

Regenerate the lockfile rather than carrying theirs over. Turn such a bot off
before working on a shared branch.

## Two more effects of a stale base, neither a file conflict

1. **Two PRs can ship the same feature, down to the migration folder name.**
   #438 and #439 both carried `20260727000000_cbt_exam_security_and_grade_unique`
   with different contents. Compare migration folder names against
   `git ls-tree origin/main` before merging, and resolve by choosing one shape
   and deleting the duplicate.
2. **An old branch's lockfile downgrades dependencies on merge** (`next`
   16.3.4 → 16.3.3, an override loosened) without a word. A branch that adds
   no dependency must not touch the lockfile: restore both to `main`'s, then
   `pnpm install --frozen-lockfile` must say "Lockfile is up to date".

## Re-measure before quoting

An old warning that #441 would delete 24 files measured **0** when re-run
against its own merge base a week later. A stale warning believed costs more
than no warning.

## Green alone, red together

#504 and #505 branched from the same commit and were each fully green; merged
together, 3 API tests failed — one deleted a module the other's guard pinned.
Before merging the second of two PRs in the same area, **merge both in a
worktree and run the gate there**.

And the reverse: a **stale local `origin/main`** makes `git diff
origin/main...pr` show other PRs' changes as this one's. Fetch first
(`git fetch origin --prune`), and fetch PR heads into local branches
(`refs/pull/N/head:refs/heads/…`), not under `origin/`, which `--prune` deletes.

## Two documentation PRs collide in the same two places

Measured 2026-11-11: three docs PRs open at once (#1035, #1036 and a new one)
merged cleanly in a worktree except for **one** conflict — both #1035 and the
new PR appended a `0.5` row to `docs/PANDUAN-PENGGUNA-GURU.md`'s Riwayat Revisi
table (same line, so a textual conflict) — while `docs/screens/manifest.json`
auto-merged (JSON arrays of distinct entries). The booklets' revision tables and
`docs/screens/manifest.json` are the two spots every picture/text docs PR
touches. Resolve the table by keeping both rows and renumbering the later one
(the version column is not unique-constrained, so a silent duplicate is the
failure mode when the merge is automatic); re-run `check_docs.py` on the merged
tree, since a row that quotes a menu label must still match the code.
