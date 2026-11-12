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
#   --relabel <n>
#             `label-guard` removed a protected label a person applied and
#             applied nothing in its place, leaving the issue with no type or no
#             priority (#838); the triage owner relabels it. `label-guard.yml`
#             calls this in the same run, because the guard's removal is made
#             with the automatic `GITHUB_TOKEN` and GitHub starts no workflow for
#             an event that token creates — a trigger on `unlabeled` would never
#             fire.
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
# Checkpoints live in the automation KV store, never in issue comments. A marker
# comment renders as an empty comment (it is only HTML), so creating one notifies
# every subscriber of the issue and leaves an unreadable husk behind: the sweep's
# `pending` writes alone posted ~35 empty comments in a single run (2026-11-11).
# The KV store has optimistic
# locking, a `nx` create, a list, and a delete, and it notifies no one.
#   `<SWEEP_KEY><n>` -> {"signal": "<hash>", "run": "<run-id>" | "pending" | "",
#                        "extra": {"<kind>": "<run-id>" | "pending"}}
#                       `at` (epoch seconds) is set only while `run` is
#                       `pending`: the FIRST deferral time, which the sweep
#                       orders deferred issues by (K25, #872).
#   `<STATE_KEY><n>` -> {"state": "<type+priority>", "at": <epoch seconds>}
# `run` empty is the finished checkpoint; `pending` is a dispatch deferred while
# the pool was full; anything else is the run that is answering the signal.
# `extra` holds a side response's run under its own kind (`relabel` for a
# `--relabel` dispatch, `conflict` for `--type-conflict`): a label change does not
# move `activity_signal`, so two responses on one issue would otherwise overwrite
# each other's run id in the single `run` field and the sweep would finalise the
# issue while one run is still unread (#838 follow-up).
SWEEP_KEY="triage-sweep-"
# A deferral the label path could not fold into the sweep checkpoint because the
# store could not be read: `{signal, at}` under its own key, so the old
# checkpoint (and its first-deferral time) is left untouched and the deferral
# itself is not lost. Both passes drain it — see `drain_retry_markers`.
RETRY_KEY="triage-retry-"
STATE_KEY="triage-state-"
# The collapse key of the relabel path (`label-guard` revocation, #838). A
# separate key from STATE_KEY: the labeled path keys on the type+priority the
# labeler set, this one on a burst of revocations for one issue, and the two must
# not collapse each other.
UNLABELED_KEY="triage-unlabeled-"
# The collapse key of the type-conflict path (`label-guard` declined a type
# restore, #838 follow-up). A separate key from UNLABELED_KEY: a revocation can
# dispatch `--relabel` (a missing priority) and a type change can follow within
# the burst window — different responses — so sharing the key would let the
# relabel's burst collapse the conflict and the wrong type would survive.
CONFLICT_KEY="triage-conflict-"
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

# The type+priority the issue is left holding, as a `+`-joined sorted set (or
# `none`). `label-guard` removes one label per event and applies nothing in its
# place, so this is the set the revocation left behind (#838): the bridge acts
# only when it has no type or no priority left. Returns non-zero when the read
# fails, so the caller skips rather than mistaking a hiccup for "no labels".
remaining_labels() { # remaining_labels <number>; prints the set, or 'none'
  out=$(gh api "repos/$REPO/issues/$1/labels" \
    --jq '[.[].name | select(test("^(bug|enhancement|documentation|refactor|chore|security)$") or startswith("priority:"))] | sort | join("+")' \
    2>/dev/null) || return 1
  [ -n "$out" ] || out="none"
  printf '%s' "$out"
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
# "" for a finished checkpoint, or `pending` for a deferred dispatch), MARK_EXTRA
# (the per-kind side runs, a compact JSON object), MARK_AT (the epoch second of a
# `pending` checkpoint's first deferral, or ""), MARK_FORM
# (`none`/`some`/`unknown`), MARK_ACTIVE (1 when any slot is unfinished) and
# MARK_PENDING (1 when any slot is `pending`).
SIGNAL=""
MARK_RUN=""
MARK_EXTRA="{}"
MARK_AT=""
MARK_FORM="none"
MARK_ACTIVE=0
MARK_PENDING=0
read_sweep_marker() { # read_sweep_marker <number>
  SIGNAL=""; MARK_RUN=""; MARK_EXTRA="{}"; MARK_AT=""; MARK_FORM="none"; MARK_ACTIVE=0; MARK_PENDING=0
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
  MARK_EXTRA=$(printf '%s' "$KV_JSON" | jq -c '.extra // {}' 2>/dev/null) || MARK_EXTRA="{}"
  MARK_AT=$(printf '%s' "$KV_JSON" | jq -r '.at // ""' 2>/dev/null) || MARK_AT=""
  case "$MARK_AT" in '' | *[!0-9]*) MARK_AT="" ;; esac
  [ -n "$SIGNAL" ] || { SIGNAL=""; MARK_RUN=""; MARK_EXTRA="{}"; MARK_AT=""; MARK_FORM="none"; return 0; }
  MARK_FORM="some"
  # The checkpoint is unfinished while any slot (the main `run` or a side
  # response) is a `pending` or a run id; it is finished only when every slot is
  # empty. A `ready` issue is recovered only when `MARK_ACTIVE` is 1.
  if [ -n "$MARK_RUN" ]; then MARK_ACTIVE=1; fi
  if [ "$MARK_RUN" = "$PENDING_RUN" ]; then MARK_PENDING=1; fi
  for v in $(checkpoint_slot_values "$MARK_EXTRA"); do
    [ -n "$v" ] || continue
    MARK_ACTIVE=1
    if [ "$v" = "$PENDING_RUN" ]; then MARK_PENDING=1; fi
  done
}

