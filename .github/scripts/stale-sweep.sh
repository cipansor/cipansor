#!/bin/sh
# Age out issues that have gone quiet. Run daily by stale-sweep.yml.
#
# This replaces the `Penjaga issue` OpenHands automation (SDLC 21), which was
# disabled by the maintainer (#677) and had never closed a single issue: it
# spent a 1800s sandbox to decide a label and a timestamp, which is not a
# judgement an LLM is needed for. The timers are the same ones its prompt
# carried; only the executor changed.
#
# One open issue at a time, skipping pull requests and anything labelled
# `duplicate` (the duplicate sweep owns those):
#
#   needs-info   warned at 13 days, closed not-planned at 20
#   question     `stale` at 8 days, closed not-planned at 15
#   anything else `stale` at 90 days, closed not-planned at 104
#
# The warn day is the close day minus the grace window, so the close still
# happens on the day the old prompt named while the author gets a warning
# first. A maintainer who replies, or who removes the label, keeps the issue
# open: every run re-reads the labels and the comments.
#
# Never closed, whatever the timer says: `pending-maintainer`, `ready`,
# `blocked`, `in-progress`, and any issue a maintainer commented on since the
# warning. Never a pull request.
#
# It holds no state between runs. The warning's timestamp is read back from the
# marker in its own comment, and "did anyone reply" is answered by comparing
# each comment's `created_at` with that timestamp. `updatedAt` is not usable for
# this: a later automated comment bumps it, so a reply made before that comment
# would be invisible.
#
# Usage: stale-sweep.sh
# Env:   GH_TOKEN, REPO, BOT_LOGIN (default cipansor-bot)
#        STALE_SWEEP_DRY_RUN=1 prints what it would do without writing anything
set -eu

REPO="${REPO:?REPO is required}"
BOT_LOGIN="${BOT_LOGIN:-cipansor-bot}"
DRY="${STALE_SWEEP_DRY_RUN:-}"

# The account that posts every automated comment. A comment by it, or by any
# GitHub App (`*[bot]`), is automated and must not count as a human reply —
# otherwise one bot comment keeps an issue open forever. The guard is by author,
# not by the AI-disclosure footer: `cipansor-bot` is a bot account, so its name
# already says the comment is automated and no footer is needed (#680).
MARK="<!-- stale-sweep:warned -->"
AT_MARK="stale-sweep:at:"

# Days of quiet before the warning, and before the close. The close day is what
# the retired prompt named; the warn day is that minus the grace window.
NEEDS_INFO_WARN=13
NEEDS_INFO_CLOSE=20
QUESTION_WARN=8
QUESTION_CLOSE=15
IDLE_WARN=90
IDLE_CLOSE=104

# Labels that exempt an issue from the sweep entirely. `duplicate` is handled by
# duplicate-sweep.sh and must not be touched by a second closer.
EXEMPT='pending-maintainer ready blocked in-progress duplicate'

NOW=$(date -u +%s)

# Every write goes through these, so DRY_RUN proves the whole decision path
# without touching a live issue.
say()   { echo "  [dry-run] $*"; }
write_comment() { # write_comment <number> <body>
  if [ -n "$DRY" ]; then say "would comment on #$1"; else gh issue comment "$1" --repo "$REPO" --body "$2"; fi
}
write_labels() { # write_labels <number> <--add-label|--remove-label> <label>
  if [ -n "$DRY" ]; then say "would $2 $3 on #$1"; else gh issue edit "$1" --repo "$REPO" "$2" "$3" >/dev/null 2>&1 || true; fi
}
write_close() { # write_close <number> <body>
  if [ -n "$DRY" ]; then say "would close #$1 (not planned)"; else gh issue close "$1" --repo "$REPO" --reason "not planned" --comment "$2"; fi
}
days_since() { # days_since <ISO-8601 timestamp> -> whole days
  date -u -d "$1" +%s 2>/dev/null | awk -v now="$NOW" '{ printf "%d", (now - $1) / 86400 }'
}

# --- the rule for one issue -------------------------------------------------
# Prints "<warn_days> <close_days>" for the issue's labels, or nothing when it
# carries an exempt label.
rule_for() { # rule_for <labels-newline-separated>
  for l in $EXEMPT; do
    printf '%s\n' "$1" | grep -qxF "$l" && return 0
  done
  if printf '%s\n' "$1" | grep -qxF 'needs-info'; then
    echo "$NEEDS_INFO_WARN $NEEDS_INFO_CLOSE"
  elif printf '%s\n' "$1" | grep -qxF 'question'; then
    echo "$QUESTION_WARN $QUESTION_CLOSE"
  else
    echo "$IDLE_WARN $IDLE_CLOSE"
  fi
}

