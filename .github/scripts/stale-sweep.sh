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
# open: every run re-reads the labels, the comments and the description.
#
# Never closed, whatever the timer says: `pending-maintainer`, `ready`,
# `blocked`, `in-progress`, any issue a maintainer commented on since the
# warning, and an issue whose description changed since the warning — an edit
# with no comment is still an answer.
#
# It holds no state between runs. The warning's timestamp is read back from the
# marker in its own comment, and "did anyone reply" is answered by comparing
# each comment's `created_at` with that timestamp. `updatedAt` is not usable for
# this: a later automated comment bumps it, so a reply made before that comment
# would be invisible; the description is compared by hash instead, for the same
# reason.
#
# A warning only governs the cycle it opened. If a person acted after it (a
# comment, or an edit the hash check catches), the warning is spent: the sweep
# falls back to the idle timer and warns again when the issue goes quiet a
# second time, rather than reading the same old reply on every run and never
# closing anything.
#
# An edit that ends a cycle also restarts the clock. The idle timer counts from
# the last human comment or the creation date, and an edit leaves neither, so an
# edited issue would otherwise carry its old idle age into the new cycle and be
# closed on the next run — closing a description that was updated today. Because
# no GitHub field dates a *description* edit specifically (`lastEditedAt` is
# bumped by label changes too, and `updatedAt` by any comment), the sweep records
# the moment it first notices an edit in a `seen` marker on its own comment and
# measures the new cycle from there. `updatedAt` is not used as the clock: a
# routine bot comment would push the clock forward without a person acting.
#
# Usage: stale-sweep.sh
# Env:   GH_TOKEN, REPO, BOT_LOGIN (default cipansor-bot)
#        STALE_SWEEP_GRACE_DAYS (default 7, the minimum notice a warning buys)
#        STALE_SWEEP_DRY_RUN=1 prints what it would do without writing anything
set -eu

REPO="${REPO:?REPO is required}"
BOT_LOGIN="${BOT_LOGIN:-cipansor-bot}"
DRY="${STALE_SWEEP_DRY_RUN:-}"
# A warning may never close an issue on the very next run: even an issue already
# past its close day gets this many days of notice, so an author who was warned
# today is not closed tomorrow.
GRACE_DAYS="${STALE_SWEEP_GRACE_DAYS:-7}"

# The account that posts every automated comment. A comment by it, or by any
# GitHub App (`*[bot]`), is automated and must not count as a human reply —
# otherwise one bot comment keeps an issue open forever. The guard is by author,
# not by the AI-disclosure footer: `cipansor-bot` is a bot account, so its name
# already says the comment is automated and no footer is needed (#680).
MARK="<!-- stale-sweep:warned -->"
AT_MARK="stale-sweep:at:"
STALE_MARK="stale-sweep:stale"
HASH_MARK="stale-sweep:hash:"
SEEN_MARK="stale-sweep:seen"

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

body_hash() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

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

# One warning comment. It carries the timestamp marker, a `stale` marker when the
# sweep applied that label (so a later removal is recognisable as the maintainer
# cancelling), and a hash of the description as it stood at warn time (so a later
# edit with no comment is still visible).
write_warning() { # write_warning <number> <body-text> <marked-stale:0|1> <hash>
  if [ "$3" = "1" ]; then stale_marker=" <!-- $STALE_MARK -->"; else stale_marker=""; fi
  write_comment "$1" "$2 $MARK
<!-- $AT_MARK$(date -u +%Y-%m-%dT%H:%M:%SZ) -->$stale_marker <!-- $HASH_MARK$4 -->"
}