# Every value in a checkpoint's `extra` object, one per line (its kind keys are
# dropped: the sweep only needs the run ids and the `pending` markers).
checkpoint_slot_values() { # checkpoint_slot_values <extra-json>
  printf '%s' "${1:-}" | jq -r '(. // {}) | to_entries[]? | .value' 2>/dev/null || true
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
    # The adopted run is the main slot; expose it to the recovery gate.
    if [ -n "$MARK_RUN" ]; then MARK_ACTIVE=1; fi
    if [ "$MARK_RUN" = "$PENDING_RUN" ]; then MARK_PENDING=1; fi
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
#
# The checkpoint is shared with the side responses (`--relabel`,
# `--type-conflict`) and with `at` (the first-deferral time). This writer owns
# `signal`, `run` and `at`, so on a same-signal write it carries the fields it
# does not own forward when `SWEEP_MARKER_PRESERVE_SLOTS` is 1: a main write —
# the label path, or a deferral — must not erase a side slot the sweep still has
# to read, or a failed conflict is never retried (#838 follow-up; the reviewer's
# "checkpoint konflik tertimpa run pelabelan"). A different signal is a new
# episode, and a finished checkpoint (`run` empty) drops the slots with it.
#
# `SWEEP_MARKER_PRESERVE_SLOTS` is 1 by default. `process_one` sets it to 0 for
# the one write that *supersedes* the other slots: its re-dispatch of the triage
# owner, which answers the failed/pending responses itself. Carrying those slots
# into that write would make every later sweep re-read the same failed run and
# re-dispatch forever.
#
# `at` is the epoch second of the FIRST deferral, recorded only while `run` is
# `pending`: the sweep orders deferred issues by it (FIFO by first deferral, K25
# #872), so a candidate deferred while the pool is full cannot sink behind newer
# activity forever. The caller passes the existing `at` to keep it across
# re-deferrals; it defaults to `now` on the first.
SWEEP_MARKER_PRESERVE_SLOTS=1
MARK_WRITE_OK=0
write_sweep_marker() { # write_sweep_marker <number> <signal> <run> [first-deferred-at]
  n="$1"; sig="$2"; run="${3:-}"; at="${4:-}"
  if [ "$run" = "$PENDING_RUN" ] && [ -z "$at" ]; then
    at=$(date -u +%s)
  fi
  carry="{}"
  if [ "$SWEEP_MARKER_PRESERVE_SLOTS" = 1 ] && [ -n "$run" ] && kv_get "$SWEEP_KEY$n"; then
    prev_sig=$(printf '%s' "$KV_JSON" | jq -r '.signal // ""' 2>/dev/null) || prev_sig=""
    if [ "$prev_sig" = "$sig" ]; then
      carry=$(printf '%s' "$KV_JSON" | jq -c 'del(.signal, .run, .at)' 2>/dev/null) || carry="{}"
    fi
  fi
  MARK_WRITE_OK=0
  if kv_put "$SWEEP_KEY$n" \
    "$(jq -nc --arg s "$sig" --arg r "$run" --arg a "$at" --argjson c "$carry" \
      '$c + {signal: $s, run: $r} + (if ($r == "pending" and $a != "") then {at: ($a|tonumber)} else {} end)')"; then
    MARK_WRITE_OK=1
  else
    echo "::warning::could not record the triage checkpoint on #$n."
  fi
}

# Record a side response's run (`--relabel`, `--type-conflict`) under its own
# `extra.<kind>` slot, preserving the main `run` slot, `at` and every other
# field. A label change does not move `activity_signal`, so the side responses of
# one issue share the checkpoint; without per-kind slots the later write would
# overwrite the earlier run id, and `process_one` — reading only the surviving
# one — would finalise the issue while a failed run is never retried (#838
# follow-up). A different signal is a new episode: the slots are dropped.
write_sweep_side_marker() { # write_sweep_side_marker <number> <signal> <kind> <run>
  n="$1"; sig="$2"; kind="$3"; run="${4:-}"
  base="{}"
  if kv_get "$SWEEP_KEY$n"; then
    prev_sig=$(printf '%s' "$KV_JSON" | jq -r '.signal // ""' 2>/dev/null) || prev_sig=""
    if [ "$prev_sig" = "$sig" ]; then
      base=$(printf '%s' "$KV_JSON" | jq -c 'del(.signal)' 2>/dev/null) || base="{}"
    fi
  fi
  kv_put "$SWEEP_KEY$n" \
    "$(jq -nc --argjson b "$base" --arg s "$sig" --arg k "$kind" --arg r "$run" \
      '$b + {signal: $s, run: ($b.run // ""), extra: (($b.extra // {}) + {($k): $r})}')" \
    || echo "::warning::could not record the triage checkpoint on #$n."
}

# Drop the checkpoint: the issue is closed or `ready`, so it is out of scope and
# a stale checkpoint must not linger to mislead a later sweep.
remove_sweep_marker() { # remove_sweep_marker <number>
  kv_del "$SWEEP_KEY$1"
}

# --- Retry markers, for a deferral that could not reach the sweep checkpoint --

# Record a deferral the label path could not fold into the sweep checkpoint,
# because `read_sweep_marker` failed (`MARK_FORM=unknown`). Writing the sweep
# checkpoint then would either stamp a fresh `at` over a long wait (the FIFO
# reset the review caught) or, when there was no pending checkpoint at all, put
# a `pending` marker on an issue the ordinary sweep excludes (`ready`) — where
# `pending_keys` feeds it to `process_one`, which drops a `ready` issue's
# checkpoint, and `recover_ready` (reading the store *after* the sweep) never
# sees it. The deferral is the label's only chance to be triaged, so it is kept
# under its own key, with the `at` the read failed to give us: the current time
# on the first deferral, or the `at` already recorded by an earlier retry.
write_retry_marker() { # write_retry_marker <number> <signal>
  at=""
  if kv_get "$RETRY_KEY$1"; then
    at=$(printf '%s' "$KV_JSON" | jq -r '.at // ""' 2>/dev/null) || at=""
    case "$at" in '' | *[!0-9]*) at="" ;; esac
  fi
  [ -n "$at" ] || at=$(date -u +%s)
  kv_put "$RETRY_KEY$1" \
    "$(jq -nc --arg s "$2" --argjson a "$at" '{signal: $s, at: $a}')" \
    || echo "::warning::could not record the deferred retry for #$1."
}

