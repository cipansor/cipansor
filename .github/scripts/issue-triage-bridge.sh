#!/bin/sh
# Dispatch the issue triage owner when another automation has responded, or when
# an open, not-`ready` issue has new activity.
#
# Why this exists: nothing in the fleet fires on `issues.edited`, so a reporter
# who edits an issue description gets no re-triage (found on #818, whose body was
# edited twice after triage with no answer). The triage owner is instead
# dispatched deterministically by this bridge:
#
#   --stdin   a bot applies a type or priority label — the labeler responded, so
#             the triage owner studies the issue and the bot's comment
#   --sweep   an open, not-`ready` issue has new activity by someone other than
#             the fleet — this catches an edited description or a new comment
#             without a trigger on `issues.edited`
#
# The sweep keys on an *activity signal*: a hash of the issue body plus every
# non-fleet comment's author, body and `updated_at`. A description edit, a new
# comment or an edited comment changes the hash, and it is compared with the
# checkpoint stored in the sweep marker. Because the signal is content, not a
# second-resolution timestamp, a reporter edit made in the same second as the
# marker write is still a different signal and is caught (the old
# `updated_at <= comment_time` comparison swallowed it). The fleet's own comments
# (the bot and GitHub Actions) are excluded, so a bot reply never re-triages the
# issue — that is what keeps the loop closed.
#
# The checkpoint is written only after the dispatch is accepted (HTTP 2xx): a
# failed dispatch leaves the old checkpoint, so the next sweep retries it and the
# run fails loudly instead of looking like a quiet, completed sweep.
#
# An issue whose summary lives in the body with no marker comment (triaged before
# this bridge existed) has no checkpoint, so it is dispatched once as a migration
# and given a marker; the body marker is never a reason to skip it.
#
# The triage owner is idempotent (one comment per round, updated in place), so a
# duplicate dispatch is not a duplicate comment — the markers exist to save runs.
#
# Usage: issue-triage-bridge.sh --stdin
#        issue-triage-bridge.sh --sweep
# Env:   GH_TOKEN, REPO, OPENHANDS_API_KEY, SDLC_TRIAGE_ID (default `SDLC 01`),
#        CURL (default curl), SWEEP_MAX (default 15, dispatches per sweep),
#        SWEEP_PAGES (default 5, search pages read per sweep),
#        BURST_WINDOW (default 300, seconds a label burst stays collapsed)
set -eu

REPO="${REPO:?REPO is required}"
# `SDLC 01 · Triase bug`. Overridable so a redeploy that moves the id does not
# need a workflow edit.
TRIAGE_ID="${SDLC_TRIAGE_ID:-d648595e-b0d9-4120-bbc4-07395cdbe6bf}"
API="https://app.all-hands.dev/api/automation/v1"
CURL="${CURL:-curl}"
TYPE_LABELS="bug enhancement documentation refactor chore security"
# SWEEP_MAX caps dispatches (cost); SWEEP_PAGES caps the API calls. The sweep
# reads up to SWEEP_PAGES pages, sorts by activity, then stops dispatching after
# SWEEP_MAX so the freshest issues go first and the rest wait for the next run.
SWEEP_MAX="${SWEEP_MAX:-15}"
# Pages of 100 read per sweep, requested one at a time so the cap actually bounds
# the API calls (`gh api --paginate` would read every page). An issue past this
# window is not lost — the next sweep's `sort` by activity moves it in front once
# it is touched.
SWEEP_PAGES="${SWEEP_PAGES:-5}"
# The labeler applies type, priority and status in one burst; a marker younger
# than this collapses the burst to one dispatch. A later change to a type or
# priority the issue held before still dispatches once the window has passed.
BURST_WINDOW="${BURST_WINDOW:-300}"
# Every marker comment carries the AI-disclosure footer: without it a
# comment-triggered automation (Penjernih issue on `needs-info`, or
# acknowledge.yml) would read the marker as a reporter's reply and fire.
FOOTER="_This comment was created by an AI agent (OpenHands) on behalf of the repository maintainers._"
MARK_PREFIX="<!-- triage-bridge-sweep:"


# A UTC timestamp as epoch seconds (0 on a parse failure).
epoch() { date -u -d "$1" +%s 2>/dev/null || echo 0; }

