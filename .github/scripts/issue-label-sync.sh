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
#   * the PR's priority ceiling is the HIGHEST priority among the issues it
#     closes; a PR at or below that ceiling is left as it is (the sync never
#     lowers a priority), and a PR above it fails — the review gate
#     (`Gerbang tinjau PR`) corrects the PR label or raises the issue's
#   * a genuine disagreement fails the check for a human or the review
#     automation to resolve: a different type on the PR or among the issues it
#     closes (type is a single fact, not a spectrum), a PR with two priority
#     labels, or an issue with two types or two priorities
#
# Usage: issue-label-sync.sh <pr-number>
#        issue-label-sync.sh --issue <issue-number>   # re-sync every open PR
#                                                       # that closes the issue
# Env:   GH_TOKEN, REPO (owner/name)
set -eu

REPO="${REPO:?REPO is required}"
TYPE_LABELS="bug enhancement documentation refactor chore security"

# The priority order, as a number, so "highest wins" is a comparison and not a
# string match. 0 for anything that is not a priority label.
prio_rank() { # prio_rank <priority-label> -> 0..4
  case "$1" in
    priority:critical) printf '4' ;;
    priority:high) printf '3' ;;
    priority:medium) printf '2' ;;
    priority:low) printf '1' ;;
    *) printf '0' ;;
  esac
}

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
    # Type stays strict: it is a single fact, not a spectrum, so two types among
    # the issues is a genuine disagreement (#1069 decides the message shape).
    if [ -n "$I_TYPES" ]; then
      if [ -n "$REQ_TYPES" ] && [ "$I_TYPES" != "$REQ_TYPES" ]; then
        echo "::error::PR #$PR closes issues that disagree on type ($REQ_TYPES vs $I_TYPES); fix the labels before merging."
        FAIL=1
      fi
      REQ_TYPES="$I_TYPES"
    fi
    # Priority is a spectrum, so the PR's ceiling is the HIGHEST priority among
    # the issues it closes — the PR works on the most urgent thing it closes.
    # Cross-priority issues are legitimate (a `high` security leak beside a
    # `medium` form fix in one PR), so they are no longer a failure (#1054,
    # owner decision P4): the ceiling is resolved, not rejected. The PR may sit
    # at or below the ceiling; above it is a real error the review gate corrects.
    if [ -n "$I_PRIO" ]; then
      if [ -z "$REQ_PRIOS" ] || [ "$(prio_rank "$I_PRIO")" -gt "$(prio_rank "$REQ_PRIOS")" ]; then
        REQ_PRIOS="$I_PRIO"
      fi
    fi
  done

  PR_TYPES=$(printf '%s\n' "$PR_LABELS" | grep -xF "$(printf '%s\n' $TYPE_LABELS)" || true)
  PR_PRIO=$(printf '%s\n' "$PR_LABELS" | grep -x 'priority:.*' || true)

  if [ -n "$REQ_TYPES" ] && [ -n "$PR_TYPES" ] && [ "$PR_TYPES" != "$REQ_TYPES" ]; then
    echo "::error::PR #$PR is labelled '$PR_TYPES' but issue(s) #$(printf '%s\n' $ISSUES | tr '\n' ' ') are '$REQ_TYPES'. Fix the type on whichever is wrong."
    FAIL=1
  fi

  # A PR priority ABOVE the ceiling is the failure the review gate (`Gerbang
  # tinjau PR`, SDLC 18) resolves — it judges which side is wrong (drop the PR,
  # or raise the issue with evidence). A PR at or below the ceiling is left
  # exactly as it is: lowering is not the sync's job, and a PR may legitimately
  # be less urgent than the issues it closes.
  if [ -n "$REQ_PRIOS" ] && [ -n "$PR_PRIO" ] \
     && [ "$(prio_rank "$PR_PRIO")" -gt "$(prio_rank "$REQ_PRIOS")" ]; then
    echo "::error::PR #$PR carries '$PR_PRIO', above the priority ceiling '$REQ_PRIOS' of the issue(s) it closes (#$(printf '%s\n' $ISSUES | tr '\n' ' ')). The review gate corrects the PR label or raises the issue's."
    FAIL=1
  fi

  has() { printf '%s\n' "$1" | grep -qxF "$2"; }
  # A PR must end with exactly one priority label. Two is ambiguous — the sync
  # cannot tell which to keep — so it is a genuine disagreement, like two types.
  if [ "$(printf '%s\n' "$PR_PRIO" | grep -c . || true)" -gt 1 ]; then
    echo "::error::PR #$PR carries more than one priority label ($(printf '%s' "$PR_PRIO" | tr '\n' ' ')); keep exactly one."
    FAIL=1
  fi
  # A disagreement is not something to edit labels through: changing the PR's
  # labels while the check fails would make the PR adopt the last issue read and
  # hide the conflict a human has to resolve. On FAIL, leave the labels alone.
  if [ "$FAIL" -eq 0 ]; then
    # Add every shared type label the PR is missing. The priority is added only
    # when the PR carries none — the sync sets it to the ceiling, but never
    # raises a PR that already sits at or below the ceiling (#1054, owner
    # decision P4: only the review gate corrects a PR above it, and the sync
    # never lowers a priority).
    ADD=""
    for l in $REQ_TYPES; do
      has "$PR_LABELS" "$l" || ADD="$ADD,$l"
    done
    if [ -n "$REQ_PRIOS" ] && [ -z "$PR_PRIO" ]; then
      ADD="$ADD,$REQ_PRIOS"
    fi
    # A fork PR's `pull_request` token is read-only: the edit below cannot run.
    # The check must not pass with the labels still wrong — a passing "Issue label
    # sync" on a mislabeled PR is what a merge gate reads. Fail it and name the
    # labels a maintainer has to apply; the fork contributor cannot do it.
    if [ "${READ_ONLY:-0}" = "1" ]; then
      if [ -n "$ADD" ]; then
        echo "::error::PR #$PR is from a fork; a maintainer must apply: ${ADD#,}"
        FAIL=1
      fi
    elif [ -n "$ADD" ]; then
      gh pr edit "$PR" --repo "$REPO" --add-label "${ADD#,}"
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
publish_check() { # publish_check <name> <head-sha> <conclusion> <title> <summary>
  _name="$1"; _sha="$2"; _concl="$3"; _title="$4"; _summary="$5"
  [ -n "$_sha" ] || return 0
  # This POST is the only thing that lands the issue-event outcome on the PR
  # head. If it fails (rate limit, missing permission) the PR keeps its previous
  # check — a stale green reads as "still in sync" to the merge gate. Report the
  # API error and fail, so the workflow cannot be mistaken for a clean run.
  if ! _err=$(gh api "repos/$REPO/check-runs" -X POST \
      -f name="$_name" \
      -f head_sha="$_sha" \
      -f status="completed" \
      -f conclusion="$_concl" \
      -f "output[title]=$_title" \
      -f "output[summary]=$_summary" 2>&1 >/dev/null); then
    echo "::error::could not publish the \`$_name\` check for $_sha; the PR keeps its previous result: $_err"
    return 1
  fi
  return 0
}

