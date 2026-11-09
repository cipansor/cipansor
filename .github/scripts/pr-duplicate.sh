#!/bin/sh
# Label an open pull request `duplicate-pr` when another open pull request
# already closes the same issue. Deterministic replacement for the semantic half
# of the retired `SDLC 17 · Pelabel PR` automation (2026-11-09).
#
# Why: `issue-label-sync.yml` already copies the linked issue's type and
# priority onto the PR and is a required check, so the mechanical half of
# SDLC 17 was always redundant. What was not covered is deciding that a PR
# duplicates another. The signal is exact and needs no judgement: two open PRs
# that close the *same* issue are working on the same thing, and GitHub already
# tells us which issues a PR closes (`closingIssuesReferences`, the same field
# `issue-label-sync.sh` reads). The newest PR of the group is the one labelled —
# the older one is the one a maintainer is already reviewing.
#
# This script only *labels*. `duplicate-sweep.sh` then warns the author and
# closes the PR after the grace period, exactly as it does for any other
# `duplicate-pr`, so the two agree on the lifecycle and no second closer exists.
#
# A draft PR is skipped: a draft is not yet claiming the issue.
#
# Usage: pr-duplicate.sh
# Env:   GH_TOKEN, REPO, PR_DUPLICATE_DRY_RUN (print, write nothing)
set -eu

REPO="${REPO:?REPO is required}"
DRY="${PR_DUPLICATE_DRY_RUN:-}"
LABEL="duplicate-pr"

# One listing: every open, non-draft PR and the issues it closes. `gh` resolves
# `closingIssuesReferences` for us (issue-label-sync.sh reads the same field), so
# there is no per-PR query. Rows are `pr<TAB>issue`; a PR that closes nothing
# contributes no row.
PAIRS=$(gh pr list --repo "$REPO" --state open --limit 500 \
  --json number,isDraft,closingIssuesReferences \
  --jq '.[] | select(.isDraft | not) | .number as $n | .closingIssuesReferences[]? | "\($n)\t\(.number)"' \
  2>/dev/null || true)

# An issue closed by two or more open PRs: the newest PR is the duplicate.
DUPLICATES=$(printf '%s\n' "$PAIRS" | awk -F '\t' 'NF==2 && $1 != "" { if ($1+0 > max[$2]) max[$2] = $1+0; count[$2]++ } END { for (i in max) if (count[i] > 1) print max[i] }' | sort -n)

if [ -z "$DUPLICATES" ]; then
  echo "Tidak ada PR terbuka yang menutup issue yang sama; tidak ada yang dilabeli."
  exit 0
fi

for pr in $DUPLICATES; do
  CURRENT=$(gh pr view "$pr" --repo "$REPO" --json labels --jq '[.labels[].name] | join(",")' 2>/dev/null || true)
  case ",$CURRENT," in
    *",$LABEL,"*) echo "PR #$pr sudah berlabel $LABEL; dilewati."; continue ;;
  esac
  if [ -n "$DRY" ]; then
    echo "[dry-run] akan memasang $LABEL pada PR #$pr"
  else
    gh pr edit "$pr" --repo "$REPO" --add-label "$LABEL"
    echo "PR #$pr dilabeli $LABEL (menutup issue yang sama dengan PR terbuka lain)."
  fi
done
