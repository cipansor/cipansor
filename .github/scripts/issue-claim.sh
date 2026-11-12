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
# `--sweep` is the repair pass for the events that never arrived. The claim
# depends on GitHub delivering `pull_request`/`issues` events; when a run is
# missing (the event was dropped, the workflow was added after the PR opened, a
# run was cancelled) nothing retries it and the issue keeps `ready` while a PR
# works it. A `ready` issue with an open PR is a state the fleet must never be
# in, so the sweep re-derives the claim from state alone — it asks every open PR
# what it closes and claims what it finds. It is idempotent: a claimed issue is
# left alone, and a fork PR reports the move instead of making it.
#
# Usage: issue-claim.sh <pr-number>
#        issue-claim.sh --issue <issue-number>   # every open PR that closes it
#        issue-claim.sh --sweep                  # every open PR, from state
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
    # Idempotent for the claim itself, but `ready` must not stay beside it: the
    # implementation queue reads `ready`, so an issue that already has a PR
    # would be handed out again. `label-guard` only strips `ready` when it
    # contradicts `question`/`blocked`, so the pair can survive a re-run here.
    if has "$LABELS" ready; then
      if [ "${READ_ONLY:-0}" = "1" ]; then
        echo "::error::issue #$N carries both 'ready' and 'in-progress'; a maintainer must remove 'ready' (fork pull request)."
        return 1
      fi
      if ! gh issue edit "$N" --repo "$REPO" --remove-label ready >/dev/null; then
        echo "::error::could not remove the stale 'ready' from issue #$N."
        return 1
      fi
      echo "issue #$N is in-progress; removed the stale 'ready' so the queue does not pick it up again."
    else
      echo "issue #$N is already in-progress; nothing to do."
    fi
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

if [ "${1:-}" = "--sweep" ]; then
  # Every open PR, and the open issues it closes. One query for the whole repo:
  # the per-PR GraphQL call the single-PR path uses would be one request per PR,
  # and the sweep is the pass that must not be expensive enough to skip.
  #
  # A fork PR's `pull_request` token is read-only, so a claim it needs cannot be
  # made here; the sweep names the move instead of passing silently.
  ROWS=$(gh pr list --repo "$REPO" --state open --limit 500 \
    --json number,isCrossRepository,closingIssuesReferences \
    --jq '.[] | "\(.number)|\(.isCrossRepository)|\([.closingIssuesReferences[].number] | join(","))"' || true)
  if [ -z "$ROWS" ]; then
    echo "No open pull requests; nothing to claim."
    exit 0
  fi
  # A pipeline runs the loop in a subshell, so a failure recorded in a variable
  # would be lost. A temp file survives it, and the sweep must not report success
  # while a claim it found went unmade.
  FAILS=$(mktemp)
  printf '%s\n' "$ROWS" | while IFS='|' read -r PR IS_FORK ISSUES; do
    [ -n "$PR" ] || continue
    [ -n "$ISSUES" ] || continue
    # One fork PR must not stop the claims the other PRs still need: report it
    # and carry on.
    if [ "$IS_FORK" = "true" ]; then
      echo "PR #$PR comes from a fork; its issue claim needs a maintainer."
      continue
    fi
    for N in $(printf '%s' "$ISSUES" | tr ',' ' '); do
      claim_issue "$N" || echo "claim failed for issue #$N (PR #$PR)" >> "$FAILS"
    done
  done
  if [ -s "$FAILS" ]; then
    cat "$FAILS"
    rm -f "$FAILS"
    exit 1
  fi
  rm -f "$FAILS"
  exit 0
fi

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
