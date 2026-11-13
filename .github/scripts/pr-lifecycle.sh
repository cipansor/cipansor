#!/bin/sh
# Post the CI result and dispatch the review gate for a ready PR.
#
#   green checks on a draft PR    -> post the all-green comment (informational)
#   green checks on a ready PR, head not yet reviewed -> dispatch the review gate
#   green checks on a ready PR, head already reviewed -> do nothing (the gate is
#                                                    idempotent; the review stands)
#   red checks                      -> do nothing
#   changes requested on the head   -> do nothing (waiting for fixes)
#
# The gate runs a full review for every ready, green head it has not reviewed
# yet — not only the first (2026-10-16, superseding the 2026-10-15 "first review
# only" rule): a ready PR is what the gate exists for, so its author need not
# ask a second time by hand. The automatic pass is bounded by the gate's own
# idempotency (one review per head commit): a head already reviewed is skipped,
# so re-running this workflow never stacks runs, and a dispatch happens only
# after every required check is green (#840) — never on the `ready_for_review`
# transition itself. A re-request of `cipansor-bot` as reviewer still works and
# is what the `pull_request.review_requested` trigger serves.
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
GATE_LOGIN="${GATE_LOGIN:-cipansor-bot}"

LIFE_MARK="<!-- pr-lifecycle:"
GREEN_MARK="<!-- pr-lifecycle:green -->"

# Automated comments carry no AI-disclosure footer: the anti-loop guard is the
# comment's author (`cipansor-bot` or a `*[bot]` App), not the footer text. The
# account name already tells a reader the comment is automated (#680).

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
  # On an older commit, the author has pushed since: carry on so the green-head
  # path below runs. That path dispatches the gate for the new head — the gate's
  # review of the *older* head does not count, so a fresh green head is reviewed
  # without the author asking by hand (2026-10-16).
  REQUESTED_AT=$(gh api --paginate "repos/$REPO/pulls/$PR/reviews?per_page=100" 2>/dev/null \
    | jq -rs '[.[][] | select(.state == "CHANGES_REQUESTED")] | last | .commit_id // empty' 2>/dev/null || true)
  if [ -z "$REQUESTED_AT" ] || [ "$REQUESTED_AT" = "$HEAD" ]; then
    echo "PR #$PR has changes requested; leaving it open for fixes."
    exit 0
  fi
  echo "PR #$PR had changes requested on $REQUESTED_AT; the head $HEAD came after."
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

# Green and ready. The gate runs a full review for every ready head that is
# green and not yet reviewed on that head — not only the first (2026-10-16,
# superseding the 2026-10-15 "first review only" rule): a ready PR is what the
# gate exists for, so its author need not ask a second time by hand. What keeps
# this bounded is the gate's own idempotency (one review per head commit): a
# head already reviewed is skipped, so a re-run of this workflow on the same
# head does not stack runs, and only a genuinely new green head dispatches. The
# #840 rule is intact — a dispatch happens only after every required check is
# green, never on the `ready_for_review` transition itself. The dispatch is
# best-effort: a missing key or an HTTP error must not fail the workflow. The
# gate is configured for no wake agent, so a dispatch starts a fresh, bounded
# conversation.
GATE_ID="${SDLC_REVIEW_GATE_ID:-96eebf19-b64b-4035-9653-2d8b15b06ac4}"
GATE_API="${GATE_API:-https://app.all-hands.dev/api/automation/v1}"

# --- The dispatch claim, in the automation KV store -------------------------
#
# The review check above ("has the gate reviewed this head?") is a read-then-write:
# two runs for the same green head can both read "not reviewed yet" before either
# posts a review, and both dispatch. That is how PR #1052 collected three
# APPROVED reviews on one SHA in three minutes (#1083). The workflow's concurrency
# group does not close it — it is keyed per PR with `cancel-in-progress: false`,
# so the second run queues and still runs.
#
# The claim below makes the decision a write. One key per (PR, head) is created
# with `nx=true` (or advanced with `if_version`), the store answers 409 to the
# loser, and only the winner dispatches. The claim carries the attempt count and
# the moment it was taken: a dispatch that died in infrastructure is retried by a
# later run (bounded by REVIEW_GATE_ATTEMPT_MAX), while a claim whose gate is
# simply still running is left alone (REVIEW_GATE_STALE_MIN).
#
# A store that cannot be reached must not wedge the gate: the claim is
# best-effort, and any non-2xx answer that is not the 409 conflict falls through
# to the dispatch — the behaviour before the claim existed — with a warning.
GATE_CLAIM_KEY="review-gate-$PR-$HEAD"
GATE_ATTEMPT_MAX="${REVIEW_GATE_ATTEMPT_MAX:-3}"
GATE_STALE_MIN="${REVIEW_GATE_STALE_MIN:-45}"

