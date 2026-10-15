#!/bin/sh
# Retry an automation run that died on infrastructure, a bounded number of
# times. Run hourly by automation-retry.yml.
#
# Why this exists: every failure in the fleet's run history is infrastructure,
# not content. Across the 24 automations, the failed runs are
# `execution/timeout` (the run hit its wall-clock ceiling while doing real
# work), `verification/environment_unavailable` ("Sandbox not available" — no
# slot in the pool), `dispatch/unknown` (the sandbox never came up), a 502 from
# the sandbox API, and the LLM proxy answering `503 Service Temporarily
# Unavailable`. None of those say the task was wrong, and none of them are
# retried today: `POST /{id}/dispatch` is fire-and-forget, so a run that dies
# after the 201 is simply lost. This is the retry the fleet was missing.
#
# It is deliberately narrow and safe:
#   * only **cron** automations are re-dispatched. A cron run is self-contained
#     (it reads the repository, not an event payload), so a payload-less retry
#     means the same thing as the original run. An event automation is NOT
#     retried here: its payload names the issue or pull request, the runs API
#     does not expose that payload, and re-running one blind could act on the
#     wrong object. Event automations keep their own deterministic retriers
#     (`gate-watch.yml` for the review gate, `issue-triage-bridge.sh` for
#     triage).
#   * only a failure whose `status_detail` is an infrastructure kind is retried;
#     an `auth`, `quota` or `config` failure is a decision for a person.
#   * the attempt count is kept in the automation KV store under **one key per
#     automation** (`retry-<aid>`), not one per run id. A dispatch mints a new
#     run id, so a per-run key would hand every retry a fresh budget and the
#     chain would never end; a per-automation key caps the whole episode. The
#     ledger is deleted the moment the newest run is COMPLETED (the automation
#     recovered, so the next failure starts a fresh episode), and a failure is
#     never retried twice within BACKOFF_MINUTES. A KV read/write failure skips
#     the retry (never retries blind) and marks the scan degraded.
#   * an automation the platform **auto-paused** after repeated failures is not
#     retried (nothing would run), but it is reported: an auto-pause is an
#     unresolved outage, not a person's decision. A manual stop is left alone.
#   * the one health issue (marker `automation-retry:health`, label
#     `automation-health`) lists what ran out of chances and what was
#     auto-paused, is updated in place, and is closed once both lists are empty
#     — the same "a silence is also a failure" rule gate-watch follows (#776).
#     A scan that could not read every automation leaves the issue untouched:
#     an incomplete scan is not proof that the outage is over.
#
# Usage: automation-retry.sh
# Env:   OPENHANDS_API_KEY (required), REPO (owner/name),
#        AUTOMATION_API (default the cloud automation API),
#        RETRY_MAX (default 2), BACKOFF_MINUTES (default 20),
#        WINDOW_MINUTES (default 1440, do not retry a failure older than this),
#        NOW (epoch seconds; for tests), CURL (default curl)
set -eu

REPO="${REPO:-cipansor/cipansor}"
API="${AUTOMATION_API:-https://app.all-hands.dev/api/automation/v1}"
CURL="${CURL:-curl}"
RETRY_MAX="${RETRY_MAX:-2}"
BACKOFF_MINUTES="${BACKOFF_MINUTES:-20}"
WINDOW_MINUTES="${WINDOW_MINUTES:-1440}"
NOW="${NOW:-$(date -u +%s)}"
ISSUE_MARK="<!-- automation-retry:health -->"
# Automated comments carry no AI-disclosure footer: the anti-loop guard is the
# comment's author (`cipansor-bot`), not the footer text (#680, 2026-10-14).

if [ -z "${OPENHANDS_API_KEY:-}" ]; then
  echo "::error::OPENHANDS_API_KEY is not set; nothing can be retried."
  exit 1
fi

DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT HUP INT TERM
RETRIED="$DIR/retried"     # lines: <name> <run> <kind> <attempt>
EXHAUSTED="$DIR/exhausted" # lines: <name> <run> <kind> <attempts>
PAUSED="$DIR/paused"       # lines: <name> <reason>
DEGRADED="$DIR/degraded"   # one line per automation whose read failed
: > "$RETRIED"
: > "$EXHAUSTED"
: > "$PAUSED"
: > "$DEGRADED"

iso() { date -u -d "@$1" +%Y-%m-%dT%H:%MZ; }

# A UTC timestamp as epoch seconds (0 on a parse failure). The API returns
# fractional seconds, which `date -d` accepts; strip any trailing `Z`.
epoch() { date -u -d "$(printf '%s' "$1" | sed 's/Z$//')" +%s 2>/dev/null || echo 0; }

# Read the automation list once. A failed read must stop the run: an empty list
# would look like "nothing failed" and close the health issue while runs are
# still broken.
if ! AUTOS=$("$CURL" -fsS "$API" -H "Authorization: Bearer $OPENHANDS_API_KEY" 2>/dev/null); then
  echo "::warning::Could not read the automation list; leaving the health report unchanged."
  exit 1
fi

# True when a failed run's `status_detail` is an infrastructure cause worth
# another attempt. `auth`/`quota`/`config` are a person's decision; a
# user-cancelled run is never retried.
retryable() { # retryable <phase> <kind>
  case "$2" in
    auth | quota | config) return 1 ;;
  esac
  case "$1/$2" in
    execution/timeout | verification/environment_unavailable | dispatch/unknown | dispatch/server_error | execution/execution_error | callback/execution_error) return 0 ;;
  esac
  return 1
}

# The KV value for an automation's retry episode: the attempt count and when the
# last attempt was. `meta=true` also returns the version, used to write
# optimistically. A key that does not exist is 404 `key_not_found` — that is "no
# attempt yet", NOT an unreadable KV. Without the status code check, `curl -f`
# makes a first failure look unreadable and the run is never retried at all.
kv_get() { # kv_get <automation-id> <key>; prints "<attempts>\t<last_at>\t<version>"
  body=$("$CURL" -sS -o "$DIR/kv.body" -w '%{http_code}' "$API/kv/$2?meta=true&automation_id=$1" \
    -H "Authorization: Bearer $OPENHANDS_API_KEY" 2>/dev/null) || return 1
  case "$body" in
    404) printf '0\t0\t0\n'; return 0 ;;
    2??) : ;;
    *) return 1 ;;
  esac
  jq -r '[(.value.attempts // 0), (.value.last_at // 0), (.version // 0)] | @tsv' \
    "$DIR/kv.body" 2>/dev/null
}

kv_put() { # kv_put <automation-id> <key> <attempts> <last_at> <version>
  body=$(jq -nc --argjson a "$3" --argjson t "$4" '{attempts: $a, last_at: $t}')
  # `version 0` means the key does not exist yet, so claim it with `nx=true`; a
  # 409 there means another pass claimed it first. Otherwise match the version
  # read above; a 409 means the ledger moved, so this pass stands down rather
  # than risking a double dispatch.
  if [ "$5" -gt 0 ]; then
    "$CURL" -fsS -o /dev/null -X PUT "$API/kv/$2?if_version=$5&automation_id=$1" \
      -H "Authorization: Bearer $OPENHANDS_API_KEY" -H "Content-Type: application/json" -d "$body" 2>/dev/null
  else
    "$CURL" -fsS -o /dev/null -X PUT "$API/kv/$2?nx=true&automation_id=$1" \
      -H "Authorization: Bearer $OPENHANDS_API_KEY" -H "Content-Type: application/json" -d "$body" 2>/dev/null
  fi
}

