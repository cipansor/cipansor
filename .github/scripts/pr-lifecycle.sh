#!/bin/sh
# Post the CI result and dispatch the review gate once a PR is fully green.
#
#   green checks on a draft PR    -> post the all-green comment (informational)
#   green checks on a ready PR    -> dispatch the review gate (`Gerbang tinjau PR`)
#   red checks                      -> do nothing
#   changes requested on the head   -> do nothing (waiting for fixes)
#   changes requested on an older commit, green head -> dispatch the gate again
#
# This script never approves, never merges and never changes the draft/ready
# state. A maintainer decides when a PR is ready; the review gate (`Gerbang tinjau PR`)
# decides the verdict. A red or changes-requested PR is deliberately left open:
# the gate posts the request-changes review itself, and branch protection blocks
# the merge until it is resolved. Reverting a PR to draft was tried and dropped —
# it does not help a human and hides work that is still being iterated on.
#
# Usage: pr-lifecycle.sh <pr-number> <head-sha>
# Env:   GH_TOKEN, REPO (owner/name), OPENHANDS_API_KEY (dispatch bridge)
set -eu

PR="${1:?usage: pr-lifecycle.sh <pr-number> <head-sha>}"
SHA="${2:?head sha is required}"
REPO="${REPO:?REPO is required}"

LIFE_MARK="<!-- pr-lifecycle:"
GREEN_MARK="<!-- pr-lifecycle:green -->"

# Every lifecycle comment carries the AI-disclosure footer. A comment-triggered
# automation cannot otherwise tell an automated comment from a reporter's, and
# would treat "CI is red ..." as a fresh human request and re-arm (#680). The
# footer is also what the duplicate-sweep reply scan looks for.
AI_FOOTER="_This comment was created by an AI agent (OpenHands) on behalf of the maintainer._"

# The checks that make up the required gate. A green result only counts as
# "everything passed" when every one of these is present and successful on the
# tested commit - a subset (E2E has not started, or the API truncated a page)
# must never be mistaken for the full gate.
#
# A job skipped by its own `if:` (a docs-only PR reports `scope.run=false`, so
# Lint/Build/Tests/Security/E2E are skipped) is neither red nor pending here: a
# `skipped` conclusion is excluded from RED (which lists only real failures) and
# from PENDING (which lists conclusions this gate does not call green). A docs
# PR is therefore green once every check is *present* and none failed, which is
# what lets it reach the gate. Presence is still required, so a green subset (an
# early CI finish before E2E has published its checks) stays pending.
REQUIRED_CHECKS="${REQUIRED_CHECKS:-CI scope|Lint|Build|Tests|Security|E2E scope|E2E Tests (Chromium)}"

# Suites that publish a check run on every PR whose workflow ran. A signature
# with no check run on the tested commit means that workflow has not started (or
# its run is not yet associated with this commit), so a green subset must not be
# mistaken for the full gate even when every check seen so far passed. Only
# checked-in workflows publish checks: `CI scope` (ci.yml) and `E2E scope`
# (e2e-tests.yml). Analyze / CodeQL are code scanning, not workflow checks, so
# requiring them here would block the all-green notice forever.
KNOWN_SUITE_SIGNS="${KNOWN_SUITE_SIGNS:-CI scope|E2E scope}"

pr_field() { gh pr view "$PR" --repo "$REPO" --json "$1" --jq ".$1"; }

STATE=$(pr_field state)
[ "$STATE" = "OPEN" ] || { echo "PR #$PR is $STATE; nothing to do."; exit 0; }
DRAFT=$(pr_field isDraft)
REVIEW=$(pr_field reviewDecision)

# Checks are evaluated against the commit the workflows actually ran on. In this
# repository the CI and E2E workflows publish their check runs against the PR's
# source head SHA (which is also `workflow_run.head_sha`); the synthetic
# `pull_request` merge commit carries no check runs at all. Query the head SHA,
# and fall back to the reported merge commit only if the head yields nothing, so
# the script adapts if that ever changes.
merge_sha() { pr_field potentialMergeCommit; }

