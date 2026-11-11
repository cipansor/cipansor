#!/bin/sh
# Sync a pull request's labels with every issue it closes, and fail when they
# cannot be reconciled.
#
# The PR and each issue it closes must carry the same "shared" labels: the type
# labels (bug, enhancement, documentation, refactor, chore, security) and the
# priority label. Labels that describe an issue's own lifecycle (question,
# question, duplicate, invalid, wontfix, blocked, ready, in-progress, ...) are
# not copied.
#
#   * missing shared labels are added to the PR
#   * a priority on the PR that contradicts the issues is corrected
#   * a genuine disagreement (a different type on the PR, two issues it closes
#     that disagree, an ambiguous issue with two priorities) fails the check for
#     a human or the review automation to resolve
#
# Usage: issue-label-sync.sh <pr-number>
#        issue-label-sync.sh --issue <issue-number>   # re-sync every open PR
#                                                       # that closes the issue
# Env:   GH_TOKEN, REPO (owner/name)
set -eu

REPO="${REPO:?REPO is required}"
TYPE_LABELS="bug enhancement documentation refactor chore security"

labels_of() { # labels_of <pr|issue> <number> -> newline-separated label names
  gh "$1" view "$2" --repo "$REPO" --json labels --jq '.labels[].name'
}

# Every issue the PR closes, not only the first: a PR that closes two issues
# must satisfy both, or the second escapes the check.
closing_issues() { # closing_issues <pr-number>
  gh api graphql -f query="
    { repository(owner: \"${REPO%%/*}\", name: \"${REPO##*/}\") {
        pullRequest(number: $1) {
          closingIssuesReferences(first: 100) { nodes { number } } } } }" \
    --jq '.data.repository.pullRequest.closingIssuesReferences.nodes[].number'
}

sync_pr() { # sync_pr <pr-number>
  PR="$1"
  # A failed GraphQL query must not look like "closes no issue" — an unavailable
  # API would then pass the check. Only an empty result from a successful query
  # means there is nothing to compare.
  if ! ISSUES=$(closing_issues "$PR" 2>/dev/null); then
    echo "::error::Could not read the issues PR #$PR closes; not treating that as an empty set."
    return 1
  fi
  if [ -z "$ISSUES" ]; then
    echo "PR #$PR closes no issue; nothing to sync."
    return 0
  fi

  PR_LABELS=$(labels_of pr "$PR")

  # Collect the shared labels every linked issue agrees on. A conflict --- two
  # types or two priorities among the issues, or a PR type matching none of
  # them --- is a real disagreement, not something to guess at.
  REQ_TYPES=""
  REQ_PRIOS=""
  FAIL=0
  for ISSUE in $ISSUES; do
    ISSUE_LABELS=$(labels_of issue "$ISSUE")
    I_TYPES=$(printf '%s\n' "$ISSUE_LABELS" | grep -xF "$(printf '%s\n' $TYPE_LABELS)" || true)
    I_PRIO=$(printf '%s\n' "$ISSUE_LABELS" | grep -x 'priority:.*' || true)

    if [ "$(printf '%s\n' "$I_TYPES" | grep -c . || true)" -gt 1 ] \
       || [ "$(printf '%s\n' "$I_PRIO" | grep -c . || true)" -gt 1 ]; then
      echo "::error::Issue #$ISSUE has more than one type or priority label; the sync cannot tell which to copy."
      FAIL=1
    fi

    # A conflict between issues this PR closes, or between the PR and an issue.
    if [ -n "$I_TYPES" ]; then
      if [ -n "$REQ_TYPES" ] && [ "$I_TYPES" != "$REQ_TYPES" ]; then
        echo "::error::PR #$PR closes issues that disagree on type ($REQ_TYPES vs $I_TYPES); fix the labels before merging."
        FAIL=1
      fi
      REQ_TYPES="$I_TYPES"
    fi
    if [ -n "$I_PRIO" ]; then
      if [ -n "$REQ_PRIOS" ] && [ "$I_PRIO" != "$REQ_PRIOS" ]; then
        echo "::error::PR #$PR closes issues that disagree on priority ($REQ_PRIOS vs $I_PRIO); fix the labels before merging."
        FAIL=1
      fi
      REQ_PRIOS="$I_PRIO"
    fi
  done

  PR_TYPES=$(printf '%s\n' "$PR_LABELS" | grep -xF "$(printf '%s\n' $TYPE_LABELS)" || true)
  PR_PRIO=$(printf '%s\n' "$PR_LABELS" | grep -x 'priority:.*' || true)

  if [ -n "$REQ_TYPES" ] && [ -n "$PR_TYPES" ] && [ "$PR_TYPES" != "$REQ_TYPES" ]; then
    echo "::error::PR #$PR is labelled '$PR_TYPES' but issue(s) #$(printf '%s\n' $ISSUES | tr '\n' ' ') are '$REQ_TYPES'. Fix the type on whichever is wrong."
    FAIL=1
  fi

  has() { printf '%s\n' "$1" | grep -qxF "$2"; }
  # A disagreement is not something to edit labels through: changing the PR's
  # labels while the check fails would make the PR adopt the last issue read and
  # hide the conflict a human has to resolve. On FAIL, leave the labels alone.
  if [ "$FAIL" -eq 0 ]; then
    # Compute additions and removals before touching the PR, so the priority
    # correction is one edit. Adding the new priority first and removing the old
    # one in a second call left both labels on the PR if the workflow died
    # between them — two priorities on one PR. A single `gh pr edit` with
    # --add-label and --remove-label is atomic as far as the PR is concerned.
    ADD=""
    for l in $REQ_TYPES $REQ_PRIOS; do
      has "$PR_LABELS" "$l" || ADD="$ADD,$l"
    done
    DEL=""
    if [ -n "$REQ_PRIOS" ] && [ -n "$PR_PRIO" ] && [ "$PR_PRIO" != "$REQ_PRIOS" ]; then
      DEL="$PR_PRIO"
      echo "Correcting PR priority '$PR_PRIO' -> '$REQ_PRIOS'."
    fi
    # A fork PR's `pull_request` token is read-only: the edit below cannot run.
    # The check must not pass with the labels still wrong — a passing "Issue label
    # sync" on a mislabeled PR is what a merge gate reads. Fail it and name the
    # labels a maintainer has to apply; the fork contributor cannot do it.
    if [ "${READ_ONLY:-0}" = "1" ]; then
      if [ -n "$ADD$DEL" ]; then
        echo "::error::PR #$PR is from a fork; a maintainer must apply: ${ADD#,}${DEL:+ (remove $DEL)}"
        FAIL=1
      fi
    elif [ -n "$ADD" ] || [ -n "$DEL" ]; then
      SET=""
      [ -n "$ADD" ] && SET="$SET --add-label ${ADD#,}"
      [ -n "$DEL" ] && SET="$SET --remove-label $DEL"
      # shellcheck disable=SC2086
      gh pr edit "$PR" --repo "$REPO" $SET
    fi
  fi

  if [ "$FAIL" -ne 0 ]; then
    echo "Label sync failed for PR #$PR. See the errors above."
    return 1
  fi
  echo "PR #$PR labels are in sync with issue(s) #$(printf '%s\n' $ISSUES | tr '\n' ' ') (${REQ_TYPES:-no type} ${REQ_PRIOS:-no priority})."
}

