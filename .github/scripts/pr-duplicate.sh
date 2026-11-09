#!/bin/sh
# Flag an open pull request as a *candidate* duplicate when another open pull
# request closes the same issue. Deterministic replacement for the semantic half
# of the retired `SDLC 17 · Pelabel PR` automation (2026-11-09).
#
# Why: `issue-label-sync.yml` already copies the linked issue's type and
# priority onto the PR and is a required check, so the mechanical half of
# SDLC 17 was always redundant. What was not covered is *noticing* that two PRs
# work on the same thing. The signal is exact and needs no judgement: two open
# PRs that close the *same* issue are working on the same thing, and GitHub
# already tells us which issues a PR closes (`closingIssuesReferences`, the same
# field `issue-label-sync.sh` reads).
#
# This script only *labels*, and the label is a candidate for a maintainer, not a
# verdict. Which of two PRs is the more correct one is a judgement (docs/LABELS.md,
# rule 4): a PR can close several issues, and a newer PR is often the better one.
# So nothing here closes a PR — the label says "a maintainer should weigh these
# two", never "close the newer one". A label left behind after the pairing
# resolves is harmless (it only asks a person to look) and a maintainer removes
# it; removing it automatically would risk deleting a label a person set for
# another reason.
#
# A draft PR is skipped: a draft is not yet claiming the issue.
#
# Usage: pr-duplicate.sh
# Env:   GH_TOKEN, REPO, PR_DUPLICATE_DRY_RUN (print, write nothing)
set -eu

REPO="${REPO:?REPO is required}"
DRY="${PR_DUPLICATE_DRY_RUN:-}"
LABEL="duplicate-pr"

say() { echo "  [dry-run] $*"; }

# Every open, non-draft PR and the issues it closes. `gh` resolves
# `closingIssuesReferences` for us (issue-label-sync.sh reads the same field), so
# there is no per-PR query. Rows are `pr<TAB>issue`; a PR that closes nothing
# contributes no row.
PAIRS=$(gh pr list --repo "$REPO" --state open --limit 500 \
  --json number,isDraft,closingIssuesReferences \
  --jq '.[] | select(.isDraft | not) | .number as $n | .closingIssuesReferences[]? | "\($n)\t\(.number)"' \
  2>/dev/null || true)

# A PR that shares a closed issue with another open PR is a candidate: an issue
# closed by two or more open PRs means the same work is being done twice. The
# newest of the group is the one labelled — the older one is the one a maintainer
# is already reviewing.
CANDIDATES=$(printf '%s\n' "$PAIRS" | awk -F '\t' 'NF==2 && $1 != "" { if ($1+0 > max[$2]) max[$2] = $1+0; count[$2]++ } END { for (i in max) if (count[i] > 1) print max[i] }' | sort -nu)

# What already carries the label, so a re-run does not rewrite it.
LABELLED=$(gh pr list --repo "$REPO" --state open --label "$LABEL" --limit 500 \
  --json number --jq '.[].number' 2>/dev/null || true)

for pr in $CANDIDATES; do
  case " $(printf '%s\n' "$LABELLED" | tr '\n' ' ') " in
    *" $pr "*) echo "PR #$pr already carries $LABEL; leaving it."; continue ;;
  esac
  if [ -n "$DRY" ]; then
    say "would add $LABEL to #$pr"
  else
    gh pr edit "$pr" --repo "$REPO" --add-label "$LABEL" >/dev/null
  fi
  echo "PR #$pr labelled $LABEL as a duplicate candidate (closes an issue another open PR also closes)."
done

echo "Done. $LABEL is a maintainer-facing candidate; nothing is closed automatically."