# One key per automation, so the cap covers the whole failure episode rather
# than a single run id. Deleting it (the API answers 200, and a later GET is
# 404) makes the next failure a fresh episode with a full budget; a delete that
# fails is not fatal — the count simply carries over.
kv_reset() { # kv_reset <automation-id> <key>
  "$CURL" -fsS -o /dev/null -X DELETE "$API/kv/$2?automation_id=$1" \
    -H "Authorization: Bearer $OPENHANDS_API_KEY" 2>/dev/null || true
}

printf '%s' "$AUTOS" | jq -r '.automations[] | select(.trigger.type == "cron") | [.id, .name, (.enabled | tostring), (.disabled_reason // "")] | @tsv' 2>/dev/null \
  | while IFS="$(printf '\t')" read -r aid name enabled reason; do
    [ -n "${aid:-}" ] || continue
    # A paused automation is paused for a reason. An auto-pause (the platform
    # stopped it after repeated failures) is an outage to report; a manual stop
    # is a person's decision and is left alone.
    if [ "$enabled" = "false" ]; then
      case "$reason" in
        *automatically*) printf '%s\t%s\n' "$name" "$reason" >> "$PAUSED" ;;
        *) echo "$name: disabled by hand; left alone." ;;
      esac
      continue
    fi
    runs=$("$CURL" -fsS "$API/$aid/runs?limit=5" -H "Authorization: Bearer $OPENHANDS_API_KEY" 2>/dev/null) || {
      echo "::warning::$name: runs unreadable; skipped."
      printf '%s\n' "$name" >> "$DEGRADED"
      continue
    }
    # A 200 whose `runs` is not an array (missing, null, an object) is unreadable,
    # not "no run": read as empty it would reset the ledger and drop an exhausted
    # automation from the report, so the pass must not be trusted.
    if ! printf '%s' "$runs" | jq -e 'type == "object" and (.runs | type == "array")' >/dev/null 2>&1; then
      echo "::warning::$name: runs listing malformed; skipped."
      printf '%s\n' "$name" >> "$DEGRADED"
      continue
    fi
    key="retry-$aid"
    # The newest run only: an automation whose latest run succeeded needs no
    # retry, whatever failed before it.
    line=$(printf '%s' "$runs" | jq -r '.runs[0] // empty | [.id, .status, (.status_detail.phase // ""), (.status_detail.kind // ""), (.created_at // "")] | @tsv' 2>/dev/null)
    if [ -z "$line" ]; then
      kv_reset "$aid" "$key" # no run at all: nothing to retry, episode over
      continue
    fi
    run=$(printf '%s' "$line" | cut -f1)
    status=$(printf '%s' "$line" | cut -f2)
    phase=$(printf '%s' "$line" | cut -f3)
    kind=$(printf '%s' "$line" | cut -f4)
    created=$(printf '%s' "$line" | cut -f5)
    # A run still in flight: wait, do not stack a second run on the same slot.
    case "$status" in
      RUNNING | PENDING)
        echo "$name: newest run is $status; waiting."
        continue ;;
    esac
    # Recovered: the next failure starts a fresh episode with a full budget.
    if [ "$status" != "FAILED" ]; then
      kv_reset "$aid" "$key"
      continue
    fi
    retryable "$phase" "$kind" || {
      echo "$name: last run $run failed ($phase/$kind); not an infrastructure failure, not retried."
      continue
    }
    if ! kv=$(kv_get "$aid" "$key"); then
      echo "::warning::$name: KV unreadable for $run; not retrying blind."
      printf '%s\n' "$name" >> "$DEGRADED"
      continue
    fi
    attempts=$(printf '%s' "$kv" | cut -f1)
    last_at=$(printf '%s' "$kv" | cut -f2)
    version=$(printf '%s' "$kv" | cut -f3)
    # Out of chances: report it, and keep reporting it until the automation
    # recovers — the age of the failure does not make the outage go away.
    if [ "$attempts" -ge "$RETRY_MAX" ]; then
      echo "$name: $run already retried $attempts time(s); out of chances."
      printf '%s\t%s\t%s\t%s\n' "$name" "$run" "$phase/$kind" "$attempts" >> "$EXHAUSTED"
      continue
    fi
    # The age window gates *dispatch* only; a failure older than the window is
    # left for a person rather than retried blindly.
    since=$(( (NOW - $(epoch "$created")) / 60 ))
    if [ "$since" -gt "$WINDOW_MINUTES" ]; then
      echo "$name: last failure is ${since} min old; outside the ${WINDOW_MINUTES} min window."
      continue
    fi
    if [ "$attempts" -gt 0 ] && [ $(( (NOW - last_at) / 60 )) -lt "$BACKOFF_MINUTES" ]; then
      echo "$name: $run retried $(( (NOW - last_at) / 60 )) min ago; backing off ${BACKOFF_MINUTES} min."
      continue
    fi
    # Claim the attempt before dispatching: if the KV write loses a race, no
    # dispatch happens, so a double retry cannot occur.
    if ! kv_put "$aid" "$key" "$((attempts + 1))" "$NOW" "$version"; then
      echo "::warning::$name: could not claim a retry for $run; skipped."
      printf '%s\n' "$name" >> "$DEGRADED"
      continue
    fi
    payload=$(jq -nc --arg run "$run" '{source: "retry-sweeper", retry_of: $run}')
    code=$("$CURL" -sS -o /dev/null -w '%{http_code}' -X POST "$API/$aid/dispatch" \
      -H "Authorization: Bearer $OPENHANDS_API_KEY" -H "Content-Type: application/json" \
      -d "$payload" 2>/dev/null || echo 000)
    case "$code" in
      2??)
        echo "$name: retried $run ($phase/$kind), attempt $((attempts + 1))/$RETRY_MAX (HTTP $code)."
        printf '%s\t%s\t%s\t%s\n' "$name" "$run" "$phase/$kind" "$((attempts + 1))" >> "$RETRIED"
        ;;
      *)
        # The claim was written but the dispatch failed; roll it back so the
        # next pass can try, instead of burning an attempt on a rejected call.
        # Only *our own* claim may be undone: read the ledger back and match the
        # values this pass wrote (`attempts + 1`, `NOW`). If another pass has
        # claimed since, the ledger belongs to that claim now, and writing the
        # old count back would erase it and let the retry cap be exceeded. A
        # version mismatch (`if_version` on the write) guards the window between
        # the read and the write; a value mismatch means stand down and degrade.
        if ! kv=$(kv_get "$aid" "$key"); then
          echo "::warning::$name: rollback failed for $run; attempt may be burned."
          printf '%s\n' "$name" >> "$DEGRADED"
        else
          got_attempts=$(printf '%s' "$kv" | cut -f1)
          got_last=$(printf '%s' "$kv" | cut -f2)
          got_version=$(printf '%s' "$kv" | cut -f3)
          if [ "$got_attempts" != "$((attempts + 1))" ] || [ "$got_last" != "$NOW" ]; then
            echo "::warning::$name: another pass claimed $run; leaving the ledger alone."
            printf '%s\n' "$name" >> "$DEGRADED"
          elif kv_put "$aid" "$key" "$attempts" "$last_at" "$got_version"; then
            echo "::warning::$name: dispatch for $run answered HTTP $code; attempt rolled back."
          else
            # The claim may still stand. Say so, and degrade the pass so the
            # health report is left as it is rather than read as a clean scan.
            echo "::warning::$name: rollback failed for $run; attempt may be burned."
            printf '%s\n' "$name" >> "$DEGRADED"
          fi
        fi
        ;;
    esac
  done