# Triggered from an `issues` event: relabelling a linked issue does not fire a
# pull_request event, so find every open PR that closes it and re-sync. Running
# this job from the `issues` event attaches its own check to the *default branch*
# commit, not to the PR head, so a passing "Issue label sync" check on a PR would
# survive an issue relabel that invalidated it. To close that gap, publish an
# explicit check run against each affected PR's head SHA with `checks: write`:
# that run lands on the PR's commit and replaces the stale green one. The job
# still exits non-zero so a human sees the failure in the workflow, but the
# merge gate reads the per-PR check run.
publish_pr_check() { # publish_pr_check <head-sha> <conclusion> <title> <summary>
  _sha="$1"; _concl="$2"; _title="$3"; _summary="$4"
  [ -n "$_sha" ] || return 0
  # This POST is the only thing that lands the issue-event outcome on the PR
  # head. If it fails (rate limit, missing permission) the PR keeps its previous
  # check — a stale green reads as "still in sync" to the merge gate. Report the
  # API error and fail, so the workflow cannot be mistaken for a clean run.
  if ! _err=$(gh api "repos/$REPO/check-runs" -X POST \
      -f name="Issue label sync" \
      -f head_sha="$_sha" \
      -f status="completed" \
      -f conclusion="$_concl" \
      -f "output[title]=$_title" \
      -f "output[summary]=$_summary" 2>&1 >/dev/null); then
    echo "::error::could not publish a check run for $_sha; the PR keeps its previous result: $_err"
    return 1
  fi
  return 0
}

if [ "${1:-}" = "--issue" ]; then
  ISSUE="${2:?usage: issue-label-sync.sh --issue <issue-number>}"
  PRS=$(gh pr list --repo "$REPO" --state open --limit 200 \
    --json number,closingIssuesReferences \
    --jq ".[] | select(any(.closingIssuesReferences[]?; .number == $ISSUE)) | .number" || true)
  [ -n "$PRS" ] || { echo "No open PR closes issue #$ISSUE."; exit 0; }
  RC=0
  for p in $PRS; do
    SHA=$(gh pr view "$p" --repo "$REPO" --json headRefOid --jq .headRefOid 2>/dev/null || true)
    if sync_pr "$p"; then
      publish_pr_check "$SHA" success "Labels are in sync" \
        "The labels on PR #$p still agree with issue #$ISSUE." || RC=1
    else
      RC=1
      publish_pr_check "$SHA" failure "Labels are out of sync" \
        "Issue #$ISSUE changed and PR #$p no longer agrees with it. See the workflow log and fix the labels before merging." || RC=1
    fi
  done
  exit "$RC"
fi

PR="${1:?usage: issue-label-sync.sh <pr-number> | --issue <issue-number>}"
sync_pr "$PR"