# Hand every retry marker back to the sweep checkpoint, so the ordinary pass and
# the recovery pass agree on one marker per issue again. Run at the top of both
# passes, before either reads the store: the deferral is turned into the
# `pending` checkpoint the pass then dispatches. A `pending` checkpoint already
# present keeps its `at` (the old wait) unless it is older than the retry's, so
# the FIFO order is preserved either way. A checkpoint that still names a run
# (in flight, or finished but not yet finalised) keeps the retry too: the signal
# it carries excludes labels, so that run cannot prove the label was reviewed. The
# retry key is deleted once folded, and also when the issue is closed, so a stale
# one cannot linger.
drain_retry_markers() {
  for n in $(retry_keys); do
    if [ -z "${n:-}" ]; then continue; fi
    read_sweep_marker "$n"
    read_retry_marker "$n"
    if [ "$RETRY_FORM" != "some" ]; then continue; fi
    # An unreadable store cannot tell us whether a `pending` checkpoint is
    # already there, and folding blind would reset its `at`. Keep the retry
    # marker for the next run instead.
    if [ "$MARK_FORM" = "unknown" ]; then continue; fi
    if [ "$MARK_FORM" = "some" ] && [ -n "$MARK_RUN" ] && [ "$MARK_RUN" != "$PENDING_RUN" ]; then
      # A run is recorded — in flight, or finished but not yet finalised. The
      # checkpoint's signal hashes the body and the comments only, never the
      # labels, so such a run cannot prove this label was reviewed: a run
      # dispatched before the label finalises the issue without it (#872
      # review). Keep the retry; a later pass folds it into a `pending`
      # checkpoint once the run is out of the way (its `run` cleared), and that
      # fold is what re-dispatches the label.
      continue
    fi
    if [ "$MARK_FORM" = "some" ] && [ "$MARK_RUN" = "$PENDING_RUN" ]; then
      at="${MARK_AT:-0}"
      # The earlier of the two waits wins: a retry that began before the
      # checkpoint must not lose its place in the FIFO.
      case "$RETRY_AT" in
        '' | *[!0-9]*) : ;;
        *) if [ "$RETRY_AT" -lt "${at:-0}" ]; then at="$RETRY_AT"; fi ;;
      esac
    else
      at="${RETRY_AT:-0}"
    fi
    # A closed or `ready`-and-final issue is dropped by the pass itself
    # (`process_one`), so the fold is safe whatever the issue's state.
    write_sweep_marker "$n" "$RETRY_SIGNAL" "$PENDING_RUN" "$at"
    if [ "$MARK_WRITE_OK" = 1 ]; then remove_retry_marker "$n"; fi
  done
  return 0
}

