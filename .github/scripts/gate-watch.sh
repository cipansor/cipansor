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
#   * every check run on its head has completed and none is red,
#   * the last of them completed more than WAIT_MINUTES ago,
#   * and GATE_LOGIN has left no review on that head commit.
# It does not rely on the dispatch itself, which is recorded only in a workflow
# log: a green, ready head with no gate review is the symptom, whatever the
# cause.
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
# Every automated comment carries the AI-disclosure footer, so a
# comment-triggered automation never mistakes it for a person (docs/LABELS.md,
# the #680 loop guard).
AI_FOOTER="_This comment was created by an AI agent (OpenHands) on behalf of the repository maintainers._"

DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT HUP INT TERM
SILENT="$DIR/silent"   # lines: <pr> <sha> <green-since epoch>
: > "$SILENT"

iso() { date -u -d "@$1" +%Y-%m-%dT%H:%MZ; }

PRS=$(gh pr list --repo "$REPO" --state open --limit 200 --json number,isDraft,headRefOid \
  --jq '.[] | select(.isDraft | not) | "\(.number) \(.headRefOid)"')

printf '%s\n' "$PRS" | while read -r n sha; do
  [ -n "${n:-}" ] || continue
  # Reviewed already: any review by the gate on this very commit, whatever its
  # verdict. An older commit's review does not count — the gate reviews heads.
  reviewed=$(gh api --paginate "repos/$REPO/pulls/$n/reviews?per_page=100" \
    --jq ".[] | select(.user.login == \"$GATE_LOGIN\" and .commit_id == \"$sha\") | .id" 2>/dev/null || echo unread)
  if [ -n "$reviewed" ]; then
    [ "$reviewed" = "unread" ] && echo "::warning::PR #$n: reviews unreadable; skipped."
    continue
  fi
  # One line per check run: status, conclusion, completed_at as epoch seconds.
  # jq's fromdateiso8601 refuses fractional seconds, so they are dropped first.
  if ! runs=$(gh api --paginate "repos/$REPO/commits/$sha/check-runs?per_page=100" \
    --jq '.check_runs[] | "\(.status) \(.conclusion // "none") \(if .completed_at then (.completed_at | sub("\\.[0-9]+Z$"; "Z") | fromdateiso8601) else 0 end)"' 2>/dev/null); then
    echo "::warning::PR #$n: check runs on $sha unreadable; skipped."
    continue
  fi
  if [ -z "$runs" ]; then
    echo "PR #$n: no check runs on $sha yet."
    continue
  fi
  if printf '%s\n' "$runs" | awk '$1 != "completed"' | grep -q .; then
    echo "PR #$n: checks still running on $sha."
    continue
  fi
  if printf '%s\n' "$runs" | awk '$2 ~ /^(failure|cancelled|timed_out|action_required|startup_failure|stale)$/' | grep -q .; then
    # Red: pr-lifecycle does not dispatch a red PR, so the gate owes it nothing.
    echo "PR #$n: a check on $sha is red; not the gate's turn."
    continue
  fi
  since=$(printf '%s\n' "$runs" | awk '{print $3}' | sort -n | tail -n1)
  waited=$(( (NOW - since) / 60 ))
  if [ "$waited" -lt "$WAIT_MINUTES" ]; then
    echo "PR #$n: green for ${waited} min; within ${WAIT_MINUTES}."
    continue
  fi
  echo "PR #$n: green since $(iso "$since") with no gate review on $sha."
  echo "$n $sha $since" >> "$SILENT"
done

# The health issue: found by its marker among open `automation-health` issues.
ISSUE=$(gh api --paginate "repos/$REPO/issues?state=open&labels=automation-health&per_page=100" \
  --jq ".[] | select(.pull_request == null) | select((.body // \"\") | contains(\"$ISSUE_MARK\")) | .number" 2>/dev/null | head -n1 || true)

if [ ! -s "$SILENT" ]; then
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
  have=$(gh api --paginate "repos/$REPO/issues/$n/comments?per_page=100" \
    --jq ".[] | select((.body // \"\") | contains(\"$mark\")) | .id" 2>/dev/null | head -n1 || true)
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