# An incomplete scan is not proof that an outage is over: leave the issue as it
# is and let the next hourly pass re-scan, rather than close or rewrite it. A
# failed KV read is the same: the automation's outcome is unknown, so the pass
# must not be read as "nothing is out of chances".
if [ -s "$DEGRADED" ]; then
  echo "::warning::Read failures for: $(tr '\n' ' ' < "$DEGRADED"); leaving the health report unchanged."
  exit 0
fi

# The one health issue, found by its marker among open `automation-health`
# issues. An unreadable list is not "no issue open".
if ! _issues=$(gh api --paginate "repos/$REPO/issues?state=open&labels=automation-health&per_page=100" \
    --jq ".[] | select(.pull_request == null) | select((.body // \"\") | contains(\"$ISSUE_MARK\")) | .number" 2>/dev/null); then
  echo "::warning::Could not read the open automation-health issues; leaving the health report unchanged."
  exit 1
fi
ISSUE=$(printf '%s\n' "$_issues" | head -n1)

if [ ! -s "$EXHAUSTED" ] && [ ! -s "$PAUSED" ]; then
  if [ -n "$ISSUE" ]; then
    printf '%s\n' "Tidak ada lagi automation yang kehabisan kesempatan retry atau dijeda otomatis. Ditutup; issue ini dibuka lagi bila ada yang gagal infrastruktur melewati batas." > "$DIR/close"
    gh issue comment "$ISSUE" --repo "$REPO" --body-file "$DIR/close" >/dev/null
    gh api -X PATCH "repos/$REPO/issues/$ISSUE" -f state=closed -f state_reason=completed >/dev/null
    echo "No automation out of retries; closed #$ISSUE."
  else
    echo "No automation out of retries."
  fi
  exit 0