publish_pr_check() { # publish_pr_check <head-sha> <conclusion> <title> <summary>
  publish_check "Issue label sync" "$@"
}

# The `PR template reminder` gate (`pr-template-guard.sh`) reads the linked
# issue's labels *at run time*: an issue that has lost `ready` (label-guard
# strips a label a non-bot applied) fails the check. That gate is a required
# status check and the `pr-description-checks` workflow fires only on *pull
# request* events, so an issue relabel never re-runs it — a PR that was opened
# in the window between the strip and the re-label keeps a permanent red check
# (#866, seen on #863). When a linked issue changes, re-run the gate against
# each affected PR's head and publish its result there, so the check reflects
# the issue's current labels instead of a snapshot. A missing script is not a
# reason to wedge the PR: skip it (the pull-request event still runs it).
publish_template_check() { # publish_template_check <pr-number> <head-sha> <base-ref>
  _pr="$1"; _sha="$2"; _base="${3:-}"
  [ -n "$_sha" ] || return 0
  # Resolve the guard next to this script, so the call works whatever the
  # working directory is (the workflow checks out `.github/scripts` only).
  _dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
  _guard="$_dir/pr-template-guard.sh"
  if [ ! -f "$_guard" ]; then
    echo "::warning::$_guard is not present; the \`PR template reminder\` check is left as it is."
    return 0
  fi
  # BASE_REF matters: the guard warns when the PR does not target the default
  # branch (its `Fixes #n` would close nothing). Passing it keeps the
  # re-evaluated result faithful to the pull-request run.
  if REPO="$REPO" GH_TOKEN="$GH_TOKEN" \
      BASE_REF="$_base" DEFAULT_BRANCH="${DEFAULT_BRANCH:-}" \
      sh "$_guard" "$_pr" >/dev/null 2>&1; then
    publish_check "PR template reminder" "$_sha" success \
      "Deskripsi PR lengkap" \
      "Issue tertaut #$ISSUE berubah label; deskripsi PR #$_pr masih lengkap dan issue-nya siap." || return 1
  else
    publish_check "PR template reminder" "$_sha" failure \
      "Deskripsi PR belum lengkap" \
      "Issue tertaut #$ISSUE berubah label dan deskripsi PR #$_pr tidak lagi lengkap. Perbaiki deskripsi PR." || return 1
  fi
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
    # The `PR template reminder` gate reads the issue's labels at run time; a
    # relabel here invalidated its last result, so re-evaluate it on the PR head.
    # Dependabot is skipped by the workflow itself (`pr-description-checks.yml`
    # keys the skip on the PR author, since Dependabot writes its own body and
    # cannot link an issue); a job skipped by `if` reports success. Re-evaluating
    # it here would publish a red the workflow deliberately never runs.
    AUTHOR=$(gh pr view "$p" --repo "$REPO" --json author --jq .author.login 2>/dev/null || true)
    if [ "$AUTHOR" = "dependabot[bot]" ]; then
      echo "PR #$p is Dependabot; leaving the \`PR template reminder\` check as it is."
      continue
    fi
    # The guard applies its "targets a non-default branch" rule only when
    # BASE_REF is present. A failed read leaves it empty, the rule is skipped,
    # and a PR that targets a non-default branch would be republished green —
    # a result it never earned. Fail and keep the previous check instead of
    # minting one. (DEFAULT_BRANCH comes from the workflow, which always sets
    # it on this path.)
    BASE=$(gh pr view "$p" --repo "$REPO" --json baseRefName --jq .baseRefName 2>/dev/null || true)
    if [ -z "$BASE" ]; then
      echo "::error::could not read the base branch of PR #$p; the \`PR template reminder\` check is left as it is."
      RC=1
      continue
    fi
    publish_template_check "$p" "$SHA" "$BASE" || RC=1
  done
  exit "$RC"
fi

PR="${1:?usage: issue-label-sync.sh <pr-number> | --issue <issue-number>}"
sync_pr "$PR"