read_retry_marker() { # read_retry_marker <number>; sets RETRY_SIGNAL, RETRY_AT, RETRY_FORM
  RETRY_SIGNAL=""; RETRY_AT=""; RETRY_FORM="none"
  rc=0
  kv_get "$RETRY_KEY$1" || rc=$?
  case "$rc" in
    1) return 0 ;;
    2) RETRY_FORM="unknown"; return 0 ;;
  esac
  RETRY_SIGNAL=$(printf '%s' "$KV_JSON" | jq -r '.signal // ""' 2>/dev/null) || RETRY_SIGNAL=""
  RETRY_AT=$(printf '%s' "$KV_JSON" | jq -r '.at // ""' 2>/dev/null) || RETRY_AT=""
  case "$RETRY_AT" in '' | *[!0-9]*) RETRY_AT="" ;; esac
  [ -n "$RETRY_SIGNAL" ] || { RETRY_SIGNAL=""; RETRY_AT=""; RETRY_FORM="none"; return 0; }
  RETRY_FORM="some"
}

remove_retry_marker() { # remove_retry_marker <number>
  kv_del "$RETRY_KEY$1"
}

# The issue number of every retry marker in the KV store, one per line.
retry_keys() {
  offset=0; limit=100; total=1
  while [ "$offset" -lt "$total" ]; do
    page=$("$CURL" -sS "$API/kv?prefix=$RETRY_KEY&limit=$limit&offset=$offset&automation_id=$TRIAGE_ID" \
      -H "Authorization: Bearer ${OPENHANDS_API_KEY:-}" 2>/dev/null) || return 0
    total=$(printf '%s' "$page" | jq -r '.total // 0' 2>/dev/null) || total=0
    case "$total" in '' | *[!0-9]*) total=0 ;; esac
    printf '%s' "$page" | jq -r --arg p "$RETRY_KEY" \
      '.keys[]? | select(startswith($p)) | ltrimstr($p) | select(test("^[0-9]+$"))' 2>/dev/null || true
    n=$(printf '%s' "$page" | jq -r '.count // 0' 2>/dev/null) || n=0
    case "$n" in '' | *[!0-9]*) n=0 ;; esac
    [ "$n" -gt 0 ] || break
    offset=$((offset + limit))
  done
}