# Read the claim: GATE_CLAIM is the stored object, GATE_CLAIM_VER its version.
# Returns 0 when the key exists, 1 when it does not, 2 when the store could not
# be read — so a hiccup is never mistaken for "no claim".
GATE_CLAIM="{}"
GATE_CLAIM_VER=0
gate_claim_read() {
  GATE_CLAIM="{}"; GATE_CLAIM_VER=0
  tmp=$(mktemp)
  code=$(curl -sS -o "$tmp" -w '%{http_code}' \
    "$GATE_API/kv/$GATE_CLAIM_KEY?meta=true&automation_id=$GATE_ID" \
    -H "Authorization: Bearer ${OPENHANDS_API_KEY:-}" 2>/dev/null) \
    || { rm -f "$tmp"; return 2; }
  case "$code" in
    404) rm -f "$tmp"; return 1 ;;
    2??) : ;;
    *) rm -f "$tmp"; return 2 ;;
  esac
  GATE_CLAIM=$(jq -c '.value // {}' "$tmp" 2>/dev/null) || { rm -f "$tmp"; return 2; }
  GATE_CLAIM_VER=$(jq -r '.version // 0' "$tmp" 2>/dev/null) || GATE_CLAIM_VER=0
  case "$GATE_CLAIM_VER" in '' | *[!0-9]*) GATE_CLAIM_VER=0 ;; esac
  rm -f "$tmp"
  return 0
}

# Conditional upsert. Returns 0 on success, 1 on the 409 conflict (another run
# claimed it first), 2 on any other failure.
gate_claim_write() { # <json-object> <expected-version>
  if [ "$2" -gt 0 ]; then
    url="$GATE_API/kv/$GATE_CLAIM_KEY?if_version=$2&automation_id=$GATE_ID"
  else
    url="$GATE_API/kv/$GATE_CLAIM_KEY?nx=true&automation_id=$GATE_ID"
  fi
  code=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT "$url" \
    -H "Authorization: Bearer ${OPENHANDS_API_KEY:-}" \
    -H "Content-Type: application/json" -d "$1" 2>/dev/null) || return 2
  case "$code" in
    409) return 1 ;;
    2??) return 0 ;;
    *) return 2 ;;
  esac
}

# Release the claim so a later run retries a dispatch that never landed.
gate_claim_release() {
  curl -sS -o /dev/null -X DELETE \
    "$GATE_API/kv/$GATE_CLAIM_KEY?automation_id=$GATE_ID" \
    -H "Authorization: Bearer ${OPENHANDS_API_KEY:-}" 2>/dev/null || true
}

GATE_REVIEWS=$(gh api --paginate "repos/$REPO/pulls/$PR/reviews?per_page=100" 2>/dev/null || echo unread)
if [ "$GATE_REVIEWS" = "unread" ]; then
  # A failed read must not look like "never reviewed": dispatching then would
  # run the gate on a head it may already have reviewed. Stay quiet and let the
  # next run decide.
  echo "::warning::PR #$PR: reviews unreadable; not dispatching the review gate."
elif printf '%s' "$GATE_REVIEWS" | jq -s -e --arg g "$GATE_LOGIN" --arg s "$HEAD" \
    'any(.[][]?; .user.login == $g and .commit_id == $s)' >/dev/null 2>&1; then
  # The gate already reviewed this very head: nothing is owed, whatever the
  # verdict (an approval is final; a request for changes waits on the author).
  echo "PR #$PR head $HEAD was already reviewed by the gate; nothing to dispatch."
