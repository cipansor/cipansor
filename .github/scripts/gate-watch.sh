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
#   * one re-dispatch of the gate per head commit, when OPENHANDS_API_KEY is
#     set: a run lost to the platform (a sandbox that never came up, a 429) is
#     retried once, as docs/SDLC-FLOW.md planned; a second silence is a human's;
#   * one comment per head commit (marker `gate-watch:<sha>`), never repeated,
#     saying whether the re-dispatch was accepted;
#   * one health issue (marker `gate-watch:health`, label `automation-health`)
#     listing them, updated in place only when the list changes, and closed
#     with a comment once the list is empty. One issue for the cause, not one
#     per PR.
#
# Usage: gate-watch.sh
# Env:   GH_TOKEN, REPO (owner/name), WAIT_MINUTES (default 60),
#        GATE_LOGIN (default cipansor-bot), NOW (epoch seconds; for tests),
#        OPENHANDS_API_KEY and SDLC_REVIEW_GATE_ID (optional: the re-dispatch)
set -eu

REPO="${REPO:?REPO is required}"
WAIT_MINUTES="${WAIT_MINUTES:-60}"
GATE_LOGIN="${GATE_LOGIN:-cipansor-bot}"
NOW="${NOW:-$(date -u +%s)}"
GATE_ID="${SDLC_REVIEW_GATE_ID:-96eebf19-b64b-4035-9653-2d8b15b06ac4}"
ISSUE_MARK="<!-- gate-watch:health -->"
# Every issue description opens with the basmalah (docs/LABELS.md rule 13).
# basmalah.yml cannot add it to this one: GitHub starts no workflow for an
# issue opened with GITHUB_TOKEN, so the watch writes it itself (#850).
BASMALAH="بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ"
# Every automated comment carries the AI-disclosure footer, so a
# comment-triggered automation never mistakes it for a person (docs/LABELS.md,
# the #680 loop guard).
AI_FOOTER="_This comment was created by an AI agent (OpenHands) on behalf of the repository maintainers._"

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
    printf '%s\n' "Tidak ada lagi PR siap yang menunggu gerbang tinjau lebih dari ${WAIT_MINUTES} menit. Ditutup; issue ini dibuka lagi bila ada yang diam lagi." "" "$AI_FOOTER" > "$DIR/close"
    gh issue comment "$ISSUE" --repo "$REPO" --body-file "$DIR/close" >/dev/null
    gh api -X PATCH "repos/$REPO/issues/$ISSUE" -f state=closed -f state_reason=completed >/dev/null
    echo "No PR waiting on the gate; closed #$ISSUE."
  else
    echo "No PR waiting on the gate."
  fi
  exit 0
fi

{
  printf '%s\n' "$BASMALAH" "" "$ISSUE_MARK" "" \
    "PR di bawah ini siap dan semua check di head-nya hijau lebih dari ${WAIT_MINUTES} menit, tetapi \`$GATE_LOGIN\` belum meninjau head itu. \`pr-lifecycle\` sudah men-dispatch \`Gerbang tinjau PR\`; jawaban 2xx hanya berarti permintaan diterima." \
    "" \
    "Yang perlu dilakukan: buka riwayat run automation \`Gerbang tinjau PR\` di OpenHands Cloud dan cari run untuk PR itu. Kalau gagal karena infrastruktur, minta review ulang di PR atau dorong commit baru." \
    "" \
    "| PR | Head | Hijau sejak (UTC) |" \
    "|---|---|---|"
  sort -n "$SILENT" | while read -r n sha since; do
    printf '| #%s | `%s` | %s |\n' "$n" "$(printf '%s' "$sha" | cut -c1-9)" "$(iso "$since")"
  done
  printf '%s\n' "" "Diperbarui oleh \`gate-watch.yml\` setiap jam, hanya saat daftarnya berubah, dan ditutup saat daftarnya kosong (#776)." "" "$AI_FOOTER"
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
  # A read failure here must not look like "no comment yet": re-dispatching the
  # gate on every run for a head already told about would pile up dispatches.
  have=$(gh api --paginate "repos/$REPO/issues/$n/comments?per_page=100" \
    --jq ".[] | select((.body // \"\") | contains(\"$mark\")) | .id" 2>/dev/null || echo unread)
  if [ "$have" = "unread" ]; then
    echo "::warning::PR #$n: comments unreadable; not re-dispatching $sha."
    continue
  fi
  if [ -n "$have" ]; then
    echo "PR #$n: already told about $sha."
    continue
  fi
  # The same gate and payload as pr-lifecycle.sh; only the source differs.
  if [ -n "${OPENHANDS_API_KEY:-}" ]; then
    payload=$(jq -nc --arg pr "$n" --arg sha "$sha" '{source: "gate-watch", pr: $pr, head_sha: $sha}')
    code=$(curl -sS -o /dev/null -w '%{http_code}' -X POST \
        "https://app.all-hands.dev/api/automation/v1/$GATE_ID/dispatch" \
        -H "Authorization: Bearer $OPENHANDS_API_KEY" \
        -H "Content-Type: application/json" \
        -d "$payload" 2>/dev/null || echo 000)
    case "$code" in
      2??) retry="Gerbang sudah di-dispatch ulang sekali (HTTP $code); bila tetap diam, periksa run-nya." ;;
      *) retry="Dispatch ulang ditolak (HTTP $code); periksa kunci dan run-nya." ;;
    esac
  else
    retry="Dispatch ulang tidak dicoba: \`OPENHANDS_API_KEY\` tidak tersedia untuk workflow ini."
  fi
  printf '%s\n' "$mark" "" \
    "Gerbang tinjau belum meninjau head \`$(printf '%s' "$sha" | cut -c1-9)\`, padahal semua check-nya selesai hijau sejak $(iso "$since") UTC. $retry Run \`Gerbang tinjau PR\` untuk PR ini ada di riwayat automation OpenHands Cloud; dicatat juga di #$ISSUE." \
    "" "$AI_FOOTER" > "$DIR/pr-$n"
  gh pr comment "$n" --repo "$REPO" --body-file "$DIR/pr-$n" >/dev/null
  echo "PR #$n: commented about $sha."
done