# --stdin: a bot applied a type or priority label.
on_label() { # on_label <event-json>
  event="$1"
  # The workflow triggers on `labeled` only; this keeps a future trigger edit
  # from feeding an `unlabeled` event here, where `.label.name` would be read as
  # a freshly applied label.
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
    # Keep an existing first-deferral time so a label that lands while the issue
    # is already queued does not send it to the back of the FIFO (K25, #872). A
    # pending checkpoint with no `at` predates the field and counts as oldest.
    # A failed read (`unknown`) must not stamp a fresh `at`: keep the checkpoint
    # and let the sweep read its old time on a later run (#872 review).
    if [ -n "$sig" ]; then
      read_sweep_marker "$number"
      if [ "$MARK_FORM" = "unknown" ]; then
        # The store could not be read, so whether the issue is `ready` and how
        # long it has waited are both unknown. Writing the sweep checkpoint
        # blind would reset a long wait's `at`, and skipping the write — the
        # previous behaviour — dropped the deferral entirely on a `ready` issue
        # with no pending checkpoint. The retry key keeps the deferral; both
        # passes drain it (see `drain_retry_markers`).
        write_retry_marker "$number" "$sig"
      else
        if [ "$MARK_RUN" = "$PENDING_RUN" ]; then at="${MARK_AT:-0}"; else at=""; fi
        write_sweep_marker "$number" "$sig" "$PENDING_RUN" "$at"
      fi
    fi
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

# --relabel <number>: `label-guard` removed a protected label a person applied
# and applied nothing in its place, leaving the issue with no type or no priority
# (#838) — a worse state than a wrong label, because triage, priority and the PR
# labelling all read the labels.
#
# The guard cannot trigger the bridge through GitHub: it removes the label with
# the automatic `GITHUB_TOKEN`, and GitHub does not start a workflow run for an
# event that token creates (verified on this repository: no run in the last 100
# carries a `github-actions[bot]` actor, though `label-guard`, `basmalah` and
# `issue-label-sync` all write through that token). So `label-guard.yml` calls
# this mode in the *same* run, right after the guard, and the guard stays purely
# deterministic. The collapse key is separate from the labeled path's: the two
# must not collapse each other.
relabel_after_revocation() { # relabel_after_revocation <number>
  number="$1"
  [ -n "$number" ] || { echo "no issue number; nothing to do."; exit 0; }

  # A closed issue needs no relabel: nothing reads its labels any more, and a
  # dispatch would only wake the triage owner on finished work. A read failure is
  # "skip" too (the state is unknown).
  state_now=$(gh api "repos/$REPO/issues/$number" --jq '.state // empty' 2>/dev/null) \
    || { echo "::warning::could not read the state of #$number; skipped the relabel."; exit 1; }
  [ "$state_now" = "open" ] || { echo "#$number is '${state_now:-unknown}'; nothing to do."; exit 0; }

  # What the issue is left holding. A read failure is "skip", not "empty": an
  # empty set would look like a gap and dispatch on a hiccup.
  left=$(remaining_labels "$number") \
    || { echo "::warning::could not read the labels of #$number; skipped the relabel."; exit 1; }
  # Derive the two flags from the `+`-joined set (no subshell: a `while` pipe
  # would set them in a child and lose them). Membership is tested per element:
  # a prefix test (`priority:*`) reads `priority:high+refactor` as "no type" the
  # moment a type sorts *after* the priority label, which is exactly the case the
  # relabel exists to fix — so `priority:high+refactor` and `priority:high+security`
  # were dispatched as if the issue had no type.
  has_type=0; has_priority=0
  case "+$left+" in
    *"+priority:"*) has_priority=1 ;;
  esac
  case "+$left+" in
    *"+bug+"*|*"+enhancement+"*|*"+documentation+"*|*"+refactor+"*|*"+chore+"*|*"+security+"*) has_type=1 ;;
    *) has_type=0 ;;
  esac
  if [ "$has_type" = 1 ] && [ "$has_priority" = 1 ]; then
    echo "#$number still holds a type and a priority after the removal; nothing to do."
    exit 0
  fi

  # Collapse the removal burst: the guard removes one label per event, so a
  # revocation is a burst of events, and `label-guard.yml`'s concurrency group is
  # per label — the runs race and each may observe a different intermediate label
  # set. So the collapse is keyed on the *issue* and the burst window, not on the
  # resulting set: any relabel dispatch for this issue within BURST_WINDOW means
  # the burst is already being answered. A genuine later revocation (a fresh
  # hand-applied label removed after the window) is a new response and dispatches.
  state=$(jq -nc '{at: (now|floor)}')
  if kv_get "$UNLABELED_KEY$number"; then
    prev_at=$(printf '%s' "$KV_JSON" | jq -r '.at // 0' 2>/dev/null) || prev_at=0
    case "$prev_at" in '' | *[!0-9]*) prev_at=0 ;; esac
    since=$(( $(date -u +%s) - prev_at ))
    if [ "$prev_at" -gt 0 ] && [ "$since" -lt "$BURST_WINDOW" ]; then
      echo "#$number already dispatched a relabel ${since}s ago; burst collapsed."
      exit 0
    fi
  fi

  # Snapshot the activity before the dispatch and record it after it is accepted,
  # exactly as the labeled path does: an edit landing in that window changes the
  # signal and the next sweep still catches it.
  sig=$(activity_signal "$number") || sig=""
  inflight=$(inflight_count)
  if [ "$inflight" -ge "$MAX_INFLIGHT" ]; then
    echo "#$number: deferred, ${inflight} triage run(s) already in flight (MAX_INFLIGHT=$MAX_INFLIGHT); the sweep retries it."
    if [ -n "$sig" ]; then write_sweep_side_marker "$number" "$sig" relabel "$PENDING_RUN"; fi
    exit 0
  fi
  if dispatch "$number" relabel-after-revocation "$left"; then
    kv_put "$UNLABELED_KEY$number" "$state" || true
    if [ -n "$sig" ]; then write_sweep_side_marker "$number" "$sig" relabel "$RUN_ID"; fi
  else
    # A failed dispatch must be retried by the sweep, not lost. Record the
    # checkpoint as `pending` (the same form the MAX_INFLIGHT deferral writes)
    # *before* failing: without it the sweep compares the signal with a stale or
    # absent checkpoint and may skip the issue — the signal it holds equals the
    # one it would compute, so it reads as "already answered" and never retries.
    # `pending` names no run, so the next sweep dispatches it. It goes in the
    # relabel slot so it cannot clobber a type-conflict run on the same issue.
    if [ -n "$sig" ]; then write_sweep_side_marker "$number" "$sig" relabel "$PENDING_RUN"; fi
    echo "::warning::#${number}'s relabel dispatch failed; a later removal or the sweep retries."
    exit 1
  fi
}