# Dispatch the triage owner for one issue. The body is built with jq so an issue
# number or a marker can never break out of its JSON string. Returns non-zero on
# a non-2xx answer so the caller can withhold the marker and retry later.
dispatch() { # dispatch <number> <reason> <key>
  n="$1"; reason="$2"; key="$3"
  if [ -z "${OPENHANDS_API_KEY:-}" ]; then
    echo "::error::OPENHANDS_API_KEY is not set; the triage owner cannot be dispatched for #$n."
    return 1
  fi
  body=$(jq -n --arg source triage-bridge --argjson issue "$n" \
    --arg reason "$reason" --arg key "$key" \
    '{source: $source, issue: $issue, reason: $reason, key: $key}')
  code=$("$CURL" -s -o /tmp/triage-bridge.out -w '%{http_code}' -X POST \
    "$API/$TRIAGE_ID/dispatch" \
    -H "Authorization: Bearer $OPENHANDS_API_KEY" \
    -H "Content-Type: application/json" \
    -d "$body")
  cat /tmp/triage-bridge.out 2>/dev/null; echo
  # A dispatch that is not accepted must be visible and retryable: a silent
  # triage is the failure this bridge exists to prevent.
  case "$code" in
    2??) echo "Dispatched the triage owner for #$n ($reason, HTTP $code)." ;;
    *) echo "::error::Dispatching the triage owner for #$n failed (HTTP $code)."; return 1 ;;
  esac
}

# The marker for the issue's current type+priority state. Keyed on the labels so
# a label burst collapses to one dispatch while a real change re-dispatches.
state_marker() { # state_marker <number>
  n="$1"
  state=$(gh api "repos/$REPO/issues/$n" \
    --jq '[.labels[].name | select(test("^(bug|enhancement|documentation|refactor|chore|security)$") or startswith("priority:"))] | sort | join("+")' \
    2>/dev/null || echo "")
  [ -n "$state" ] || state="none"
  echo "<!-- triage-bridge:$n:$state -->"
}

has_comment() { # has_comment <number> <marker>
  n="$1"; m="$2"
  gh api --paginate "repos/$REPO/issues/$n/comments?per_page=100" --jq '.[].body' 2>/dev/null \
    | grep -Fq -- "$m"
}

# The state marker's newest `updated_at`, or "" when it is absent.
state_marker_age() { # state_marker_age <number> <marker>
  gh api --paginate "repos/$REPO/issues/$1/comments?per_page=100" \
    --jq "[.[] | select(.body | contains(\"$2\")) | .updated_at] | max // \"\"" \
    2>/dev/null || echo ""
}

post_marker() { # post_marker <number> <marker>
  n="$1"; m="$2"
  tmp=$(mktemp)
  # The marker stays greppable (has_comment matches it as a substring); the
  # footer is appended so the marker is not mistaken for a reporter's reply.
  jq -n --arg body "$m

$FOOTER" '{body: $body}' > "$tmp"
  gh api "repos/$REPO/issues/$n/comments" -X POST --input "$tmp" >/dev/null 2>&1 \
    || echo "::warning::could not record the triage-bridge marker on #$n."
  rm -f "$tmp"
}

# The sweep marker's checkpoint signal (`<!-- triage-bridge-sweep:<n>:<signal> -->`),
# or "" when there is no marker.
marker_signal() { # marker_signal <number>
  gh api --paginate "repos/$REPO/issues/$1/comments?per_page=100" \
    --jq "[.[] | select(.body | startswith(\"$MARK_PREFIX$1:\"))] | last | .body // \"\"" \
    2>/dev/null \
    | sed -n "s/^$MARK_PREFIX[0-9]*:\([^ ]*\) -->.*/\1/p" | head -n1
}

# The issue's activity signal: a hash of the body plus every non-fleet comment's
# author, body and `updated_at`, serialized as compact JSON. Read as JSON and
# hashed straight from the pipe — never through `$(…)`, which strips trailing
# newlines, so a body that only gains a trailing newline would hash the same and
# the edit would be missed. Independent of any single timestamp, so a same-second
# edit is still a different signal; the fleet's own comments are excluded so a
# bot reply never re-triages the issue. Actions comments post as
# `github-actions[bot]`, so every `*[bot]` account is excluded along with the
# automation account.
activity_signal() { # activity_signal <number>; non-zero when a read fails
  body_json=$(gh api "repos/$REPO/issues/$1") || return 1
  comments_json=$(gh api --paginate "repos/$REPO/issues/$1/comments?per_page=100") || return 1
  # jq's compact JSON escapes any internal newline, so capturing the result in a
  # variable does not lose a trailing newline the way a raw body would.
  sig=$(
    {
      printf '%s' "$body_json" | jq -c '{body: (.body // "")}'
      printf '%s' "$comments_json" \
        | jq -c '[.[] | select(((.user.login | test("\\[bot\\]$")) or .user.login == "cipansor-bot") | not) | {login: .user.login, updated: .updated_at, body: .body}]'
    } | sha256sum | cut -c1-16
  )
  [ -n "$sig" ] || return 1
  printf '%s' "$sig"
}