fi

{
  printf '%s\n' "$ISSUE_MARK"
  if [ -s "$EXHAUSTED" ]; then
    printf '%s\n' "" \
      "Automation cron di bawah ini gagal karena infrastruktur (timeout, sandbox tidak tersedia, 502, atau proxy LLM) dan sudah dicoba ulang $RETRY_MAX kali tanpa berhasil. Retry otomatis berhenti di sini; yang tersisa adalah keputusan orang: periksa run terakhir di riwayat automation, atau minta ulang secara manual." \
      "" \
      "| Automation | Run terakhir | Penyebab | Percobaan |" \
      "|---|---|---|---|"
    sort "$EXHAUSTED" | while IFS="$(printf '\t')" read -r name run kind tries; do
      printf '| %s | `%s` | `%s` | %s |\n' "$name" "$(printf '%s' "$run" | cut -c1-8)" "$kind" "$tries"
    done
  fi
  if [ -s "$PAUSED" ]; then
    printf '%s\n' "" \
      "Automation cron di bawah ini **dijeda otomatis** oleh platform setelah kegagalan beruntun. Tidak ada yang di-dispatch ulang — menjeda otomatis berarti belum ada run sukses; yang perlu diputuskan adalah apakah akan mengaktifkannya kembali (mis. lewat \`PATCH /api/automation/v1/<id>\` body \`{\"enabled\":true}\`) atau membiarkannya mati." \
      "" \
      "| Automation | Alasan jeda |" \
      "|---|---|"
    sort "$PAUSED" | while IFS="$(printf '\t')" read -r name reason; do
      printf '| %s | %s |\n' "$name" "$reason"
    done
  fi
  printf '%s\n' "" "Diperbarui oleh \`automation-retry.yml\` setiap jam, hanya saat daftarnya berubah. Percobaan retry dicatat di KV store automation (satu kunci per automation)."
} > "$DIR/body"

if [ -n "$ISSUE" ]; then
  old=$(gh api "repos/$REPO/issues/$ISSUE" --jq '.body // ""' 2>/dev/null || true)
  if [ "$old" = "$(cat "$DIR/body")" ]; then
    echo "Health issue #$ISSUE already lists these automations."
  else
    gh api -X PATCH "repos/$REPO/issues/$ISSUE" -F body=@"$DIR/body" >/dev/null
    echo "Updated health issue #$ISSUE."
  fi
else
  url=$(gh issue create --repo "$REPO" --title "Automation kehabisan retry infrastruktur" \
    --label automation-health --body-file "$DIR/body")
  echo "Opened health issue #${url##*/}."
fi