# A stale workflow_run can fire for an older commit; only act when this run is
# for the PR's current head (a merge-commit run names the source head_sha too).
HEAD=$(pr_field headRefOid)
if [ "$HEAD" != "$SHA" ]; then
  echo "Run is for $SHA but the PR head is $HEAD; skipping a stale run."
  exit 0
fi

# Fetch the check runs for the tested commit once (the head SHA in this
# repository, falling back to the reported merge commit only if the head has
# none), then keep the *latest* run of every check name. Grouping by name rather
# than position is what lets a re-run supersede an earlier cancelled or failed
# result: a positional `.[-1]` kept the last run of the *list*, so a replaced
# failure was still reported.
CHECKS_JSON=""
for cand in "$SHA" "$(merge_sha)"; do
  [ -n "$cand" ] && [ "$cand" != "null" ] || continue
  # --paginate prints one JSON document per page; jq -s slurps them into one
  # array of responses and .[].check_runs combines every page, so a head with
  # more than 100 check runs (reruns) is not silently discarded when a single
  # count cannot be compared.
  CHECKS_JSON=$(gh api --paginate "repos/$REPO/commits/$cand/check-runs?per_page=100" 2>/dev/null | jq -s '[.[].check_runs[]]' 2>/dev/null || true)
  if [ "$(printf '%s' "$CHECKS_JSON" | jq 'length' 2>/dev/null || echo 0)" -gt 0 ]; then
    CHECK_SHA="$cand"
    break
  fi
  CHECKS_JSON=""
done
CHECK_SHA="${CHECK_SHA:-$SHA}"

