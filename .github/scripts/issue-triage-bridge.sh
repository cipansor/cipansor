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
# The checkpoint is NOT written when the dispatch is accepted. A 2xx only means
# the run was *created*; it can still die for lack of a sandbox (#836: 15 runs
# started at once, 14 died with `Sandbox not available`, and a checkpoint written
# at 2xx made the sweep skip them forever). Instead the checkpoint records the
# run id while it is *in flight* (`{"signal": …, "run": …}`) and the next sweep
# reads that run's outcome: COMPLETED finalises the checkpoint (the run field is
# cleared), FAILED/CANCELLED/SKIPPED re-dispatches, RUNNING/PENDING leaves it in
# flight. A checkpoint therefore means "a run finished", never merely "a request
# was accepted" — retrying on the run's result, not on when the checkpoint was
# written.
#
# Checkpoints live in the automation KV store, not in issue comments. An
# HTML-only marker comment renders as an empty comment: every write notified the
# issue's subscribers and left an unreadable husk (2026-11-11: 153 of them). The
# KV store holds the same data silently — see the `SWEEP_KEY`/`STATE_KEY` note
# below, so no state lives in a comment.
#
# The sweep also caps how many triage runs may be RUNNING/PENDING at once
# (MAX_INFLIGHT). A sweep that finds the cap reached defers the rest to the next
# run instead of starting runs the sandbox pool cannot host; the runs are not
# lost, the next sweep picks them up. This is the fleet-side queue (#841): the
# platform's own dispatch queue waits and then times out under a burst, so the
# fleet never forms the burst in the first place.
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
# Env:   GH_TOKEN, REPO, OPENHANDS_API_KEY, SDLC_TRIAGE_ID (default `SDLC 15`),
#        CURL (default curl), SWEEP_MAX (default 15, dispatches per sweep),
#        SWEEP_PAGES (default 5, search pages read per sweep),
#        MAX_INFLIGHT (default 3, triage runs allowed RUNNING/PENDING at once),
#        BURST_WINDOW (default 300, seconds a label burst stays collapsed)
set -eu

REPO="${REPO:?REPO is required}"
# `SDLC 15 · Triase issue`, the single triage owner since `SDLC 01 · Triase bug`
# was folded into it on 2026-11-09 (`SDLC 01` had the deeper criticality pass;
# `SDLC 15` had the label taxonomy, priority rubric and estimate). Overridable so
# a redeploy that moves the id does not need a workflow edit.
TRIAGE_ID="${SDLC_TRIAGE_ID:-42ec7401-88f2-4f78-ab75-a93235fa52e4}"
API="https://app.all-hands.dev/api/automation/v1"
# The runs endpoint of the triage owner: the sweep reads its own run outcomes
# (retry on the result) and counts how many are in flight (the queue cap).
API_RUNS="$API/$TRIAGE_ID/runs"
CURL="${CURL:-curl}"
TYPE_LABELS="bug enhancement documentation refactor chore security"
# SWEEP_MAX caps dispatches (cost); SWEEP_PAGES caps the API calls. The sweep
# reads up to SWEEP_PAGES pages, sorts by activity, then stops dispatching after
# SWEEP_MAX so the freshest issues go first and the rest wait for the next run.
SWEEP_MAX="${SWEEP_MAX:-15}"
# MAX_INFLIGHT caps triage runs that may be RUNNING/PENDING at once. A sweep that
# finds the cap reached defers the remaining candidates to the next run instead
# of starting runs the sandbox pool cannot host (#841). The runs are not lost.
MAX_INFLIGHT="${MAX_INFLIGHT:-3}"
# The run field of a sweep checkpoint whose dispatch was deferred (the pool was
# full). It is not a run id and not the empty (finished) form, so the next sweep
# dispatches it when capacity frees instead of reading it as a finished
# checkpoint.
PENDING_RUN="pending"
# Pages of 100 read per sweep, requested one at a time so the cap actually bounds
# the API calls (`gh api --paginate` would read every page). An issue past this
# window is not lost — the next sweep's `sort` by activity moves it in front once
# it is touched.
SWEEP_PAGES="${SWEEP_PAGES:-5}"
# `--recover-ready` enumerates every open `ready` issue and checks each for a
# legacy marker. This bound is only a runaway guard (5 000 issues); the loop
# stops at the first short page, so the enumeration is exact in practice. It is
# deliberately separate from SWEEP_PAGES, which caps the sweep's activity window
# and is far too small to enumerate a label set (#1031 review).
READY_PAGES="${READY_PAGES:-50}"
# The labeler applies type, priority and status in one burst; a checkpoint younger
# than this collapses the burst to one dispatch. A later change to a type or
# priority the issue held before still dispatches once the window has passed.
BURST_WINDOW="${BURST_WINDOW:-300}"
# How many times a triage run that died in infrastructure (FAILED/CANCELLED/
# SKIPPED, or gone from the run listing) is retried for the *same* activity
# before the sweep gives up and leaves the checkpoint final. The retry is
# deterministic — the checkpoint key is `triage-sweep-<n>`, so the same issue is
# re-dispatched — but an unbounded retry against an issue that always kills the
# run burns a sandbox slot every sweep forever (#877). The count lives in its own
# KV key so the sweep checkpoint keeps its shape; it is cleared when a run
# COMPLETED (the episode is over) and when the cap is hit.
ATTEMPT_MAX="${ATTEMPT_MAX:-3}"
# Checkpoints live in the automation KV store, never in issue comments. A marker
# comment renders as an empty comment (it is only HTML), so creating one notifies
# every subscriber of the issue and leaves an unreadable husk behind: the sweep's
# `pending` writes alone posted ~35 empty comments in a single run (2026-11-11).
# The KV store has optimistic
# locking, a `nx` create, a list, and a delete, and it notifies no one.
#   `<SWEEP_KEY><n>` -> {"signal": "<hash>", "run": "<run-id>" | "pending" | ""}
#   `<STATE_KEY><n>` -> {"state": "<type+priority>", "at": <epoch seconds>}
# `run` empty is the finished checkpoint; `pending` is a dispatch deferred while
# the pool was full; anything else is the run that is answering the signal.
SWEEP_KEY="triage-sweep-"
STATE_KEY="triage-state-"
# The attempt counter for an issue whose triage runs keep dying in
# infrastructure: `{"signal": "<hash>", "count": <n>}`. Scoped to the activity
# signal, so a new comment or an edited description (a fresh signal) starts a
# fresh episode at 0. Its own key (not `triage-retry-`, which a deferral marker
# uses) so the two never share a value shape.
ATTEMPT_KEY="triage-attempt-"
# The marker prefix the bridge used before it moved to the KV store. It is read
# once, to adopt an existing checkpoint, and then deleted; nothing writes it any
# more. `--purge-markers` clears the ones on issues the sweep no longer visits
# (closed, or `ready` and finalised).
MARK_PREFIX="<!-- triage-bridge-sweep:"
# The state marker the bridge used before it moved to the KV store, same
# one-shot read as the sweep marker: consulted for the burst window and then
# deleted, so a label burst that began before the migration still collapses.
STATE_PREFIX="<!-- triage-bridge:"