# --type-conflict <number> <declined-type>: `label-guard` declined to restore a
# type label the bot applied because the issue now carries a *different* type —
# the person is changing the type, not overruling the bot with nothing in place
# (#838 follow-up). Restoring the old type would leave two, which
# `issue-label-sync` refuses; the guard keeps the single surviving type and
# signals `type_conflict=1`, and `label-guard.yml` calls this mode so the triage
# owner — the taxonomy's owner (docs/LABELS.md) — reconciles the conflict and
# revokes the wrong type. Deterministic guards, one LLM decision.
type_conflict_dispatch() { # type_conflict_dispatch <number> <declined-type>
  number="$1"; declined="$2"
  [ -n "$number" ] || { echo "no issue number; nothing to do."; exit 0; }
  [ -n "$declined" ] || { echo "no declined type; nothing to do."; exit 0; }

  # A closed issue needs no reconciliation (nothing reads its labels).
  state_now=$(gh api "repos/$REPO/issues/$number" --jq '.state // empty' 2>/dev/null) \
    || { echo "::warning::could not read the state of #$number; skipped the type-conflict dispatch."; exit 1; }
  [ "$state_now" = "open" ] || { echo "#$number is '${state_now:-unknown}'; nothing to do."; exit 0; }

  # The issue's current type set. A read failure is "skip", never "dispatch".
  left=$(remaining_labels "$number") \
    || { echo "::warning::could not read the labels of #$number; skipped the type-conflict dispatch."; exit 1; }

  # Count the types the issue holds now. The declined label is *not* back (the
  # guard declined), so it is not among them.
  types=""
  for t in $TYPE_LABELS; do
    case "+$left+" in *"+$t+"*) types="$types $t" ;; esac
  done
  n_types=$(printf '%s\n' $types | grep -c . || true)
  case "$n_types" in '' | *[!0-9]*) n_types=0 ;; esac

  if [ "$n_types" -eq 0 ]; then
    # No type at all: that is the `--relabel` path's job (a bare removal), not a
    # type change. Nothing for the triage owner here.
    echo "#$number holds no type; the relabel path owns that gap, not the type conflict."
    exit 0
  fi
  if printf '%s\n' $types | grep -qxF "$declined"; then
    # The declined type is back (a race, or a person re-added it). The conflict is
    # gone; nothing to reconcile.
    echo "#$number holds '$declined' again; the type conflict is gone."
    exit 0
  fi

  # A real conflict: the issue holds one or more types and the declined one is not
  # among them. The triage owner decides which type is right. Collapse the burst
  # the same way the relabel path does — a type change is a burst of events — but
  # on this path's *own* key: a revocation can dispatch `--relabel` within the
  # window and that must not collapse the conflict (different responses).
  state=$(jq -nc '{at: (now|floor)}')
  if kv_get "$CONFLICT_KEY$number"; then
    prev_at=$(printf '%s' "$KV_JSON" | jq -r '.at // 0' 2>/dev/null) || prev_at=0
    case "$prev_at" in '' | *[!0-9]*) prev_at=0 ;; esac
    since=$(( $(date -u +%s) - prev_at ))
    if [ "$prev_at" -gt 0 ] && [ "$since" -lt "$BURST_WINDOW" ]; then
      echo "#$number already dispatched a type-conflict reconciliation ${since}s ago; burst collapsed."
      exit 0
    fi
  fi

  sig=$(activity_signal "$number") || sig=""
  inflight=$(inflight_count)
  if [ "$inflight" -ge "$MAX_INFLIGHT" ]; then
    echo "#$number: deferred, ${inflight} triage run(s) already in flight (MAX_INFLIGHT=$MAX_INFLIGHT); the sweep retries it."
    if [ -n "$sig" ]; then write_sweep_side_marker "$number" "$sig" conflict "$PENDING_RUN"; fi
    exit 0
  fi
  if dispatch "$number" type-conflict "$types"; then
    kv_put "$CONFLICT_KEY$number" "$state" || true
    if [ -n "$sig" ]; then write_sweep_side_marker "$number" "$sig" conflict "$RUN_ID"; fi
  else
    if [ -n "$sig" ]; then write_sweep_side_marker "$number" "$sig" conflict "$PENDING_RUN"; fi
    echo "::warning::#${number}'s type-conflict dispatch failed; the sweep retries."
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
  # Reset the marker's slot policy per issue: only the re-dispatch below turns it
  # off, and a prior issue must not carry that into this one's writes.
  SWEEP_MARKER_PRESERVE_SLOTS=1

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
      [ "$ready_ok" = "1" ] || {
        # A `ready` issue is out of the ordinary sweep's scope, but a *deferred*
        # (`pending`) or in-flight checkpoint must survive: `pending_keys` feeds it
        # here, and `recover_ready` — which runs *after* this sweep and reads the
        # store — is the pass that finishes it. Dropping such a checkpoint here
        # would lose the deferred dispatch for good (#872 review). Only a finished
        # checkpoint is stale; a read hiccup (`unknown`) keeps it too.
        read_sweep_marker "$n"
        if [ "$MARK_FORM" = "some" ] && [ -z "$MARK_RUN" ]; then remove_sweep_marker "$n"; fi
        return 1
      }
      ;;
  esac

  # A read failure is "skip", not "empty activity": an empty input still hashes
  # to a non-empty value, which would look like a change and dispatch an
  # unchanged issue on every sweep.
  sig=$(activity_signal "$n") \
    || { echo "::warning::could not read the activity of #$n; skipped this sweep."; return 1; }
  [ -n "$sig" ] || return 1

  read_sweep_marker "$n"
  prev_sig="$SIGNAL"; prev_run="$MARK_RUN"; prev_extra="$MARK_EXTRA"; prev_form="$MARK_FORM"; prev_at="$MARK_AT"

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
  # The issue carries one checkpoint shared by the activity dispatch and the side
  # responses (`--relabel`, `--type-conflict`). Check *every* slot before the
  # issue is treated as answered: a label change does not move the activity, so a
  # side run recorded after the main one would otherwise be dropped, and a failed
  # side run would never retry (#838 follow-up). The checkpoint is finished only
  # when every recorded run COMPLETED; any slot still running leaves the issue in
  # flight, and any slot that failed re-dispatches.
  if [ "$prev_sig" = "$sig" ]; then
    slot_failed=0
    slot_pending=0
    slot_completed=0
    for srun in $(checkpoint_slot_values "$prev_extra"); do
      [ -n "$srun" ] || continue
      if [ "$srun" = "$PENDING_RUN" ]; then
        slot_pending=1
        continue
      fi
      sst=$(run_status "$srun")
      case "$sst" in
        UNKNOWN)
          echo "#$n: the run listing could not be read; leaving the checkpoint for the next sweep."
          return 1
          ;;
        RUNNING | PENDING)
          echo "#$n: run ${srun} is ${sst}; leaving it in flight."
          return 1
          ;;
        COMPLETED) slot_completed=1 ;;
        *)
          echo "#$n: side run ${srun} did not complete (${sst:-unreadable}); retrying."
          slot_failed=1
          ;;
      esac
    done
    if [ "$prev_run" = "$PENDING_RUN" ]; then
      slot_pending=1
    elif [ -n "$prev_run" ]; then
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
          echo "#$n: run ${prev_run} completed."
          slot_completed=1
          ;;
        *)
          echo "#$n: run ${prev_run} did not complete (${st:-unreadable}); retrying."
          slot_failed=1
          ;;
      esac
    fi
    # A failed slot (main or side) re-dispatches: fall through. A pending slot is
    # a deferred dispatch: fall through to the capacity check. Otherwise, if any
    # run completed, the whole checkpoint is finished — clear it. If no run was
    # recorded at all, the activity is already answered.
    if [ "$slot_failed" = 0 ] && [ "$slot_pending" = 0 ]; then
      if [ "$slot_completed" = 1 ]; then
        write_sweep_marker "$n" "$sig" ""
      fi
      return 1
    fi
  fi

  # The activity needs a dispatch. Defer while the pool is full so a burst is not
  # formed (#841): the next sweep picks the issue up, so nothing is lost. The
  # checkpoint is a plain KV upsert, so re-writing the same `pending` value is
  # harmless (no comment, no issue update time). The FIRST deferral time is kept
  # across re-deferrals (K25, #872) so the sweep's FIFO order cannot be reset by
  # a later activity change: an existing pending checkpoint keeps its `at` (a
  # pre-`at` pending one counts as oldest, 0), while a first deferral stamps now.
  if [ "$inflight" -ge "$MAX_INFLIGHT" ]; then
    if [ "$prev_run" = "$PENDING_RUN" ]; then at="${prev_at:-0}"; else at=""; fi
    write_sweep_marker "$n" "$sig" "$PENDING_RUN" "$at"
    echo "#$n: deferred, ${inflight} triage run(s) already in flight (MAX_INFLIGHT=$MAX_INFLIGHT)."
    return 3
  fi

  # Dispatch; record the run so the next sweep reads its result, not the 201.
  # This run supersedes the failed/pending slots read above, so it replaces them
  # rather than carrying them forward (else the sweep would re-dispatch forever).
  if dispatch "$n" sweep-activity "$sig"; then
    SWEEP_MARKER_PRESERVE_SLOTS=0
    write_sweep_marker "$n" "$sig" "$RUN_ID"
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
  # A retry marker left by the label path is folded back into the sweep
  # checkpoint first, so this pass (which runs after the sweep) sees it too.
  drain_retry_markers
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
    # A finished checkpoint (every slot empty) is answered; only a `pending` or a
    # run in flight (main or a side response) is a recovery candidate.
    [ "$MARK_ACTIVE" = 1 ] || continue
    # A checkpoint naming a run needs no capacity (it checks an outcome); a
    # pending one is a dispatch, so it waits while the pool is full — but other
    # checkpoints later in the list may still be checked.
    if [ "$MARK_PENDING" = 1 ] && [ "$inflight" -ge "$MAX_INFLIGHT" ]; then
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