# Create or update the single sweep marker, editing the existing one in place.
write_sweep_marker() { # write_sweep_marker <number> <signal>
  n="$1"; sig="$2"
  cid=$(gh api --paginate "repos/$REPO/issues/$n/comments?per_page=100" \
    --jq "[.[] | select(.body | startswith(\"$MARK_PREFIX$n:\"))] | last | .id // \"\"" 2>/dev/null || echo "")
  tmp=$(mktemp)
  # The signal is the checkpoint: it is the activity this run has answered, so
  # the next sweep only re-dispatches when the signal changes again.
  jq -n --arg body "$MARK_PREFIX$n:$sig -->

$FOOTER" '{body: $body}' > "$tmp"
  if [ -n "$cid" ]; then
    gh api "repos/$REPO/issues/comments/$cid" -X PATCH --input "$tmp" >/dev/null 2>&1 \
      || echo "::warning::could not update the triage-bridge marker on #$n."
  else
    gh api "repos/$REPO/issues/$n/comments" -X POST --input "$tmp" >/dev/null 2>&1 \
      || echo "::warning::could not record the triage-bridge marker on #$n."
  fi
  rm -f "$tmp"
}

# Drop the sweep marker: the issue is closed or `ready`, so it is out of scope
# and a stale marker must not linger to mislead a later reader.
remove_sweep_marker() { # remove_sweep_marker <number>
  cid=$(gh api --paginate "repos/$REPO/issues/$1/comments?per_page=100" \
    --jq "[.[] | select(.body | startswith(\"$MARK_PREFIX$1:\"))] | last | .id // \"\"" 2>/dev/null || echo "")
  if [ -n "$cid" ]; then
    gh api "repos/$REPO/issues/comments/$cid" -X DELETE >/dev/null 2>&1 \
      || echo "::warning::could not remove the triage-bridge marker on #$1."
  fi
}

# --stdin: a bot applied a type or priority label.
on_label() { # on_label <event-json>
  event="$1"
  action=$(printf '%s' "$event" | jq -r '.action // empty')
  [ "$action" = labeled ] || { echo "action='$action'; nothing to do."; exit 0; }
  label=$(printf '%s' "$event" | jq -r '.label.name // empty')
  sender=$(printf '%s' "$event" | jq -r '.sender.login // empty')
  number=$(printf '%s' "$event" | jq -r '.issue.number // .pull_request.number // empty')

  # Only a bot's label is another automation responding; a person's label is not
  # a reason to triage (and `label-guard` revokes a person's protected label).
  case "$sender" in
    *bot | *\[bot\]) : ;;
    *) echo "sender '$sender' is not a bot; nothing to do."; exit 0 ;;
  esac
  # Only a type or priority label means the labeler responded.
  is_signal=0
  case " $TYPE_LABELS " in *" $label "*) is_signal=1 ;; esac
  case "$label" in priority:*) is_signal=1 ;; esac
  [ "$is_signal" = 1 ] || { echo "label '$label' is not a type or priority; nothing to do."; exit 0; }
  [ -n "$number" ] || { echo "no issue number in the event; nothing to do."; exit 0; }

  marker=$(state_marker "$number")
  if has_comment "$number" "$marker"; then
    # The same type+priority state was already dispatched. Collapse only a burst:
    # once BURST_WINDOW has passed, a return to a state the issue held before is a
    # fresh response and dispatches again.
    age=$(state_marker_age "$number" "$marker")
    if [ -n "$age" ]; then
      since=$(( $(date -u +%s) - $(epoch "$age") ))
      if [ "$since" -lt "$BURST_WINDOW" ]; then
        echo "#$number already dispatched for this state ${since}s ago; burst collapsed."
        exit 0
      fi
    fi
  fi
  # Snapshot the activity *before* the dispatch, then record that snapshot as the
  # checkpoint only after the dispatch is accepted. The dispatch answers the
  # activity seen here; an edit landing between the snapshot and the marker write
  # changes the signal, so the next sweep still catches it (taking the signal
  # after the dispatch would fold that edit into the checkpoint and lose it).
  # A failed read must not write a checkpoint (an empty signal would look like a
  # change and re-dispatch every sweep); the label still dispatches, the sweep
  # catches the activity up later.
  sig=$(activity_signal "$number") || sig=""
  if dispatch "$number" labeled "$marker"; then
    post_marker "$number" "$marker"
    if [ -n "$sig" ]; then write_sweep_marker "$number" "$sig"; fi
  else
    echo "::warning::#${number}'s label state stays unmarked; a later label or the sweep retries."
    exit 1
  fi
}