# Dispatch the triage owner for one issue. The body is built with jq so an issue
# number or a key can never break out of its JSON string. On a 2xx answer the run
# id is captured in RUN_ID (the checkpoint records it so the next sweep can read
# the run's outcome); returns non-zero on a non-2xx answer so the caller can
# withhold the checkpoint and retry later.
RUN_ID=""
dispatch() { # dispatch <number> <reason> <key>
  n="$1"; reason="$2"; key="$3"
  RUN_ID=""
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
  resp=$(cat /tmp/triage-bridge.out 2>/dev/null || true); echo "$resp"
  # A dispatch that is not accepted must be visible and retryable: a silent
  # triage is the failure this bridge exists to prevent. A 2xx that names no run
  # is not accepted either — the checkpoint would name an empty run and the
  # sweep could never read whether it finished, so it is treated as failed and
  # retried (the triage owner is idempotent, so a duplicate dispatch is not a
  # duplicate comment).
  case "$code" in
    2??)
      RUN_ID=$(printf '%s' "$resp" | jq -r '.id // empty' 2>/dev/null || true)
      if [ -z "$RUN_ID" ]; then
        echo "::error::Dispatch for #$n was accepted (HTTP $code) but named no run; treating it as failed so the checkpoint is not finalised blind."
        return 1
      fi
      echo "Dispatched the triage owner for #$n ($reason, HTTP $code, run $RUN_ID)."
      ;;
    *) echo "::error::Dispatching the triage owner for #$n failed (HTTP $code)."; return 1 ;;
  esac
}

# --- Checkpoints, in the automation KV store -------------------------------
#
# Nothing below posts a comment. The old design wrote every checkpoint as an
# HTML marker comment, and an HTML-only comment renders as *empty*: each write
# notified the issue's subscribers and left behind a husk that reads as a blank
# comment (2026-11-11: 153 of them — 81 sweep markers, 72 state markers). The KV
# store holds the same data with no notification, no issue update time, and no
# husk. The KV store is the right place for a checkpoint.

# Read a KV value into KV_JSON (the stored object). Returns 0 when the key
# exists, 1 when it does not, 2 when the store could not be read — so a hiccup is
# never mistaken for "no checkpoint".
KV_JSON=""
kv_get() { # kv_get <key>
  KV_JSON=""
  tmp=$(mktemp)
  code=$("$CURL" -sS -o "$tmp" -w '%{http_code}' \
    "$API/kv/$1?meta=true&automation_id=$TRIAGE_ID" \
    -H "Authorization: Bearer ${OPENHANDS_API_KEY:-}" 2>/dev/null) \
    || { rm -f "$tmp"; return 2; }
  case "$code" in
    404) rm -f "$tmp"; return 1 ;;
    2??) : ;;
    *) rm -f "$tmp"; return 2 ;;
  esac
  KV_JSON=$(jq -c '.value // {}' "$tmp" 2>/dev/null) || { rm -f "$tmp"; return 2; }
  rm -f "$tmp"
  return 0
}

# Upsert a KV value. A plain PUT creates (201) or replaces (200); no comment is
# written, so rewriting the same checkpoint is free and needs no dedup guard.
kv_put() { # kv_put <key> <json-object>
  "$CURL" -fsS -o /dev/null -X PUT "$API/kv/$1?automation_id=$TRIAGE_ID" \
    -H "Authorization: Bearer ${OPENHANDS_API_KEY:-}" \
    -H "Content-Type: application/json" -d "$2" 2>/dev/null
}

kv_del() { # kv_del <key>
  "$CURL" -fsS -o /dev/null -X DELETE "$API/kv/$1?automation_id=$TRIAGE_ID" \
    -H "Authorization: Bearer ${OPENHANDS_API_KEY:-}" 2>/dev/null || true
}

# The issue's current type+priority state, or "" when the read fails. Keyed on
# the labels so a label burst collapses to one dispatch while a real change
# re-dispatches.
issue_state() { # issue_state <number>
  gh api "repos/$REPO/issues/$1" \
    --jq '[.labels[].name | select(test("^(bug|enhancement|documentation|refactor|chore|security)$") or startswith("priority:"))] | sort | join("+")' \
    2>/dev/null || echo ""
}