# A one-line marker recording when an edit was first seen, and the description
# hash it was seen at. It opens the new cycle's clock without a warning: warning
# an issue that was just updated would be the same bug one step later.
write_seen() { # write_seen <number> <hash>
  write_comment "$1" "<!-- $SEEN_MARK:at:$(date -u +%Y-%m-%dT%H:%M:%SZ) hash:$2 -->"
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
# `issues` endpoint), so the sweep cannot close a PR by accident. The scalar
# fields are joined with `|`, not a tab: a `for` loop splits on whitespace and
# would break each row into three words. The description is fetched separately
# (only for issues the sweep actually judges) because it can be long.
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

  # The newest warning this sweep posted, if any. Newest, not first: after a
  # reply the sweep warns again, and the fresh warning is the one in force. The
  # oldest would keep the original marker alive forever.
  WARNED_LINE=$(printf '%s\n' "$RAW" | grep -F "$MARK" | tail -1 || true)
  WARNED_AT=$(printf '%s\n' "$WARNED_LINE" | cut -f1 || true)

  # The newest `seen` marker: the edit the sweep last recorded. Newest wins for
  # the same reason the warning does.
  SEEN_LINE=$(printf '%s\n' "$RAW" | grep -F "$SEEN_MARK" | tail -1 || true)
  SEEN_AT=$(printf '%s\n' "$SEEN_LINE" | cut -f1 || true)
  SEEN_HASH=$(printf '%s\n' "$SEEN_LINE" | grep -oE "hash:[0-9a-f]+" | head -1 | cut -d: -f2 || true)

  # The description, fetched once per judged issue: the hash decides an edit, and
  # the warning records it. One call is the cost of holding no state.
  BODY=$(gh issue view "$n" --repo "$REPO" --json body --jq '.body // empty' 2>/dev/null || true)
  BODY_HASH=$(body_hash "$BODY")

  # A warning governs only while no person has acted since it was posted. A
  # human comment after the warning ends the cycle it opened; so does an edit to
  # the description, which leaves no comment to notice. Both are compared against
  # the newest warning's own markers, never `updatedAt` (a later automated
  # comment bumps `updatedAt` and would hide an earlier edit or reply). An edit
  # must end the cycle too: otherwise the stale hash would differ on every later
  # run, the sweep would skip the issue forever, and it could never close.
  REPLY=$(printf '%s\n' "$RAW" \
    | awk -F '\t' -v warned="$WARNED_AT" -v bot="$BOT_LOGIN" \
        '$1 > warned && $2 != bot && $2 !~ /\[bot\]$/ { line = $1 } END { print line }' || true)

  RECORDED=$(printf '%s\n' "$WARNED_LINE" | grep -oE "$HASH_MARK[0-9a-f]+" | head -1 | cut -d: -f3 || true)

  # A `seen` marker that still describes the current body is the live record of
  # the edit that opened this cycle.
  SEEN_MATCH=""
  [ -n "$SEEN_HASH" ] && [ "$BODY_HASH" = "$SEEN_HASH" ] && SEEN_MATCH=1

  # An edit is new when the body matches neither hash on record — the warning's
  # and the live `seen` marker's. Comparing against the warning alone would
  # re-detect the same edit on every run (its hash is never rewritten), so the
  # issue would restart its clock forever and never close.
  EDITED=""
  if [ -n "$RECORDED" ] || [ -n "$SEEN_HASH" ]; then
    [ "$BODY_HASH" != "$RECORDED" ] && [ "$BODY_HASH" != "$SEEN_HASH" ] && EDITED=1
  fi

  # An edit seen after a warning spends that warning: a warning governs only the
  # cycle it opened, so the cycle the edit began must warn afresh before anything
  # closes. Without this the old warning would close an issue whose new cycle had
  # never been warned about.
  SEEN_SPENT=""
  [ -n "$SEEN_MATCH" ] && [ -n "$WARNED_AT" ] && [ "$SEEN_AT" \> "$WARNED_AT" ] && SEEN_SPENT=1

  # The clock is the latest human comment, or the live edit, or the creation
  # date. The edit is included so an edited issue carries the age of its edit,
  # not the age that made it look closeable.
  CLOCK="${LAST_HUMAN:-$CREATED}"
  if [ -n "$SEEN_MATCH" ] && [ "$SEEN_AT" \> "$CLOCK" ]; then CLOCK="$SEEN_AT"; fi
  IDLE=$(days_since "$CLOCK")

  # The warning may close only a cycle it still governs: no reply, no unseen
  # edit, and no edit recorded after it (which began a cycle that must be warned
  # afresh first).
  if [ -n "$WARNED_AT" ] && [ -z "$REPLY" ] && [ -z "$EDITED" ] && [ -z "$SEEN_SPENT" ]; then
    # A warning that applied `stale` and whose `stale` label is now gone was
    # cancelled by a maintainer: removing the label is the documented way to say
    # "keep it open". Do not close on a decision that was already reversed.
    if printf '%s\n' "$WARNED_LINE" | grep -qF "$STALE_MARK"; then
      if ! printf '%s\n' "$LABELS" | grep -qxF 'stale'; then
        echo "Issue #$n had its stale label removed after the warning; leaving it open."
        continue
      fi
    fi

    # A warning buys at least GRACE_DAYS of notice: an issue already past its
    # close day when it was first warned must not close on the next run.
    WARNED_AGE=$(days_since "$WARNED_AT")
    if [ "$WARNED_AGE" -lt "$GRACE_DAYS" ] || [ "$IDLE" -lt "$CLOSE_DAYS" ]; then
      echo "Issue #$n warned ${WARNED_AGE}d ago (idle ${IDLE}d); within the grace period."
      continue
    fi

    write_close "$n" "Menutup karena tidak ada aktivitas selama $IDLE hari. Buka lagi bila masih berlaku, atau balas sebelum timer berikutnya. $MARK"
    echo "Closed issue #$n as stale after $IDLE quiet days."
    continue
  fi

  # The cycle is over: a person replied, or the description was edited. The
  # warning is spent, so the sweep falls back to the idle timer and warns again
  # when the issue goes quiet a second time, rather than reading the same old
  # reply (or the same stale hash) on every run.
  if [ -n "$WARNED_AT" ]; then
    if [ -n "$EDITED" ] || [ -n "$SEEN_SPENT" ]; then
      echo "Issue #$n was edited after the warning; the cycle restarts."
    else
      echo "Issue #$n has a reply after the warning; the cycle restarts."
    fi
  fi

  # Record the edit the first time it is seen, so the new cycle's clock starts
  # here rather than at the pre-edit idle age. Without this the next run would
  # read the old age and close a description that was updated today. The run that
  # records the edit treats the issue as idle zero: the edit just happened.
  if [ -n "$EDITED" ]; then
    write_seen "$n" "$BODY_HASH"
    echo "Recorded the edit to #$n; its idle clock restarts now."
    IDLE=0
  fi

  # Whether `stale` is set now, so the branch below can tell an actual change
  # from a no-op and the new warning's marker matches the label's real state.
  STALE_NOW=""
  printf '%s\n' "$LABELS" | grep -qxF 'stale' && STALE_NOW=1

  # Warn again when the issue has gone quiet past the warn day — or, if it is
  # already past the close day, warn now and let the next run (after the grace
  # window) do the closing rather than closing with no notice. A warning past the
  # close day does not mark `stale`, so a label left from the spent cycle is
  # dropped here; a warning at the warn day does mark `stale`, so it is applied
  # if missing and its marker records that it is present.
  if [ "$IDLE" -ge "$CLOSE_DAYS" ]; then
    [ -n "$STALE_NOW" ] && write_labels "$n" --remove-label 'stale'
    write_warning "$n" "Issue ini tidak ada aktivitas selama $IDLE hari dan akan ditutup otomatis pada pemeriksaan berikutnya. Balas, atau hapus labelnya, untuk menjaganya tetap terbuka." "0" "$BODY_HASH"
    echo "Warned issue #$n (idle ${IDLE}d, past the ${CLOSE_DAYS}d close day)."
    continue
  fi

  if [ "$IDLE" -ge "$WARN_DAYS" ]; then
    [ -z "$STALE_NOW" ] && write_labels "$n" --add-label 'stale'
    write_warning "$n" "Issue ini tidak ada aktivitas selama $IDLE hari, jadi ditandai \`stale\` dan akan ditutup otomatis setelah $CLOSE_DAYS hari tanpa balasan. Balas, atau hapus label \`stale\`, untuk menjaganya tetap terbuka." "1" "$BODY_HASH"
    echo "Warned issue #$n (idle ${IDLE}d, marked stale)."
    continue
  fi

  # Still active, and the cycle that ended left no live warning: a `stale` label
  # from the spent cycle no longer applies.
  if [ -n "$WARNED_AT" ] && [ -n "$STALE_NOW" ]; then
    write_labels "$n" --remove-label 'stale'
  fi

  echo "Issue #$n is active (idle ${IDLE}d); nothing to do."
done