elif [ -n "${OPENHANDS_API_KEY:-}" ]; then
  # Decide whether this run is the one that dispatches.
  GATE_DISPATCH=1
  claim_rc=0; gate_claim_read || claim_rc=$?
  now=$(date -u +%s)
  if [ "$claim_rc" = 2 ]; then
    echo "::warning::PR #$PR: the dispatch claim could not be read; dispatching without it (a concurrent run may double-dispatch)."
  elif [ "$claim_rc" = 1 ]; then
    # No claim yet: create it. The winner dispatches; a 409 means another run won.
    cw=0; gate_claim_write "$(jq -nc --argjson at "$now" '{at:$at,attempt:1}')" 0 || cw=$?
    case "$cw" in
      0) echo "PR #$PR head $HEAD: claimed the review-gate dispatch." ;;
      1) GATE_DISPATCH=0; echo "PR #$PR head $HEAD: another run claimed the review-gate dispatch first; not dispatching." ;;
      *) echo "::warning::PR #$PR: the dispatch claim could not be written; dispatching without it (a concurrent run may double-dispatch)." ;;
    esac
  else
    prev_at=$(printf '%s' "$GATE_CLAIM" | jq -r '.at // 0' 2>/dev/null) || prev_at=0
    case "$prev_at" in '' | *[!0-9]*) prev_at=0 ;; esac
    prev_attempt=$(printf '%s' "$GATE_CLAIM" | jq -r '.attempt // 0' 2>/dev/null) || prev_attempt=0
    case "$prev_attempt" in '' | *[!0-9]*) prev_attempt=0 ;; esac
    age_min=$(( (now - prev_at) / 60 ))
    if [ "$prev_attempt" -ge "$GATE_ATTEMPT_MAX" ]; then
      GATE_DISPATCH=0
      echo "::warning::PR #$PR head $HEAD: the review gate was dispatched $prev_attempt time(s) and none produced a review; leaving it for a human (REVIEW_GATE_ATTEMPT_MAX=$GATE_ATTEMPT_MAX)."
    elif [ "$age_min" -lt "$GATE_STALE_MIN" ]; then
      GATE_DISPATCH=0
      echo "PR #$PR head $HEAD was claimed ${age_min}m ago; the gate is already working on it, not dispatching again."
    else
      attempt=$((prev_attempt + 1))
      cw=0
      gate_claim_write "$(jq -nc --argjson at "$now" --argjson a "$attempt" '{at:$at,attempt:$a}')" "$GATE_CLAIM_VER" || cw=$?
      case "$cw" in
        0) echo "PR #$PR head $HEAD: the previous dispatch (${age_min}m ago) produced no review; re-dispatching (attempt $attempt/$GATE_ATTEMPT_MAX)." ;;
        1) GATE_DISPATCH=0; echo "PR #$PR head $HEAD: another run holds the claim; not dispatching." ;;
        *) echo "::warning::PR #$PR: the dispatch claim could not be written; dispatching without it." ;;
      esac
    fi
  fi

  if [ "$GATE_DISPATCH" = 1 ]; then
    # Acknowledge: the gate is about to run on this PR, so react 👀 on it. The
    # reporter sees the automation is working before the review lands (asked
    # 2026-10-13). Best-effort — a reaction must never fail the dispatch.
    sh "$(dirname "$0")/reaction.sh" "$PR" 2>/dev/null || true
    # `POST /dispatch` has no request body (the API's schema declares none), so
    # nothing sent here reaches the agent — the gate reads its target from the
    # PR list itself (the `SASARAN` rule in its prompt). Send no body rather than
    # a `{pr, head_sha}` object the platform silently drops.
    # curl exits 0 on any HTTP answer, a 401 included, so the status code is what
    # says whether the gate was dispatched — not curl's exit code.
    code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
        "$GATE_API/$GATE_ID/dispatch" \
        -H "Authorization: Bearer $OPENHANDS_API_KEY" 2>/dev/null || echo 000)
    case "$code" in
      2??) echo "Dispatched review gate for PR #$PR at $CHECK_SHA (HTTP $code)." ;;
      *)
        # The claim would otherwise read as "the gate is running" and hold the
        # retry back until the stale window; release it so the next run tries
        # again at once.
        gate_claim_release
        echo "::warning::Review-gate dispatch for PR #$PR answered HTTP $code; released the claim so a re-request retriggers it." ;;
    esac
  fi
else
  echo "PR #$PR is green and ready, but OPENHANDS_API_KEY is not set; the gate will run on the next re-request."
fi