# A legacy marker comment's id and body, or "" when there is none. Only used to
# adopt the pre-KV checkpoints once (see `adopt_legacy_sweep_marker`).
legacy_marker() { # legacy_marker <number> <prefix>; sets LEGACY_ID, LEGACY_BODY
  LEGACY_ID=""; LEGACY_BODY=""
  # `--paginate` runs the filter on every page, so a page without the marker must
  # emit *nothing* (`last // empty`, not a bare `last`, which emits `null`); the
  # marker can sit past the first page, so the last line of the whole listing is
  # the one to keep (#1031 review).
  row=$(gh api --paginate "repos/$REPO/issues/$1/comments?per_page=100" \
    --jq "[.[] | select(.body | startswith(\"$2$1:\")) | [(.id|tostring), .body] | @tsv] | last // empty" \
    2>/dev/null | tail -n1 || true)
  [ -n "$row" ] || return 1
  LEGACY_ID=${row%%	*}
  LEGACY_BODY=${row#*	}
  case "$LEGACY_ID" in '' | *[!0-9]*) return 1 ;; esac
  return 0
}

# The pre-KV state marker's newest `<!-- triage-bridge:<n>:<state> -->` comment:
# its id, state and `updated_at`. Read once for the burst window, so a label burst
# that started before the KV migration still collapses to one dispatch.
LEGACY_ID=""; LEGACY_STATE=""; LEGACY_AT=0
legacy_state_marker() { # legacy_state_marker <number>
  LEGACY_ID=""; LEGACY_STATE=""; LEGACY_AT=0
  row=$(gh api --paginate "repos/$REPO/issues/$1/comments?per_page=100" \
    --jq "[.[] | select(.body | startswith(\"$STATE_PREFIX$1:\")) | [(.id|tostring), (.body | ltrimstr(\"$STATE_PREFIX$1:\") | rtrimstr(\" -->\")), .updated_at] | @tsv] | last // empty" \
    2>/dev/null | tail -n1 || true)
  [ -n "$row" ] || return 0
  LEGACY_ID=${row%%	*}
  rest=${row#*	}
  LEGACY_STATE=${rest%%	*}
  at=${rest#*	}
  case "$LEGACY_ID" in '' | *[!0-9]*) LEGACY_ID=""; LEGACY_STATE=""; return 0 ;; esac
  LEGACY_AT=$(date -u -d "$at" +%s 2>/dev/null || echo 0)
  case "$LEGACY_AT" in '' | *[!0-9]*) LEGACY_AT=0 ;; esac
  return 0
}

# Adopt the pre-KV state marker into the store, then delete the comment, so a
# burst that began before the migration collapses. Best effort: the state marker
# only dedups a burst, so a failed write is not worth failing the run over.
adopt_legacy_state_marker() { # adopt_legacy_state_marker <number>
  legacy_state_marker "$1"
  [ -n "$LEGACY_STATE" ] || return 0
  kv_put "$STATE_KEY$1" \
    "$(jq -nc --arg s "$LEGACY_STATE" --argjson at "${LEGACY_AT:-0}" '{state: $s, at: $at}')" \
    || { echo "::warning::could not adopt the legacy triage state marker on #$1."; return 0; }
  gh api "repos/$REPO/issues/comments/$LEGACY_ID" -X DELETE >/dev/null 2>&1 \
    || echo "::warning::could not remove the legacy triage state marker on #$1."
}

# The sweep checkpoint. Sets SIGNAL, MARK_RUN (the run answering the signal, or
# "" for a finished checkpoint, or `pending` for a deferred dispatch) and
# MARK_FORM (`none`/`some`/`unknown`).
SIGNAL=""
MARK_RUN=""
MARK_FORM="none"
read_sweep_marker() { # read_sweep_marker <number>
  SIGNAL=""; MARK_RUN=""; MARK_FORM="none"
  # `|| rc=$?` (not `; rc=$?`): a 404 is a normal answer, and under `set -e` a
  # bare failing command aborts the script — the direct callers in
  # `recover_ready`/`purge_markers` are not inside an `if`, so the absent-key
  # path must not be an unhandled failure (#1031 review).
  rc=0
  kv_get "$SWEEP_KEY$1" || rc=$?
  case "$rc" in
    2) MARK_FORM="unknown"; return 0 ;;
    1) adopt_legacy_sweep_marker "$1"; return 0 ;;
  esac
  SIGNAL=$(printf '%s' "$KV_JSON" | jq -r '.signal // ""' 2>/dev/null) || SIGNAL=""
  MARK_RUN=$(printf '%s' "$KV_JSON" | jq -r '.run // ""' 2>/dev/null) || MARK_RUN=""
  [ -n "$SIGNAL" ] || { SIGNAL=""; MARK_RUN=""; MARK_FORM="none"; return 0; }
  MARK_FORM="some"
}

