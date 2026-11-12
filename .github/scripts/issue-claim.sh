#!/bin/sh
# Claim an issue deterministically when a pull request opens for it.
#
# `ready` means "specified enough to be picked up"; once a PR exists the issue is
# being worked on, which is what `in-progress` says. Moving the label is a
# consequence, not a judgement, so it belongs in GitHub Actions (docs/SDLC-FLOW.md
# invariant 2) rather than in an LLM prompt that can forget it or run twice.
#
# The move is deliberately narrow — `in-progress` is only ever reached from
# `ready`:
#   * an issue carrying `ready` becomes `in-progress` (`ready` removed);
#   * an issue already carrying `in-progress` is left alone;
#   * an issue carrying NEITHER is NOT claimed. A `question`/`blocked`/unlabelled
#     issue that a PR links keeps its state, and the PR-template guard keeps
#     failing until a human or the triage owner makes it `ready`. Nothing may
#     jump straight to `in-progress` without first passing through `ready`.
#
# It also covers the reverse order: a PR may exist first and its issue become
# `ready` later (the triage owner clears a question). The `issues: labeled`
# trigger re-runs this, so the fresh `ready` is swapped for `in-progress` at once
# instead of waiting for the PR to be touched again.
#
# Usage: issue-claim.sh <pr-number>
#        issue-claim.sh --issue <issue-number>   # every open PR that closes it
# Env:   GH_TOKEN, REPO (owner/name), READ_ONLY (fork PR: verify only)
set -eu

REPO="${REPO:?REPO is required}"
OWNER="${REPO%%/*}"
NAME="${REPO##*/}"

# Open issues the PR closes, one number per line. The state filter is in the
# query, not the shell: a closed issue needs no claim, and its labels are frozen.
closing_open_issues() { # <pr-number>
  gh api graphql -f query="
    { repository(owner: \"$OWNER\", name: \"$NAME\") {
        pullRequest(number: $1) {
          closingIssuesReferences(first: 100) { nodes { number state } } } } }" \
    --jq '.data.repository.pullRequest.closingIssuesReferences.nodes[]
          | select(.state == "OPEN") | .number'
}

labels_of() { gh api "repos/$REPO/issues/$1/labels" --jq '.[].name' 2>/dev/null || true; }

has() { printf '%s\n' "$1" | grep -qxF "$2"; }

claim_issue() { # claim_issue <issue-number>
  N="$1"
  LABELS=$(labels_of "$N")
  if has "$LABELS" in-progress; then
    echo "issue #$N is already in-progress; nothing to do."
    return 0
  fi
  if ! has "$LABELS" ready; then
    echo "issue #$N is not 'ready' (labels: ${LABELS:-none}); refusing to mark it in-progress."
    return 0
  fi
  # A fork PR's `pull_request` token is read-only, so the edit below cannot run.
  # Do not pass silently: name the move a maintainer has to make.
  if [ "${READ_ONLY:-0}" = "1" ]; then
    echo "::error::issue #$N must move 'ready' -> 'in-progress' but this pull request is from a fork; a maintainer must apply it."
    return 1
  fi
  # One `gh issue edit` with both flags, the same shape `issue-label-sync.sh`
  # uses: adding the new label first and removing the old one in a second call
  # left `ready` and `in-progress` on the issue together if the workflow died
  # between them.
  if ! gh issue edit "$N" --repo "$REPO" --add-label in-progress --remove-label ready >/dev/null; then
    echo "::error::could not claim issue #$N ('ready' -> 'in-progress')."
    return 1
  fi
  echo "claimed issue #$N: 'ready' -> 'in-progress'."
}

if [ "${1:-}" = "--issue" ]; then
  ISSUE="${2:?usage: issue-claim.sh --issue <issue-number>}"
  PRS=$(gh pr list --repo "$REPO" --state open --limit 200 \
    --json number,closingIssuesReferences \
    --jq ".[] | select(any(.closingIssuesReferences[]?; .number == $ISSUE)) | .number" || true)
  if [ -z "$PRS" ]; then
    echo "No open PR closes issue #$ISSUE; not claiming."
    exit 0
  fi
  echo "Issue #$ISSUE is closed by open PR(s): $(printf '%s' "$PRS" | tr '\n' ' ')"
  claim_issue "$ISSUE"
  exit $?
fi

PR="${1:?usage: issue-claim.sh <pr-number> | --issue <issue-number>}"
if ! ISSUES=$(closing_open_issues "$PR" 2>/dev/null); then
  # A failed query must not look like "closes no open issue": the claim would
  # then silently never happen.
  echo "::error::Could not read the open issues PR #$PR closes; not treating that as an empty set."
  exit 1
fi
if [ -z "$ISSUES" ]; then
  echo "PR #$PR closes no open issue; nothing to claim."
  exit 0
fi

RC=0
for N in $ISSUES; do
  claim_issue "$N" || RC=1
done
exit "$RC"