# The deferred (`pending`) checkpoints in the KV store, one "<at> <number>" line
# per issue, where `at` is the epoch second of the FIRST deferral (0 when the
# checkpoint predates the `at` field, so it counts as the oldest). The sweep
# orders its candidates by this (K25 #872): a deferred issue's checkpoint is
# rewritten in place and never touches the issue, so the issue's `updated_at`
# does not move, and a search ordered by activity would let it sink past the
# window while fresh activity keeps taking the slots — the head-of-line
# starvation #872 describes. Discovery from the store is unbounded (one paginated
# listing plus one read per checkpoint, the same cost `recover_ready` already
# pays), so a long wait is always found however old it is.
pending_keys() {
  for n in $(sweep_keys); do
    read_sweep_marker "$n"
    [ "$MARK_RUN" = "$PENDING_RUN" ] || continue
    printf '%s %s\n' "${MARK_AT:-0}" "$n"
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
  # Candidates come from two sources, unioned so an issue is visited once:
  #   1. `pending_keys` — issues whose dispatch was deferred while the pool was
  #      full, oldest first (FIFO by first deferral, K25 #872). A `pending`
  #      checkpoint is rewritten in place and never touches the issue, so the
  #      issue's `updated_at` does not move; ordering by activity alone (source
  #      2) would let such an issue sink below the search window while fresh
  #      activity keeps taking the slots — the head-of-line starvation #872
  #      describes. They go first, so a long wait always wins a slot.
  #   2. The activity-ordered search, newest first. `gh api --paginate` would
  #      fetch every page regardless, so the pages are requested one at a time
  #      and the loop stops at SWEEP_PAGES or the first short page: SWEEP_PAGES
  #      caps the API calls, SWEEP_MAX caps the dispatches. An issue past this
  #      window is not lost — the next sweep's `sort` moves it in front once it
  #      is touched, and a deferred one is found by source 1 regardless.
  cand=$(mktemp)
  search=$(mktemp)
  # Fold any retry marker the label path left (a deferral whose store read
  # failed) into a `pending` sweep checkpoint before the candidate list is
  # built, so it is queued here instead of being lost.
  drain_retry_markers
  pending_keys | sort -n -k1,1 >> "$cand"
  page=1
  while [ "$page" -le "$SWEEP_PAGES" ]; do
    items=$(gh api -X GET search/issues \
      -f q="repo:$REPO is:issue is:open -label:ready" -f per_page=100 \
      -f sort=updated -f order=desc -f page="$page" \
      --jq '.items[] | "\(.updated_at) \(.number)"' 2>/dev/null || echo "")
    [ -n "$items" ] || break
    printf '%s\n' "$items" >> "$search"
    got=$(printf '%s\n' "$items" | grep -c . || true)
    [ "$got" -ge 100 ] || break
    page=$((page + 1))
  done
  sort -r -u -o "$search" "$search"
  cat "$search" >> "$cand"
  rm -f "$search"
  # One line per issue, first occurrence wins: a deferred issue keeps its FIFO
  # slot instead of being re-ordered by its (unmoved) activity below fresh ones.
  awk '{print $2}' "$cand" | awk '!seen[$0]++' > "$cand.uniq"
  mv "$cand.uniq" "$cand"

  # The pool cap: how many triage runs are already RUNNING/PENDING. Each dispatch
  # in this sweep adds one, so the count is tracked locally as well — the API is
  # read once, not once per candidate. A sweep that reaches the cap defers the
  # rest to the next run instead of forming a burst the sandbox pool cannot host.
  inflight=$(inflight_count)
  deferred=0

  while read -r n; do
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
  --relabel) relabel_after_revocation "${2:?usage: issue-triage-bridge.sh --relabel <number>}" ;;
  --type-conflict) type_conflict_dispatch "${2:?usage: issue-triage-bridge.sh --type-conflict <number> <declined-type>}" "${3:-}" ;;
  --sweep) sweep ;;
  --recover-ready) recover_ready ;;
  --purge-markers) purge_markers ;;
  *) echo "usage: issue-triage-bridge.sh --stdin | --relabel <n> | --type-conflict <n> <type> | --sweep | --recover-ready | --purge-markers" >&2; exit 2 ;;
esac