# name<TAB>status<TAB>conclusion for the latest run of each check name.
LATEST=$(printf '%s' "$CHECKS_JSON" | jq -r '
  (if type == "array" then . else [] end) | sort_by(.started_at, .id) | group_by(.name) | map(.[-1])[]
  | "\(.name)\t\(.status)\t\(.conclusion // "")"' 2>/dev/null || true)
# RED is restricted to the gate checks. The check-run API returns every run on
# the commit, including advisory workflows (the PR-description reminder) and
# third-party checks. Drafting a PR because an advisory reminder failed would
# contradict the gate definition above, so only a failed check whose name is one
# of REQUIRED_CHECKS counts. Matching is exact on the names in REQUIRED_CHECKS.
RED=$(printf '%s\n' "$LATEST" \
  | awk -F'\t' -v req="$REQUIRED_CHECKS" '
      BEGIN { n = split(req, a, "|"); for (i = 1; i <= n; i++) want[a[i]] = 1 }
      NF && $2 == "completed" && $3 ~ /^(failure|timed_out|action_required|startup_failure|stale)$/ && ($1 in want) { print }' || true)
printf '%s\n' "$LATEST" \
  | awk -F'\t' -v req="$REQUIRED_CHECKS" '
      BEGIN { n = split(req, a, "|"); for (i = 1; i <= n; i++) want[a[i]] = 1 }
      NF && $2 == "completed" && $3 ~ /^(failure|timed_out|action_required|startup_failure|stale)$/ && !($1 in want) { print "Ignoring non-gate check \x27" $1 "\x27 when deciding to draft the PR." }' || true
# PENDING: a required check's latest run still running, or finished with a
# conclusion this gate does not call green (a cancelled run whose replacement
# has not appeared yet). Only the required checks count, as for RED: this
# workflow's own `lifecycle` check is always in progress while it runs, and
# advisory checks (template reminder, visual reminder, CodeQL) finish on their
# own time — counting them held every dispatch until the next run.
PENDING=$(printf '%s\n' "$LATEST" \
  | awk -F'\t' -v req="$REQUIRED_CHECKS" '
      BEGIN { n = split(req, a, "|"); for (i = 1; i <= n; i++) want[a[i]] = 1 }
      NF && ($1 in want) && ($2 != "completed" || $3 !~ /^(success|failure|timed_out|action_required|startup_failure|stale|neutral|skipped)$/)' || true)
PRESENT=$(printf '%s\n' "$LATEST" | awk -F'\t' 'NF {print $1}' || true)

# True when every required check is present on the tested commit. A skipped
# check reports success for the required gate (a docs-only PR skips Lint, Build,
# Tests, E2E) but must still be *present*, so an early subset (E2E not started
# yet) is not mistaken for the full gate. IFS is newline so names with spaces
# stay intact.
required_present() {
  _ifs=$IFS
  IFS='
'
  set -f
  for want in $(printf '%s\n' "$REQUIRED_CHECKS" | tr '|' '\n'); do
    printf '%s\n' "$PRESENT" | grep -qxF "$want" || { IFS=$_ifs; set +f; return 1; }
  done
  IFS=$_ifs
  set +f
  [ "$(printf '%s\n' "$REQUIRED_CHECKS" | grep -c .)" -gt 0 ]
}

failed_names() { printf '%s\n' "$RED" | awk -F'\t' 'NF {print "- `" $1 "`"}'; }

# True when a check from every known suite is present. Together with
# required_present this rejects a green subset: a suite that has not published
# its check run yet (E2E only starts after CI, so early on it is absent) keeps
# the decision pending rather than green.
known_suites_seen() {
  _ifs=$IFS
  IFS='
'
  set -f
  for _sign in $(printf '%s\n' "$KNOWN_SUITE_SIGNS" | tr '|' '\n'); do
    [ -n "$_sign" ] || continue
    printf '%s\n' "$PRESENT" \
      | awk -v s="$_sign" 'index($0, s) == 1 { found = 1 } END { exit !found }' \
      || { IFS=$_ifs; set +f; return 1; }
  done
  IFS=$_ifs
  set +f
  return 0
}

# Post exactly one lifecycle comment and keep it current. The PR carries at most
# one comment whose body contains LIFE_MARK; it is rewritten when the state (the
# dedupe token) changes, and left alone when it does not, so a new commit that
# fails different checks replaces the stale list instead of being suppressed by
# an existing marker. The token is embedded in the body so a repeat of the same
# state is recognised.
comment_once() { # comment_once <body> <dedupe-token>
  body="$1"; token="$2"
  # The footer is appended here, once, so every message carries it and the
  # dedupe comparison below sees the same text that is posted.
  body="$body

$AI_FOOTER"
  # The REST comments list gives each comment's numeric database id; the GraphQL
  # node id from `gh pr view --json comments` is rejected by
  # repos/.../issues/comments/{id}, so the GET and PATCH below must use this id.
  # Newest marker first: a comment the workflow cannot edit (posted by another
  # actor) must not be retried forever while a fresh notice stacks up each run.
  # Editing the newest editable one keeps a single current comment.
  ids=$(gh api --paginate "repos/$REPO/issues/$PR/comments?per_page=100" \
    --jq ".[] | select(.body | contains(\"$LIFE_MARK\")) | .id" 2>/dev/null \
    | awk '{ a[NR] = $0 } END { for (i = NR; i >= 1; i--) print a[i] }' || true)
  for id in $ids; do
    old=$(gh api "repos/$REPO/issues/comments/$id" --jq .body 2>/dev/null || true)
    if [ "$old" = "$body" ]; then
      echo "Lifecycle comment already current ('$token'); not repeating."
      return 0
    fi
    if gh api "repos/$REPO/issues/comments/$id" -X PATCH -f body="$body" >/dev/null 2>&1; then
      echo "Updated lifecycle comment ('$token')."
      return 0
    fi
  done
  echo "No editable lifecycle comment ('$token'); posting a fresh one."
  gh pr comment "$PR" --repo "$REPO" --body "$body"
}

if [ "$REVIEW" = "CHANGES_REQUESTED" ]; then
  # The commit the most recent changes-requested review was made on. On the
  # current head, the PR waits for fixes and branch protection holds the merge.
  # On an older commit, the author has pushed since: carry on, so a green head
  # goes back to the gate, which reviews the new head (one review per head
  # commit) and gives its own verdict. Exiting here unconditionally meant the
  # gate's request was final: nothing else dispatches it, and #628 sat green
  # and fixed with no re-review (#727).
  REQUESTED_AT=$(gh api --paginate "repos/$REPO/pulls/$PR/reviews?per_page=100" 2>/dev/null \
    | jq -rs '[.[][] | select(.state == "CHANGES_REQUESTED")] | last | .commit_id // empty' 2>/dev/null || true)
  if [ -z "$REQUESTED_AT" ] || [ "$REQUESTED_AT" = "$HEAD" ]; then
    echo "PR #$PR has changes requested; leaving it open for fixes."
    exit 0
  fi
  echo "PR #$PR had changes requested on $REQUESTED_AT; the head $HEAD came after, so a green head goes back to the review gate."
fi

if [ -n "$RED" ]; then
  # Red checks: stay quiet. The PR is not a draft (a maintainer marked it ready),
  # and the failing checks are already visible on the PR. Drafting it would only
  # hide work in progress.
  echo "PR #$PR has failing checks; leaving it as it is."
  exit 0
fi

# Require the full set, not just a nonempty one: a green subset (an early CI
# finish before E2E has published its checks) is still pending.
if [ -n "$PENDING" ] || [ "$(printf '%s\n' "$LATEST" | grep -c .)" -eq 0 ] \
  || ! required_present || ! known_suites_seen; then
  echo "Checks for $CHECK_SHA are not all green yet; leaving the PR as it is."
  exit 0
fi

# Every required check passed. A green draft is still a draft: notify and leave
# the ready decision to a human.
if [ "$DRAFT" = "true" ]; then
  comment_once "All checks are green. This PR is a **draft**; mark it ready for review when the work is complete. ${GREEN_MARK}" "green"
  echo "PR #$PR is green and still a draft."
  exit 0
fi

# Green and ready: dispatch the review gate so it runs the moment CI passes,
# instead of waiting for a `ready_for_review` re-transition (which never comes
# if the PR was already ready) or relying on the agent to poll. The call is
# best-effort: a missing key or an HTTP error must not fail the workflow, and
# GitHub's rerun/retry path can post it again. The gate itself is idempotent —
# one review per head commit — and is configured for no wake agent, so a dispatch
# starts a fresh, bounded conversation and cannot pile up.
GATE_ID="${SDLC_REVIEW_GATE_ID:-96eebf19-b64b-4035-9653-2d8b15b06ac4}"
if [ -n "${OPENHANDS_API_KEY:-}" ]; then
  body=$(jq -n --arg pr "$PR" --arg sha "$CHECK_SHA" \
    '{source: "gate-bridge", pr: $pr, head_sha: $sha}')
  # curl exits 0 on any HTTP answer, a 401 included, so the status code is what
  # says whether the gate was dispatched — not curl's exit code.
  code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
      "https://app.all-hands.dev/api/automation/v1/$GATE_ID/dispatch" \
      -H "Authorization: Bearer $OPENHANDS_API_KEY" \
      -H "Content-Type: application/json" \
      -d "$body" 2>/dev/null || echo 000)
  case "$code" in
    2??) echo "Dispatched review gate for PR #$PR at $CHECK_SHA (HTTP $code)." ;;
    *) echo "::warning::Review-gate dispatch for PR #$PR answered HTTP $code; CI is still green and a re-request will retrigger it." ;;
  esac
else
  echo "PR #$PR is green and ready, but OPENHANDS_API_KEY is not set; the gate will run on the next re-request."
fi