# One candidate issue: decide whether it needs a dispatch. Returns 0 when a
# dispatch was accepted, 2 when a dispatch was attempted and failed, 1 otherwise.
process_one() { # process_one <number>
  n="$1"

  # A closed or `ready` issue is out of scope; drop any stale marker and stop.
  state=$(gh api "repos/$REPO/issues/$n" \
    --jq '[.state, (.labels[].name)] | join(" ")' 2>/dev/null) \
    || { echo "::warning::could not read #$n; skipped this sweep."; return 1; }
  case " $state " in
    *" closed "* | *" ready "*)
      remove_sweep_marker "$n"
      return 1
      ;;
  esac

  # A read failure is "skip", not "empty activity": an empty input still hashes
  # to a non-empty value, which would look like a change and dispatch an
  # unchanged issue on every sweep.
  sig=$(activity_signal "$n") \
    || { echo "::warning::could not read the activity of #$n; skipped this sweep."; return 1; }
  [ -n "$sig" ] || return 1
  # Nothing moved since the checkpoint: not a reason to triage.
  if [ "$sig" = "$(marker_signal "$n")" ]; then
    return 1
  fi

  # The activity changed. Dispatch; only a 2xx earns the new checkpoint, so a
  # failure keeps the old one and the next sweep retries.
  if dispatch "$n" sweep-activity "$sig"; then
    write_sweep_marker "$n" "$sig"
    return 0
  fi
  echo "::warning::dispatch failed for #$n; the checkpoint is unchanged, so the next sweep retries."
  return 2
}

# --sweep: an open, not-`ready` issue whose activity changed since the checkpoint.
# Catches an edited description or a new comment with no event to hook.
sweep() {
  count=0
  fails=0
  # Read up to SWEEP_PAGES pages, newest activity first. `gh api --paginate` would
  # fetch every page regardless, so the pages are requested one at a time and the
  # loop stops at SWEEP_PAGES or the first short page: SWEEP_PAGES caps the API
  # calls, SWEEP_MAX caps the dispatches, and sorting by activity puts the
  # freshest issues first. An issue past this window is not lost — the next
  # sweep's `sort` moves it in front once it is touched.
  cand=$(mktemp)
  page=1
  while [ "$page" -le "$SWEEP_PAGES" ]; do
    items=$(gh api -X GET search/issues \
      -f q="repo:$REPO is:issue is:open -label:ready" -f per_page=100 \
      -f sort=updated -f order=desc -f page="$page" \
      --jq '.items[] | "\(.updated_at) \(.number)"' 2>/dev/null || echo "")
    [ -n "$items" ] || break
    printf '%s\n' "$items" >> "$cand"
    got=$(printf '%s\n' "$items" | grep -c . || true)
    [ "$got" -ge 100 ] || break
    page=$((page + 1))
  done
  sort -r -u -o "$cand" "$cand"

  while read -r _ts n; do
    [ -n "${n:-}" ] || continue
    [ "$count" -lt "$SWEEP_MAX" ] || { echo "Reached SWEEP_MAX=$SWEEP_MAX; the rest wait for the next run."; break; }
    # `process_one` returns 1 for "nothing to do" — a normal outcome. It is called
    # in an `if` so `set -e` does not abort the sweep on that status (a bare call
    # would stop at the first already-handled issue and fail the run).
    rc=0
    if process_one "$n"; then rc=0; else rc=$?; fi
    case "$rc" in
      0) count=$((count + 1)) ;;
      2) fails=$((fails + 1)) ;;
    esac
  done < "$cand"
  rm -f "$cand"

  echo "sweep done"
  # A failed dispatch must fail the run so it is visible and retried, not left
  # looking like a quiet, completed sweep.
  if [ "$fails" -ne 0 ]; then
    echo "::error::$fails triage dispatch(es) failed; the next sweep retries them."
    exit 1
  fi
}

case "${1:-}" in
  --stdin) on_label "$(cat)" ;;
  --sweep) sweep ;;
  *) echo "usage: issue-triage-bridge.sh --stdin | --sweep" >&2; exit 2 ;;
esac