# Adopt a legacy marker comment into the KV store, once, then delete it. Reached
# only when the KV key is absent, so an issue that was mid-episode when the store
# moved keeps its checkpoint instead of being re-dispatched (a finished
# checkpoint would otherwise read as "never triaged"). The pre-#836 form (no run
# field) maps to `pending`: its outcome was never recorded, so it re-dispatches
# once, exactly as before. The checkpoint is written before the comment is
# deleted, so a crash between the two re-adopts the same comment next run rather
# than losing it.
adopt_legacy_sweep_marker() { # adopt_legacy_sweep_marker <number>
  legacy_marker "$1" "$MARK_PREFIX" || return 0
  inner=${LEGACY_BODY#"$MARK_PREFIX$1:"}
  inner=${inner%% -->*}
  SIGNAL=${inner%%:*}
  case "$inner" in
    *:*) MARK_RUN=${inner#*:} ;;
    *) MARK_RUN="$PENDING_RUN" ;;
  esac
  [ -n "$SIGNAL" ] || { SIGNAL=""; MARK_RUN=""; MARK_FORM="none"; return 0; }
  # Write the checkpoint first and delete the marker only once it is stored. A
  # failed write must NOT delete the marker: the marker is then the only copy of
  # the run being waited on, so dropping it would lose the in-flight run and
  # re-dispatch the issue. `unknown` leaves the checkpoint alone this sweep and
  # re-adopts the marker next sweep (#1031 review).
  if kv_put "$SWEEP_KEY$1" \
       "$(jq -nc --arg s "$SIGNAL" --arg r "$MARK_RUN" '{signal: $s, run: $r}')"; then
    MARK_FORM="some"
    gh api "repos/$REPO/issues/comments/$LEGACY_ID" -X DELETE >/dev/null 2>&1 \
      || echo "::warning::could not remove the legacy triage marker on #$1."
  else
    echo "::warning::could not adopt the legacy triage marker on #$1; keeping it for the next sweep."
    MARK_FORM="unknown"
  fi
}

# The status of a run, read from the run listing. The listing endpoint **ignores
# a `run_id=` query** (it always returns the newest page), so the run is found by
# filtering the pages by `.id` (#836). It is paged with `limit`/`offset` — the one
# parameter the endpoint honours — until the id is found or the pages run out; a
# first-page-only read would miss a run pushed past 100 newer ones and re-dispatch
# it every sweep, never finalising its checkpoint (#837 R220). Echoes the status,
# `""` when the id is absent from the whole listing (the run is gone; retry is
# safe because triage is idempotent), or `UNKNOWN` when a page could not be read,
# so an incomplete read does not masquerade as a finished run.
run_status() { # run_status <run-id>
  [ -n "$1" ] || return 0
  id="$1"; offset=0; limit=100
  while :; do
    page=$("$CURL" -s "$API_RUNS?limit=$limit&offset=$offset" \
      -H "Authorization: Bearer ${OPENHANDS_API_KEY:-}" 2>/dev/null) || page=""
    # A page whose `runs` is not an array (missing, null, an object) is
    # unreadable, not "the run is absent": an incomplete read must not finalise a
    # run or re-dispatch on a hiccup. `has("runs")` alone lets `{"runs":null}`
    # through — `.runs[]` then fails and `length` reads 0, which looks like the
    # run is gone and would re-dispatch a run that may still be in flight.
    printf '%s' "$page" | jq -e 'type == "object" and (.runs | type == "array")' >/dev/null 2>&1 \
      || { printf 'UNKNOWN'; return 0; }
    st=$(printf '%s' "$page" \
      | jq -r --arg id "$id" '[.runs[] | select(.id == $id) | .status][0] // ""' 2>/dev/null) || st=""
    if [ -n "$st" ]; then printf '%s' "$st"; return 0; fi
    n=$(printf '%s' "$page" | jq -r '.runs | length' 2>/dev/null) || n=0
    case "$n" in '' | *[!0-9]*) n=0 ;; esac
    [ "$n" -ge "$limit" ] || { printf ''; return 0; }
    offset=$((offset + limit))
  done
}

# How many triage runs are RUNNING/PENDING right now, so the sweep can defer the
# rest instead of starting more than the sandbox pool can host. Returns 0 on a
# read failure, which makes the cap permissive rather than stalling every sweep
# (a wrong "defer everything" would starve triage; a wrong "dispatch" is what the
# per-run retry above already recovers from).
inflight_count() {
  n=$("$CURL" -s "$API_RUNS?limit=100" \
    -H "Authorization: Bearer ${OPENHANDS_API_KEY:-}" 2>/dev/null \
    | jq '[.runs[] | select(.status == "RUNNING" or .status == "PENDING")] | length' 2>/dev/null || echo 0)
  case "$n" in ''|*[!0-9]*) echo 0 ;; *) echo "$n" ;; esac
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

# Write the sweep checkpoint. `run` is the run answering the signal: it is
# written while the run is in flight (so the next sweep can read its outcome) and
# cleared once the run COMPLETED (a finished checkpoint). An empty `run` is the
# finished form. A plain KV upsert, so re-writing the same value is free — no
# dedup guard is needed now that nothing is posted.
write_sweep_marker() { # write_sweep_marker <number> <signal> <run>
  kv_put "$SWEEP_KEY$1" \
    "$(jq -nc --arg s "$2" --arg r "${3:-}" '{signal: $s, run: $r}')" \
    || echo "::warning::could not record the triage checkpoint on #$1."
}

# Drop the checkpoint: the issue is closed or `ready`, so it is out of scope and
# a stale checkpoint must not linger to mislead a later sweep.
remove_sweep_marker() { # remove_sweep_marker <number>
  kv_del "$SWEEP_KEY$1"
  clear_attempt "$1"
}

# The attempt counter for one issue, scoped to the activity signal: a new signal
# (a fresh comment, or an edited description) is a new episode and starts at 0.
# `ATTEMPT_COUNT` carries the value; 0 for a key that is absent, 2 when the store
# could not be read (the caller leaves the checkpoint for the next sweep, the
# same way an unreadable sweep checkpoint is left alone).
ATTEMPT_COUNT=0
read_attempt() { # read_attempt <number> <signal>; 0 ok, 2 unreadable
  ATTEMPT_COUNT=0
  # `|| rc=$?`: an absent key is a normal answer, and under `set -e` a bare
  # failing command would abort the script (same reason as `read_sweep_marker`).
  rc=0
  kv_get "$ATTEMPT_KEY$1" || rc=$?
  case "$rc" in
    0) : ;;
    1) return 0 ;;
    *) return 2 ;;
  esac
  s=$(printf '%s' "$KV_JSON" | jq -r '.signal // ""' 2>/dev/null) || s=""
  c=$(printf '%s' "$KV_JSON" | jq -r '.count // 0' 2>/dev/null) || c=0
  case "$c" in '' | *[!0-9]*) c=0 ;; esac
  [ "$s" = "$2" ] && ATTEMPT_COUNT="$c" || ATTEMPT_COUNT=0
  return 0
}

