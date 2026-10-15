#!/bin/sh
# Flag pull requests the review gate left unreviewed. Run hourly by
# gate-watch.yml (#776).
#
# pr-lifecycle.sh dispatches `Gerbang tinjau PR` (OpenHands Cloud) once a ready
# PR is green, and a 2xx answer only says the request was accepted, not that a
# review will come. From 2026-10-10 five PRs sat green for a day with no review
# and nothing said so. A step that stays silent has failed too; this makes the
# silence visible and says where to look.
#
# A PR is "waiting on the gate" when:
#   * it is open and not a draft,
#   * every check in REQUIRED_CHECKS is present on its head, the latest run of
#     each is completed and none is red, and a check from every known suite has
#     published (a green subset — CI done before E2E — is still pending),
#   * the last of them completed more than WAIT_MINUTES ago,
#   * and GATE_LOGIN has left no review on that head commit.
# It does not rely on the dispatch itself, which is recorded only in a workflow
# log: a green, ready head with no gate review is the symptom, whatever the
# cause.
#
# The gate definition (REQUIRED_CHECKS, KNOWN_SUITE_SIGNS, the latest-run-per-
# name rule, and red/pending restricted to the gate checks) is the same as
# pr-lifecycle.sh: an advisory check that fails, a re-run still in flight, or a
# green subset must not be read as the gate's silence.
#
# For those PRs:
#   * a bounded re-dispatch of the gate per head commit, when OPENHANDS_API_KEY
#     is set. The gate's own runs are read from the automation API: while one is
#     RUNNING/PENDING the head is left alone (a second run would only compete for
#     the same sandbox), and a run that FAILED for an infrastructure reason — a
#     timeout, a sandbox that never came up, a 502, the LLM proxy's 503 — is
#     retried. That is the fleet's missing retry for this automation: 14 of
#     SDLC 18's last 50 runs died on infrastructure, each one lost, because
#     `POST /{id}/dispatch` is fire-and-forget. Attempts are counted from the
#     `gate-watch-attempt:<sha>:<n>` markers this script writes, so the count
#     survives across hourly runs; at most GATE_MAX_ATTEMPTS of them, then it is
#     a person's turn (the comment and the health issue say so);
#   * one comment per head commit (marker `gate-watch:<sha>`), written once per
#     attempt so the counter has a home, saying whether the re-dispatch was
#     accepted;
#   * one health issue (marker `gate-watch:health`, label `automation-health`)
#     listing them, updated in place only when the list changes, and closed
#     with a comment once the list is empty. One issue for the cause, not one
#     per PR.
#
# Usage: gate-watch.sh
# Env:   GH_TOKEN, REPO (owner/name), WAIT_MINUTES (default 60),
#        GATE_LOGIN (default cipansor-bot), NOW (epoch seconds; for tests),
#        GATE_MAX_ATTEMPTS (default 3),
#        OPENHANDS_API_KEY and SDLC_REVIEW_GATE_ID (the re-dispatch)
set -eu

REPO="${REPO:?REPO is required}"
WAIT_MINUTES="${WAIT_MINUTES:-60}"
GATE_LOGIN="${GATE_LOGIN:-cipansor-bot}"
NOW="${NOW:-$(date -u +%s)}"
GATE_ID="${SDLC_REVIEW_GATE_ID:-96eebf19-b64b-4035-9653-2d8b15b06ac4}"
GATE_MAX_ATTEMPTS="${GATE_MAX_ATTEMPTS:-3}"
# The gate's run history, for deciding whether a re-dispatch is worth it. The
# same API gate-watch already calls to dispatch, so it needs no new secret.
AUTOMATION_API="${AUTOMATION_API:-https://app.all-hands.dev/api/automation/v1}"
ISSUE_MARK="<!-- gate-watch:health -->"
# Automated comments carry no AI-disclosure footer: the anti-loop guard is the
# comment's author (`cipansor-bot`), not the footer text — the account name
# already tells a reader the comment is automated (#680).

# The checks that make up the required gate, the same set pr-lifecycle.sh
# dispatches on. A green subset (E2E not started yet) must never be mistaken for
# the full gate, so every one of these must be *present* on the head.
REQUIRED_CHECKS="${REQUIRED_CHECKS:-CI scope|Lint|Build|Tests|Security|E2E scope|E2E Tests (Chromium)}"
# Suites that publish a check run on every PR whose workflow ran: a signature
# with no check run on the head means that workflow has not started yet.
KNOWN_SUITE_SIGNS="${KNOWN_SUITE_SIGNS:-CI scope|E2E scope}"

DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT HUP INT TERM
SILENT="$DIR/silent"   # lines: <pr> <sha> <green-since epoch>
: > "$SILENT"
UNREADABLE="$DIR/unreadable"   # PR numbers that could not be fully read
: > "$UNREADABLE"

iso() { date -u -d "@$1" +%Y-%m-%dT%H:%MZ; }

# Why the run this head was dispatched is not a review. Prints:
#   busy          the run is RUNNING/PENDING: the gate is working, or queued
#   infra:<cause> the run FAILED on infrastructure — retryable
#   failed        the run FAILED for a reason a retry will not fix
#   ok            a COMPLETED run (which owed a review and did not post one — the
#                 gate went silent; retried, bounded, since the gate is
#                 idempotent so a stray extra run is cheap)
#   gone          the id is not in the history window, so its outcome is unknown
# A failed read returns non-zero: the caller must not read that as "no run",
# because it would dispatch a head already in flight.
#
# The `runs` API exposes no run-by-id endpoint and no PR on a run, so a run
# cannot be attributed to the head that asked for it from the API alone. The
# caller therefore records the run id it dispatched in the head's own comment
# marker and asks about *that* id here; only when the head has no recorded id
# does it fall back to the global newest run, and then only to check whether
# anything at all is in flight (pr-lifecycle may have dispatched one).
gate_run_status() { # gate_run_status <run-id>
  _want="$1"; _off=0; _lim=100
  # The listing is paged with `limit`/`offset` — the one parameter it honours —
  # until the id is found or the pages run out. A single-page read would call a
  # run that merely fell past the page `gone`, and `gone` is retried, so a run
  # still in flight could be dispatched a second time on the same head (#837
  # review). A page that cannot be read is unreadable (non-zero), not `gone`.
  # Names are `_`-prefixed: this runs inside the caller's `while read -r n sha`
  # loop, so a bare `n` here would overwrite the PR number.
  while :; do
    _page=$(curl -fsS "$AUTOMATION_API/$GATE_ID/runs?limit=$_lim&offset=$_off" \
      -H "Authorization: Bearer $OPENHANDS_API_KEY" 2>/dev/null) || return 1
    # A page whose `runs` is not an array (missing, null, an object) is
    # unreadable, not "the run is gone": `{"runs":null}` would otherwise read as
    # length 0 and dispatch a second run on a head already in flight.
    printf '%s' "$_page" | jq -e 'type == "object" and (.runs | type == "array")' >/dev/null 2>&1 \
      || return 1
    _out=$(printf '%s' "$_page" | jq -r --arg id "$_want" '
      (.runs // []) as $r
      | ($r | map(select(.id == $id)) | .[0]) as $x
      | if $x == null then ""
        elif $x.status == "RUNNING" or $x.status == "PENDING" then "busy"
        elif $x.status == "FAILED" then
          (($x.status_detail.phase // "") + "/" + ($x.status_detail.kind // "")) as $k
          | if $k == "execution/timeout"
               or $k == "verification/environment_unavailable"
               or $k == "dispatch/unknown"
               or $k == "dispatch/server_error"
               or $k == "execution/execution_error"
               or $k == "callback/execution_error"
            then "infra:" + $k
            else "failed" end
        else "ok" end' 2>/dev/null) || return 1
    if [ -n "$_out" ]; then printf '%s' "$_out"; return 0; fi
    _count=$(printf '%s' "$_page" | jq -r '.runs | length' 2>/dev/null) || return 1
    case "$_count" in '' | *[!0-9]*) return 1 ;; esac
    [ "$_count" -ge "$_lim" ] || { printf 'gone'; return 0; }
    _off=$((_off + _lim))
  done
}

# Whether *any* gate run is in flight. Used only when this head has no recorded
# run id: a run nobody attributed could still be this head's, so dispatching
# then would stack a second run on the same work.
gate_any_in_flight() { # gate_any_in_flight
  _runs=$(curl -fsS "$AUTOMATION_API/$GATE_ID/runs?limit=5" \
    -H "Authorization: Bearer $OPENHANDS_API_KEY" 2>/dev/null) || return 1
  printf '%s' "$_runs" | jq -r '
    if ((.runs // []) | map(select(.status == "RUNNING" or .status == "PENDING")) | length) > 0
    then "busy" else "idle" end' 2>/dev/null
}

# Every open PR, paginated: `--limit 200` silently dropped the rest, so a PR
# past the cutoff was neither flagged nor re-dispatched. The draft filter runs
# in jq over the whole list. A failed fetch must fail the scan, never look like
# an empty list: an empty scan closes the active report, so a transient error
# read as "nothing waiting" would close an incident that is still open.
if ! PRS=$(gh api --paginate "repos/$REPO/pulls?state=open&per_page=100" \
  --jq '.[] | select(.draft | not) | "\(.number) \(.head.sha)"' 2>/dev/null); then
  echo "::warning::Could not read open pull requests; leaving the health report unchanged."
  exit 1
fi

# False when a required check is absent, or no check from some known suite has
# published: a green subset is still pending. Names may contain spaces, so the
# comparison is line-exact.
gate_complete() { # gate_complete <present-lines>
  _ifs=$IFS; IFS='
'
  set -f
  for want in $(printf '%s\n' "$REQUIRED_CHECKS" | tr '|' '\n'); do
    printf '%s\n' "$1" | grep -qxF "$want" || { IFS=$_ifs; set +f; return 1; }
  done
  for sign in $(printf '%s\n' "$KNOWN_SUITE_SIGNS" | tr '|' '\n'); do
    [ -n "$sign" ] || continue
    printf '%s\n' "$1" | awk -v s="$sign" 'index($0, s) == 1 { found = 1 } END { exit !found }' \
      || { IFS=$_ifs; set +f; return 1; }
  done
  IFS=$_ifs; set +f
  return 0
}

printf '%s\n' "$PRS" | while read -r n sha; do
  [ -n "${n:-}" ] || continue
  # Reviewed already: any review by the gate on this very commit, whatever its
  # verdict. An older commit's review does not count — the gate reviews heads.
  # A read failure is recorded, not treated as "no review": it must not close
  # the health issue while a PR is still waiting.
  reviewed=$(gh api --paginate "repos/$REPO/pulls/$n/reviews?per_page=100" \
    --jq ".[] | select(.user.login == \"$GATE_LOGIN\" and .commit_id == \"$sha\") | .id" 2>/dev/null || echo unread)
  if [ "$reviewed" = "unread" ]; then
    echo "::warning::PR #$n: reviews unreadable; skipped."
    echo "$n" >> "$UNREADABLE"
    continue
  fi
  if [ -n "$reviewed" ]; then
    continue
  fi
  # The latest run of every check name, as pr-lifecycle.sh picks it (sort by
  # started_at then id): a re-run in flight is the newest run and keeps the head
  # pending, instead of an old green run winning on completed_at. Tab separates
  # fields so a name with spaces ("E2E Tests (Chromium)") stays whole. jq's
  # fromdateiso8601 refuses fractional seconds, so they are dropped first.
  # gh is read on its own so a failed fetch is reported, not mistaken for "no
  # check runs yet".
  if ! raw=$(gh api --paginate "repos/$REPO/commits/$sha/check-runs?per_page=100" 2>/dev/null); then
    echo "::warning::PR #$n: check runs on $sha unreadable; skipped."
    echo "$n" >> "$UNREADABLE"
    continue
  fi
  runs=$(printf '%s' "$raw" | jq -rs '[.[].check_runs[]] | sort_by(.started_at, .id) | group_by(.name) | map(.[-1])[]
          | "\(.name)\t\(.status)\t\(.conclusion // "none")\t\(if .completed_at then (.completed_at | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) else 0 end)"' 2>/dev/null || true)
  if [ -z "$runs" ]; then
    echo "PR #$n: no check runs on $sha yet."
    continue
  fi
  present=$(printf '%s\n' "$runs" | awk -F'\t' '{ print $1 }')
  # Only the gate checks decide red, pending and green, as pr-lifecycle.sh does:
  # an advisory check (the PR-template reminder, a visual reminder, CodeQL) that
  # failed or is still running must not hide a head whose gate is silent.
  pending=$(printf '%s\n' "$runs" | awk -F'\t' -v req="$REQUIRED_CHECKS" '
        BEGIN { n = split(req, a, "|"); for (i = 1; i <= n; i++) want[a[i]] = 1 }
        ($1 in want) && ($2 != "completed" || $3 !~ /^(success|failure|timed_out|action_required|startup_failure|stale|neutral|skipped)$/) { print }')
  if [ -n "$pending" ] || ! gate_complete "$present"; then
    echo "PR #$n: the gate checks on $sha are not all complete; waiting."
    continue
  fi
  red=$(printf '%s\n' "$runs" | awk -F'\t' -v req="$REQUIRED_CHECKS" '
        BEGIN { n = split(req, a, "|"); for (i = 1; i <= n; i++) want[a[i]] = 1 }
        ($1 in want) && $2 == "completed" && $3 ~ /^(failure|timed_out|action_required|startup_failure|stale)$/ { print }')
  if [ -n "$red" ]; then
    # Red: pr-lifecycle does not dispatch a red PR, so the gate owes it nothing.
    echo "PR #$n: a gate check on $sha is red; not the gate's turn."
    continue
  fi
  # Green since the last gate check to settle, over the latest run of each name.
  since=$(printf '%s\n' "$runs" | awk -F'\t' -v req="$REQUIRED_CHECKS" '
        BEGIN { n = split(req, a, "|"); for (i = 1; i <= n; i++) want[a[i]] = 1 }
        ($1 in want) { print $4 }' | sort -n | tail -n1)
  waited=$(( (NOW - since) / 60 ))
  if [ "$waited" -lt "$WAIT_MINUTES" ]; then
    echo "PR #$n: green for ${waited} min; within ${WAIT_MINUTES}."
    continue
  fi
  echo "PR #$n: green since $(iso "$since") with no gate review on $sha."
  echo "$n $sha $since" >> "$SILENT"
done

# The health issue: found by its marker among open `automation-health` issues.
# As for the PR list, a failed read fails the scan: an unreadable list is not
# "no issue open", and opening a second one would duplicate the report.
if ! _issues=$(gh api --paginate "repos/$REPO/issues?state=open&labels=automation-health&per_page=100" \
    --jq ".[] | select(.pull_request == null) | select((.body // \"\") | contains(\"$ISSUE_MARK\")) | .number" 2>/dev/null); then
  echo "::warning::Could not read the open automation-health issues; leaving the health report unchanged."
  exit 1
fi
ISSUE=$(printf '%s\n' "$_issues" | head -n1)

if [ ! -s "$SILENT" ]; then
  # An unreadable scan of an individual PR (a failed review or check read) is
  # not proof the incident ended: closing on an empty list would reopen a fresh
  # issue on the next run for the same PR. Leave the report as it is.
  if [ -s "$UNREADABLE" ]; then
    echo "A scan did not complete; leaving the health report as it is."
    exit 0
  fi
  if [ -n "$ISSUE" ]; then
    printf '%s\n' "Tidak ada lagi PR siap yang menunggu gerbang tinjau lebih dari ${WAIT_MINUTES} menit. Ditutup; issue ini dibuka lagi bila ada yang diam lagi." > "$DIR/close"
    gh issue comment "$ISSUE" --repo "$REPO" --body-file "$DIR/close" >/dev/null
    gh api -X PATCH "repos/$REPO/issues/$ISSUE" -f state=closed -f state_reason=completed >/dev/null
    echo "No PR waiting on the gate; closed #$ISSUE."
  else
    echo "No PR waiting on the gate."
  fi
  exit 0
fi

{
  printf '%s\n' "$ISSUE_MARK" "" \
    "PR di bawah ini siap dan semua check di head-nya hijau lebih dari ${WAIT_MINUTES} menit, tetapi \`$GATE_LOGIN\` belum meninjau head itu. \`pr-lifecycle\` sudah men-dispatch \`Gerbang tinjau PR\`; jawaban 2xx hanya berarti permintaan diterima." \
    "" \
    "Yang perlu dilakukan: buka riwayat run automation \`Gerbang tinjau PR\` di OpenHands Cloud dan cari run untuk PR itu. Kalau gagal karena infrastruktur, minta review ulang di PR atau dorong commit baru." \
    "" \
    "| PR | Head | Hijau sejak (UTC) |" \
    "|---|---|---|"
  sort -n "$SILENT" | while read -r n sha since; do
    printf '| #%s | `%s` | %s |\n' "$n" "$(printf '%s' "$sha" | cut -c1-9)" "$(iso "$since")"
  done
  printf '%s\n' "" "Diperbarui oleh \`gate-watch.yml\` setiap jam, hanya saat daftarnya berubah, dan ditutup saat daftarnya kosong (#776)."
} > "$DIR/body"

if [ -n "$ISSUE" ]; then
  old=$(gh api "repos/$REPO/issues/$ISSUE" --jq '.body // ""' 2>/dev/null || true)
  if [ "$old" = "$(cat "$DIR/body")" ]; then
    echo "Health issue #$ISSUE already lists these PRs."
  else
    gh api -X PATCH "repos/$REPO/issues/$ISSUE" -F body=@"$DIR/body" >/dev/null
    echo "Updated health issue #$ISSUE."
  fi
else
  url=$(gh issue create --repo "$REPO" --title "Gerbang tinjau diam: PR siap tanpa review" \
    --label automation-health --body-file "$DIR/body")
  ISSUE="${url##*/}"
  echo "Opened health issue #$ISSUE."
fi

# One comment per silent head, pointing at the issue.
sort -n "$SILENT" | while read -r n sha since; do
  mark="<!-- gate-watch:$sha -->"
  # One read of the head's comments serves both answers: the marker comment to
  # update in place, and the attempt count it carries. `--paginate` emits one
  # JSON array per page, so the pages must be slurped (`-s`) into one array
  # before anything is selected from it — otherwise `cid` and `attempts` become
  # multi-line strings and the numeric cap comparison silently fails.
  if ! comments=$(gh api --paginate "repos/$REPO/issues/$n/comments?per_page=100" 2>/dev/null); then
    echo "::warning::PR #$n: comments unreadable; not re-dispatching $sha."
    continue
  fi
  # The marker comment for this head, if any, and how many re-dispatches it
  # records. A read failure must not look like "no comment yet": re-dispatching
  # the gate on every run for a head already told about would pile up dispatches.
  cid=$(printf '%s' "$comments" | jq -rs --arg m "$mark" \
    '[.[][] | select((.body // "") | contains($m))] | last | .id // empty' 2>/dev/null) || cid=unread
  if [ "$cid" = "unread" ]; then
    echo "::warning::PR #$n: comments unreadable; not re-dispatching $sha."
    continue
  fi
  attempts=$(printf '%s' "$comments" | jq -rs --arg s "$sha" \
    '[.[][] | (.body // "") | scan("gate-watch-attempt:" + $s + ":([0-9]+)") | .[0] | tonumber] | max // 0' 2>/dev/null || echo 0)
  case "$attempts" in
    '' | *[!0-9]*) attempts=0 ;;
  esac
  # The gate run this head's last dispatch produced, so its state can be read
  # back per head instead of guessing from the newest run of the whole gate.
  myrun=$(printf '%s' "$comments" | jq -rs --arg s "$sha" \
    '[.[][] | (.body // "") | scan("gate-watch-run:" + $s + ":([A-Za-z0-9-]+)") | .[0]] | last // empty' 2>/dev/null)
  case "$myrun" in
    *[!A-Za-z0-9-]*) myrun="" ;;
  esac

  # Why a run is not a review. A head with a recorded run id is judged on that
  # run; a head without one only waits if some run is in flight (pr-lifecycle
  # may have dispatched one nobody attributed). An unreadable history is not
  # "no run": dispatching then could double up on a head already being reviewed.
  retry=""
  if [ -n "${OPENHANDS_API_KEY:-}" ]; then
    if [ -n "$myrun" ]; then
      if ! state=$(gate_run_status "$myrun"); then
        echo "::warning::PR #$n: the gate's run history is unreadable; not re-dispatching $sha."
        continue
      fi
    elif ! state=$(gate_any_in_flight); then
      echo "::warning::PR #$n: the gate's run history is unreadable; not re-dispatching $sha."
      continue
    elif [ "$state" = "busy" ]; then
      state="busy-unknown"
    else
      state="no-run"
    fi
    case "$state" in
      busy)
        retry=" Run gerbang untuk head ini ($myrun) masih RUNNING/PENDING; menunggu, tidak dispatch lagi." ;;
      busy-unknown)
        retry=" Ada run gerbang yang masih RUNNING/PENDING; menunggu agar tidak menumpuk run." ;;
      failed)
        retry=" Run gerbang terakhir untuk head ini gagal bukan karena infrastruktur; tidak dispatch lagi." ;;
      infra:* | gone | no-run | ok)
        # `gone`: the recorded run has fallen out of the history window, so its
        # outcome is unknown — treat like a lost run and try again. `no-run`:
        # the head was never dispatched (or the dispatch was lost). `ok`: the
        # run completed but wrote no review — the gate went silent, which is the
        # very failure this watch exists for. All are bounded by the same cap,
        # and a re-dispatch is safe: the gate is idempotent (it skips a head it
        # already reviewed), so a stray extra run costs a sandbox slot, not a
        # wrong review.
        if [ "$attempts" -ge "$GATE_MAX_ATTEMPTS" ]; then
          case "$state" in
            infra:*) cause="${state#infra:}" ;;
            gone) cause="run tercatat tidak ada lagi di riwayat" ;;
            ok) cause="run selesai tanpa menulis review" ;;
            *) cause="belum ada run untuk head ini" ;;
          esac
          retry=" Gerbang belum meninjau head ini ($cause) dan sudah $attempts kali dicoba ulang — giliran manusia."
        else
          payload=$(jq -nc --arg pr "$n" --arg sha "$sha" '{source: "gate-watch", pr: $pr, head_sha: $sha}')
          # One call: the body carries the new run id, and `-w` appends the HTTP
          # code so a refusal is reported with the code it actually returned.
          resp=$(curl -sS -w '\n%{http_code}' -X POST "$AUTOMATION_API/$GATE_ID/dispatch" \
              -H "Authorization: Bearer $OPENHANDS_API_KEY" \
              -H "Content-Type: application/json" \
              -d "$payload" 2>/dev/null || echo '')
          code=$(printf '%s' "$resp" | tail -n1)
          case "$code" in '' | *[!0-9]*) code=000 ;; esac
          newrun=$(printf '%s' "$resp" | sed '$d' | jq -r '.id // empty' 2>/dev/null)
          if [ -n "$newrun" ]; then
            attempts=$((attempts + 1))
            myrun="$newrun"
            retry=" Gerbang belum meninjau head ini; di-dispatch ulang (percobaan $attempts/$GATE_MAX_ATTEMPTS, run \`$newrun\`)."
          else
            retry=" Dispatch ulang ditolak (HTTP $code); periksa kunci dan run-nya."
          fi
        fi ;;
    esac
  else
    retry=" Dispatch ulang tidak dicoba: \`OPENHANDS_API_KEY\` tidak tersedia untuk workflow ini."
  fi

  # One comment per head: it is created once and updated in place, and only when
  # its text actually changes (an attempt, the escalation to a person, a run
  # going from failed to in flight). The attempt count and the run id ride in
  # that comment, so the next hourly run reads them there instead of guessing.
  old_body=""
  if [ -n "$cid" ]; then
    old_body=$(printf '%s' "$comments" | jq -rs --argjson id "$cid" \
      '[.[][] | select(.id == $id)][0].body // ""' 2>/dev/null || true)
  fi
  printf '%s\n' "$mark" "" \
    "Gerbang tinjau belum meninjau head \`$(printf '%s' "$sha" | cut -c1-9)\`.${retry} Semua check head ini sudah selesai hijau sejak $(iso "$since") UTC; dicatat juga di #$ISSUE." > "$DIR/pr-$n"
  if [ "$attempts" -gt 0 ]; then
    printf '%s\n' "<!-- gate-watch-attempt:$sha:$attempts -->" >> "$DIR/pr-$n"
  fi
  if [ -n "$myrun" ]; then
    printf '%s\n' "<!-- gate-watch-run:$sha:$myrun -->" >> "$DIR/pr-$n"
  fi
  if [ -n "$cid" ] && [ "$old_body" = "$(cat "$DIR/pr-$n")" ]; then
    echo "PR #$n: already told about $sha."
  elif [ -n "$cid" ]; then
    gh api -X PATCH "repos/$REPO/issues/comments/$cid" -F body=@"$DIR/pr-$n" >/dev/null
    echo "PR #$n: updated the comment about $sha (attempt $attempts)."
  else
    gh pr comment "$n" --repo "$REPO" --body-file "$DIR/pr-$n" >/dev/null
    echo "PR #$n: commented about $sha (attempt $attempts)."
  fi
done