# One listing for every open issue, then one comment fetch per issue that needs
# one. `gh issue list` never returns a pull request (unlike the REST
# `issues` endpoint), so the sweep cannot close a PR by accident. The fields are
# joined with `|`, not a tab: a `for` loop splits on whitespace and would break
# each row into three words.
ISSUES=$(gh issue list --repo "$REPO" --state open --limit 500 \
  --json number,createdAt,labels \
  --jq '.[] | "\(.number)|\(.createdAt)|\([.labels[].name] | join(","))"')

printf '%s\n' "$ISSUES" | while IFS='|' read -r n CREATED LABEL_CSV; do
  [ -n "$n" ] || continue
  LABELS=$(printf '%s' "$LABEL_CSV" | tr ',' '\n')

  RULE=$(rule_for "$LABELS")
  [ -n "$RULE" ] || { echo "Issue #$n is exempt; leaving it alone."; continue; }
  WARN_DAYS=$(echo "$RULE" | cut -d' ' -f1)
  CLOSE_DAYS=$(echo "$RULE" | cut -d' ' -f2)

  # Every comment, oldest first, as tab-separated created_at / author / body.
  # --paginate so an issue with more than one page of comments is not
  # truncated: a lone `?per_page=100` would omit a later reply and the sweep
  # would close on top of it. `gh --paginate` puts a bare newline between
  # pages; the comparisons below drop it (an empty first field is less than any
  # timestamp), so the separator cannot be read as a reply.
  RAW=$(gh api --paginate "repos/$REPO/issues/$n/comments?per_page=100" \
    --jq '.[] | "\(.created_at)\t\(.user.login)\t\(.body | gsub("\n"; " ") | gsub("\t"; " "))"' 2>/dev/null || true)

  # The last time a person (not the fleet, not a GitHub App) touched the issue.
  # A maintainer's comment counts: it is a person, and it is exactly the signal
  # that should keep an issue open.
  LAST_HUMAN=$(printf '%s\n' "$RAW" \
    | awk -F '\t' -v bot="$BOT_LOGIN" '$2 != bot && $2 !~ /\[bot\]$/ && $1 != "" { t = $1 } END { print t }' || true)
  LAST_HUMAN="${LAST_HUMAN:-$CREATED}"
  IDLE=$(days_since "$LAST_HUMAN")

  # The warning this sweep already posted, if any.
  WARNED_AT=$(printf '%s\n' "$RAW" | grep -F "$MARK" | head -1 | cut -f1 || true)

  if [ -n "$WARNED_AT" ]; then
    # A person replied after the warning: the issue is alive. Drop the `stale`
    # label so the label and the comments do not disagree about its state.
    REPLY=$(printf '%s\n' "$RAW" \
      | awk -F '\t' -v warned="$WARNED_AT" -v bot="$BOT_LOGIN" \
          '$1 > warned && $2 != bot && $2 !~ /\[bot\]$/ { line = $1 } END { print line }' || true)
    if [ -n "$REPLY" ]; then
      echo "Issue #$n has a reply after the warning; leaving it open."
      printf '%s\n' "$LABELS" | grep -qxF 'stale' && write_labels "$n" --remove-label 'stale'
      continue
    fi
    if [ "$IDLE" -lt "$CLOSE_DAYS" ]; then
      echo "Issue #$n warned $(days_since "$WARNED_AT")d ago; within the grace period."
      continue
    fi
    write_close "$n" "Menutup karena tidak ada aktivitas selama $IDLE hari. Buka lagi bila masih berlaku, atau balas sebelum timer berikutnya. $MARK"
    echo "Closed issue #$n as stale after $IDLE quiet days."
    continue
  fi

  if [ "$IDLE" -ge "$CLOSE_DAYS" ]; then
    # Already past the close day and never warned: warn now, close on the next
    # run rather than closing with no notice. The author still gets a window.
    write_comment "$n" "Issue ini tidak ada aktivitas selama $IDLE hari dan akan ditutup otomatis pada pemeriksaan berikutnya. Balas, atau hapus labelnya, untuk menjaganya tetap terbuka. $MARK

<!-- $AT_MARK$(date -u +%Y-%m-%dT%H:%M:%SZ) -->"
    echo "Warned issue #$n (idle ${IDLE}d, past the ${CLOSE_DAYS}d close day)."
    continue
  fi

  if [ "$IDLE" -ge "$WARN_DAYS" ]; then
    printf '%s\n' "$LABELS" | grep -qxF 'stale' || write_labels "$n" --add-label 'stale'
    write_comment "$n" "Issue ini tidak ada aktivitas selama $IDLE hari, jadi ditandai \`stale\` dan akan ditutup otomatis setelah $CLOSE_DAYS hari tanpa balasan. Balas, atau hapus label \`stale\`, untuk menjaganya tetap terbuka. $MARK

<!-- $AT_MARK$(date -u +%Y-%m-%dT%H:%M:%SZ) -->"
    echo "Warned issue #$n (idle ${IDLE}d, marked stale)."
    continue
  fi

  echo "Issue #$n is active (idle ${IDLE}d); nothing to do."
done