# Record the attempt count for an issue. Best effort: a failed write only means the
# bound is one attempt looser on the next sweep, not a lost dispatch.
set_attempt() { # set_attempt <number> <signal> <count>
  kv_put "$ATTEMPT_KEY$1" \
    "$(jq -nc --arg s "$2" --argjson c "$3" '{signal: $s, count: $c}')" \
    || echo "::warning::could not record the triage attempt counter on #$1."
}

# The episode is over (the run completed, or the issue left scope): drop the
# counter so a later activity starts fresh.
clear_attempt() { # clear_attempt <number>
  kv_del "$ATTEMPT_KEY$1"
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

  # The same type+priority state was already dispatched. Collapse only a burst:
  # once BURST_WINDOW has passed, a return to a state the issue held before is a
  # fresh response and dispatches again. The state and when it was recorded live
  # in the KV store, keyed per issue.
  # A state read that fails leaves `state` empty; the write below is guarded so
  # the dispatch still records its sweep checkpoint (under `set -u` an unguarded
  # expansion would abort the script *after* the dispatch, losing the run).
  cur_state=$(issue_state "$number")
  state=""
  prev_state=""; prev_at=0
  if [ -n "$cur_state" ]; then
    state=$(jq -nc --arg s "$cur_state" '{state: $s, at: (now|floor)}')
    if kv_get "$STATE_KEY$number"; then
      prev_state=$(printf '%s' "$KV_JSON" | jq -r '.state // ""' 2>/dev/null) || prev_state=""
      prev_at=$(printf '%s' "$KV_JSON" | jq -r '.at // 0' 2>/dev/null) || prev_at=0
      case "$prev_at" in '' | *[!0-9]*) prev_at=0 ;; esac
    else
      # No state in the store. A burst may have begun before the KV migration, so
      # read the pre-KV state marker before deciding: without this a second label
      # of that burst starts a second run. Adoption is best effort (#1031 review).
      adopt_legacy_state_marker "$number"
      prev_state=$LEGACY_STATE
      prev_at=$LEGACY_AT
    fi
    if [ -n "$prev_state" ] && [ "$prev_state" = "$cur_state" ]; then
      since=$(( $(date -u +%s) - prev_at ))
      if [ "$since" -lt "$BURST_WINDOW" ]; then
        echo "#$number already dispatched for this state ${since}s ago; burst collapsed."
        exit 0
      fi
    fi
  fi
  # Snapshot the activity *before* the dispatch, then record that snapshot as the
  # checkpoint only after the dispatch is accepted. The dispatch answers the
  # activity seen here; an edit landing between the snapshot and the checkpoint
  # write changes the signal, so the next sweep still catches it (taking the
  # signal after the dispatch would fold that edit into the checkpoint and lose
  # it). A failed read must not write a checkpoint (an empty signal would look
  # like a change and re-dispatch every sweep); the label still dispatches, the
  # sweep catches the activity up later.
  sig=$(activity_signal "$number") || sig=""
  # Honour the same in-flight cap the sweep uses (#837 follow-up): many issues
  # labelled at once each run their own labelled job, so without this the label
  # path forms the very burst the sweep cap prevents. The issue is deferred and
  # the sweep picks it up next run — the label is not lost.
  inflight=$(inflight_count)
  if [ "$inflight" -ge "$MAX_INFLIGHT" ]; then
    echo "#$number: deferred, ${inflight} triage run(s) already in flight (MAX_INFLIGHT=$MAX_INFLIGHT); the sweep retries it."
    if [ -n "$sig" ]; then write_sweep_marker "$number" "$sig" "$PENDING_RUN"; fi
    exit 0
  fi
  if dispatch "$number" labeled "$cur_state"; then
    # Record the state that was answered and the run while it is in flight, so
    # the next sweep reads its outcome instead of trusting the 201 (#836).
    [ -n "$state" ] && { kv_put "$STATE_KEY$number" "$state" || true; }
    if [ -n "$sig" ]; then write_sweep_marker "$number" "$sig" "$RUN_ID"; fi
  else
    echo "::warning::#${number}'s label state stays unrecorded; a later label or the sweep retries."
    exit 1
  fi
}

# One candidate issue: decide whether it needs a dispatch. Returns 0 when a
# dispatch was accepted, 2 when a dispatch was attempted and failed, 3 when the
# issue is deferred because the in-flight cap is reached, 1 otherwise.
# `ready_ok` = 1 lets a `ready` issue through: it is the recovery pass for a
# label dispatch deferred while the pool was full (see `recover_ready`).
process_one() { # process_one <number> <inflight> [ready_ok]
  n="$1"; inflight="${2:-0}"; ready_ok="${3:-0}"

  # A closed issue — or a `ready` one on the ordinary pass — is out of scope;
  # drop any stale checkpoint and stop.
  state=$(gh api "repos/$REPO/issues/$n" \
    --jq '[.state, (.labels[].name)] | join(" ")' 2>/dev/null) \
    || { echo "::warning::could not read #$n; skipped this sweep."; return 1; }
  case " $state " in
    *" closed "*)
      remove_sweep_marker "$n"
      return 1
      ;;
    *" ready "*)
      [ "$ready_ok" = "1" ] || { remove_sweep_marker "$n"; return 1; }
      ;;
  esac

  # A read failure is "skip", not "empty activity": an empty input still hashes
  # to a non-empty value, which would look like a change and dispatch an
  # unchanged issue on every sweep.
  sig=$(activity_signal "$n") \
    || { echo "::warning::could not read the activity of #$n; skipped this sweep."; return 1; }
  [ -n "$sig" ] || return 1

  read_sweep_marker "$n"
  prev_sig="$SIGNAL"; prev_run="$MARK_RUN"; prev_form="$MARK_FORM"
  # The attempt count to record once this pass dispatches. 0 for a fresh signal (no
  # retries yet); the failure branch below raises it by one per retry, and the cap
  # stops the episode before it can burn a sandbox slot on every sweep forever.
  attempt_next=0

  # The checkpoint names a run that answered this same activity. Read its outcome
  # instead of trusting the 201: only a COMPLETED run is a finished checkpoint; a
  # RUNNING/PENDING run is left in flight (and counted), and a FAILED/CANCELLED/
  # SKIPPED one is retried below. A run id absent from the whole listing is
  # treated as failed (the run is gone), so it retries; an *unreadable* listing is
  # left alone rather than re-dispatched on a hiccup (run_status returns UNKNOWN).
  #
  # An unreadable KV store (`unknown`) is left alone too: re-dispatching on a
  # hiccup would start a run the checkpoint cannot record, and the next sweep
  # reads the store again.
  if [ "$prev_form" = "unknown" ]; then
    echo "#$n: the checkpoint store could not be read; leaving it for the next sweep."
    return 1
  fi
  if [ "$prev_sig" = "$sig" ] && [ -n "$prev_run" ] && [ "$prev_run" != "$PENDING_RUN" ]; then
    st=$(run_status "$prev_run")
    case "$st" in
      UNKNOWN)
        echo "#$n: the run listing could not be read; leaving the checkpoint for the next sweep."
        return 1
        ;;
      RUNNING | PENDING)
        echo "#$n: run ${prev_run} is ${st}; leaving it in flight."
        return 1
        ;;
      COMPLETED)
        echo "#$n: run ${prev_run} completed; the checkpoint is final."
        write_sweep_marker "$n" "$sig" ""
        clear_attempt "$n"
        return 1
        ;;
      *)
        # The run died in infrastructure. Retry the SAME issue deterministically —
        # the checkpoint key is the issue number — but bound the attempts: an
        # issue whose every run dies (or a persistent platform fault) would
        # otherwise re-dispatch on every sweep and hold a sandbox slot forever
        # (#877). Past the cap the checkpoint is finalised with a warning, so the
        # issue is reported once and then left to a human, not re-run silently.
        if ! read_attempt "$n" "$sig"; then
          echo "#$n: the attempt counter could not be read; leaving the checkpoint for the next sweep."
          return 1
        fi
        if [ "$ATTEMPT_COUNT" -ge "$ATTEMPT_MAX" ]; then
          echo "::warning::#$n: run ${prev_run} did not complete (${st:-unreadable}) and the attempt cap (ATTEMPT_MAX=$ATTEMPT_MAX) is reached; leaving the checkpoint final. A human must look at this issue."
          write_sweep_marker "$n" "$sig" ""
          clear_attempt "$n"
          return 1
        fi
        attempt_next=$((ATTEMPT_COUNT + 1))
        echo "#$n: run ${prev_run} did not complete (${st:-unreadable}); retrying (attempt ${attempt_next}/${ATTEMPT_MAX})."
        ;;
    esac
  elif [ "$prev_sig" = "$sig" ] && [ "$prev_run" = "$PENDING_RUN" ]; then
    : # A deferred dispatch; the capacity check below dispatches or keeps it.
  elif [ "$prev_sig" = "$sig" ]; then
    # Same activity, a finished checkpoint (run completed): already answered. Not
    # a reason to triage.
    return 1
  fi

  # The activity needs a dispatch. Defer while the pool is full so a burst is not
  # formed (#841): the next sweep picks the issue up, so nothing is lost. The
  # checkpoint is a plain KV upsert, so re-writing the same `pending` value is
  # harmless (no comment, no issue update time).
  if [ "$inflight" -ge "$MAX_INFLIGHT" ]; then
    write_sweep_marker "$n" "$sig" "$PENDING_RUN"
    echo "#$n: deferred, ${inflight} triage run(s) already in flight (MAX_INFLIGHT=$MAX_INFLIGHT)."
    return 3
  fi

  # Dispatch; record the run so the next sweep reads its result, not the 201.
  if dispatch "$n" sweep-activity "$sig"; then
    write_sweep_marker "$n" "$sig" "$RUN_ID"
    # Record the attempt count for this episode, so a run that keeps dying is
    # bounded. A fresh signal resets it to 0; a retry stores the raised count.
    set_attempt "$n" "$sig" "$attempt_next"
    return 0
  fi
  echo "::warning::dispatch failed for #$n; the checkpoint is unchanged, so the next sweep retries."
  return 2
}

# --recover-ready: the recovery pass for a `ready` issue whose checkpoint is
# unfinished. The ordinary sweep excludes `ready` issues, so without this pass a
# checkpoint on one is never examined again: a deferred label dispatch (`pending`)
# would sit forever, and a recovered run that later fails would never be retried
# (#837 R348, R474). It discovers candidates from two sources: the KV store's
# sweep keys, and the legacy sweep markers still sitting on `ready` issues (see
# `recover_ready`). Neither is a `ready`-issue search bounded by update time,
# which would forget an old pending checkpoint once newer issues filled the page
# window (#837 R475). Discovery is unbounded; only the number of dispatches per
# pass (`SWEEP_MAX`) and the pool cap (`MAX_INFLIGHT`) bound the work. A finished
# checkpoint is skipped, so a new comment on a `ready` issue is not re-triaged
# (#837 R496); a
# `pending` or run-field checkpoint is handed to `process_one`, which dispatches
# it, finalises a completed run, or retries a failed one.
recover_ready() {
  count=0
  fails=0
  inflight=$(inflight_count)
  cand=$(mktemp)
  # Discovery has two sources, unioned by `sort -u`:
  #   1. `sweep_keys` — the store's own sweep keys (exact, one paginated listing).
  #   2. `legacy_ready_issues` — the legacy sweep markers still on `ready` issues.
  # The ordinary sweep excludes `ready` issues, so a marker there is never adopted
  # by that pass: without source 2 the recovery would find nothing (the store has
  # no key) and `--purge-markers` would then delete the marker, dropping a
  # deferred dispatch.
  #
  # Source 2 is not free: it lists the open `ready` issues (one call per 100) and
  # then checks each number for a marker, which reads that issue's whole comment
  # listing (paginated). So a pass costs O(#ready issues) comment listings, not
  # just the store listing. Only `ready` issues are touched, so it does not scale
  # with every legacy marker in the repository (#1031 review).
  { sweep_keys; legacy_ready_issues; } | sort -u > "$cand"
  while read -r n; do
    [ -n "${n:-}" ] || continue
    [ "$count" -lt "$SWEEP_MAX" ] || { echo "Reached SWEEP_MAX=$SWEEP_MAX; the rest wait for the next run."; break; }
    # The key names the issue, so the candidate is exact: `read_sweep_marker`
    # reads the store directly (no comment to quote the syntax), leaving
    # MARK_FORM at `none` when the key is gone and skipping a finished one.
    read_sweep_marker "$n"
    case "$MARK_FORM" in
      none) continue ;;
    esac
    # A finished checkpoint (`run` empty) is answered; only a `pending` or a run
    # in flight is a recovery candidate.
    [ -n "$MARK_RUN" ] || continue
    # A checkpoint naming a run needs no capacity (it checks an outcome); a
    # pending one is a dispatch, so it waits while the pool is full — but other
    # checkpoints later in the list may still be checked.
    if [ "$MARK_RUN" = "$PENDING_RUN" ] && [ "$inflight" -ge "$MAX_INFLIGHT" ]; then
      continue
    fi
    rc=0
    if process_one "$n" "$inflight" 1; then rc=0; else rc=$?; fi
    case "$rc" in
      0) count=$((count + 1)); inflight=$((inflight + 1)) ;;
      2) fails=$((fails + 1)) ;;
    esac
  done < "$cand"
  rm -f "$cand"
  echo "$count sweep checkpoint(s) finalised or recovered on ready issues."
  if [ "$fails" -ne 0 ]; then
    echo "::error::$fails recovery dispatch(es) failed; the next run retries them."
    return 1
  fi
}

# The issue number of every sweep checkpoint in the KV store, one per line. The
# key is `triage-sweep-<n>`, so the number is exact — no comment can quote the
# syntax and name an unrelated issue (#837 R512). The listing is paged by
# `limit`/`offset`; `total` from the first page bounds the loop.
sweep_keys() {
  offset=0; limit=100; total=1
  while [ "$offset" -lt "$total" ]; do
    page=$("$CURL" -sS "$API/kv?prefix=$SWEEP_KEY&limit=$limit&offset=$offset&automation_id=$TRIAGE_ID" \
      -H "Authorization: Bearer ${OPENHANDS_API_KEY:-}" 2>/dev/null) || return 0
    total=$(printf '%s' "$page" | jq -r '.total // 0' 2>/dev/null) || total=0
    case "$total" in '' | *[!0-9]*) total=0 ;; esac
    printf '%s' "$page" | jq -r --arg p "$SWEEP_KEY" \
      '.keys[]? | select(startswith($p)) | ltrimstr($p) | select(test("^[0-9]+$"))' 2>/dev/null || true
    n=$(printf '%s' "$page" | jq -r '.count // 0' 2>/dev/null) || n=0
    case "$n" in '' | *[!0-9]*) n=0 ;; esac
    [ "$n" -gt 0 ] || break
    offset=$((offset + limit))
  done
}

# The number of every open issue labelled `ready` that still carries a legacy
# sweep marker comment. The ordinary sweep excludes `ready` issues, so a marker
# there would never be adopted; `--recover-ready` needs the numbers to do it.
#
# The open `ready` issues are enumerated first and each is checked for a marker,
# rather than scanning the repository's comment history. A comment scan is
# bounded by pages, and a marker can sit arbitrarily far back in that history —
# past the page cap on a busy repository — which would silently drop a deferred
# dispatch. The `ready` set is small (issues leave it once implemented), and the
# check is exact however old the marker is (#1031 review).
legacy_ready_issues() {
  lp=1
  while [ "$lp" -le "$READY_PAGES" ]; do
    # `labels=ready` narrows the list; pull requests share the endpoint, so they
    # are filtered out (a status label never sits on a PR — docs/LABELS.md).
    nums=$(gh api "repos/$REPO/issues?state=open&labels=ready&per_page=100&page=$lp" \
      --jq '.[] | select(.pull_request == null) | .number' 2>/dev/null) || nums=""
    [ -n "$nums" ] || break
    # `if`, not `legacy_marker ... && printf`: a number with no marker leaves an
    # AND-OR list returning non-zero, which is the last command of the pipeline —
    # under `set -e` that aborts the whole run before the next page (#1031 review).
    printf '%s\n' "$nums" | while IFS= read -r num; do
      [ -n "$num" ] || continue
      if legacy_marker "$num" "$MARK_PREFIX"; then printf '%s\n' "$num"; fi
    done
    got=$(printf '%s\n' "$nums" | grep -c . || true)
    case "$got" in '' | *[!0-9]*) got=0 ;; esac
    [ "$got" -ge 100 ] || break
    lp=$((lp + 1))
  done
}

# --purge-markers: delete the legacy marker comments the pre-KV bridge left on
# issues the sweep no longer visits (closed, or `ready` with a finished
# checkpoint). A one-shot cleanup; the bridge never writes a comment again.
# The marker prefixes are matched in the body, and the comment is deleted by id.
purge_markers() {
  removed=0
  tmp=$(mktemp)
  for page in 1 2 3 4 5 6 7 8 9 10; do
    page_json=$(gh api "repos/$REPO/issues/comments?per_page=100&page=$page" 2>/dev/null) || page_json='[]'
    # The row carries the comment id and its kind. The kind is what the `ready`
    # branch needs: a sweep marker is adopted before deletion, a state marker is
    # deleted directly, and without it a status-only issue was counted as cleaned
    # while its comment stayed (#1031 review).
    rows=$(printf '%s' "$page_json" | jq -r --arg mp "$MARK_PREFIX" \
      '.[] | select(.body | test("^<!-- triage-bridge(-sweep)?:"))
       | [(.id|tostring), (.issue_url | split("/") | last),
          (if (.body | startswith($mp)) then "sweep" else "state" end)] | @tsv' \
      2>/dev/null || true)
    [ -n "$rows" ] && printf '%s\n' "$rows" >> "$tmp"
    # The page length, not the marker count, decides whether to page on.
    total=$(printf '%s' "$page_json" | jq -r 'length' 2>/dev/null || echo 0)
    case "$total" in '' | *[!0-9]*) total=0 ;; esac
    [ "$total" -ge 100 ] || break
  done
  while IFS="$(printf '\t')" read -r cid num kind; do
    [ -n "${cid:-}" ] || continue
    st=$(gh api "repos/$REPO/issues/$num" --jq '[.state, (.labels[].name)] | join(" ")' 2>/dev/null || echo "")
    case " $st " in
      *" closed "*)
        # A closed issue is out of scope; its checkpoint is gone either way, so
        # the marker is safe to delete.
        ;;
      *" ready "*)
        # The kind decides: only a sweep marker holds a checkpoint. A state
        # marker only dedups a label burst and is adopted by the next label
        # event, so on a `ready` issue (which no sweep visits) it is a stale
        # leftover and its own row is safe to delete (#1031 review).
        case "$kind" in
          sweep)
            # Adopt before deleting: the marker may hold the only copy of a
            # deferred dispatch, and the sweep skips `ready` issues (only
            # `--recover-ready` adopts them). A purge that ran before either pass
            # would otherwise drop the checkpoint. A failed read keeps the marker
            # (#1031 review).
            read_sweep_marker "$num"
            if [ "$MARK_FORM" = "unknown" ]; then
              echo "::warning::keeping the legacy marker on #$num; the checkpoint store could not be read."
              continue
            fi
            # Adoption deletes the marker it adopts, so the id listed above may
            # already be gone; re-read the newest remaining marker and delete
            # that. With none left the checkpoint is adopted and there is
            # nothing left to delete (#1031 review).
            if ! legacy_marker "$num" "$MARK_PREFIX"; then
              removed=$((removed + 1))
              continue
            fi
            cid=$LEGACY_ID
            ;;
        esac
        ;;
      *) continue ;;
    esac
    gh api "repos/$REPO/issues/comments/$cid" -X DELETE >/dev/null 2>&1 \
      && removed=$((removed + 1)) \
      || echo "::warning::could not delete legacy marker comment $cid on #$num."
  done < "$tmp"
  rm -f "$tmp"
  echo "$removed legacy marker comment(s) removed."
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

  # The pool cap: how many triage runs are already RUNNING/PENDING. Each dispatch
  # in this sweep adds one, so the count is tracked locally as well — the API is
  # read once, not once per candidate. A sweep that reaches the cap defers the
  # rest to the next run instead of forming a burst the sandbox pool cannot host.
  inflight=$(inflight_count)
  deferred=0

  while read -r _ts n; do
    [ -n "${n:-}" ] || continue
    [ "$count" -lt "$SWEEP_MAX" ] || { echo "Reached SWEEP_MAX=$SWEEP_MAX; the rest wait for the next run."; break; }
    # `process_one` returns 1 for "nothing to do" — a normal outcome. It is called
    # in an `if` so `set -e` does not abort the sweep on that status (a bare call
    # would stop at the first already-handled issue and fail the run).
    rc=0
    if process_one "$n" "$inflight"; then rc=0; else rc=$?; fi
    case "$rc" in
      0) count=$((count + 1)); inflight=$((inflight + 1)) ;;
      2) fails=$((fails + 1)) ;;
      3) deferred=$((deferred + 1)) ;;
    esac
  done < "$cand"
  rm -f "$cand"

  if [ "$deferred" -ne 0 ]; then
    echo "$deferred issue(s) deferred: $inflight triage run(s) in flight (MAX_INFLIGHT=$MAX_INFLIGHT); the next sweep retries them."
  fi
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
  --recover-ready) recover_ready ;;
  --purge-markers) purge_markers ;;
  *) echo "usage: issue-triage-bridge.sh --stdin | --sweep | --recover-ready | --purge-markers" >&2; exit 2 ;;
esac
