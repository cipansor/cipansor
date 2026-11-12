#!/bin/sh
# Age out issues that have gone quiet. Run daily by stale-sweep.yml.
#
# This replaces the `Penjaga issue` OpenHands automation (SDLC 21), which was
# disabled by the maintainer (#677) and had never closed a single issue: it
# spent a 1800s sandbox to decide a label and a timestamp, which is not a
# judgement an LLM is needed for. The timers are the same ones its prompt
# carried; only the executor changed.
#
# One open issue at a time, skipping anything labelled `duplicate` (the duplicate
# sweep owns those):
#
#   question      `stale` at 8 days, closed not-planned at 15
#   anything else `stale` at 90 days, closed not-planned at 104
#
# It then ages out pull requests, which get no label at all — the taxonomy has no
# `stale` state for a PR:
#
#   no linked issue  warned at once, closed at 5 days if the issue is still
#                    missing (a PR must be born from a `ready` issue, #772)
#   linked issue     warned at 90 quiet days, closed at 104
#
# A draft or bot-authored PR is left alone. See the pull-request pass below.
#
# The warn day is the close day minus the grace window, so the close still
# happens on the day the old prompt named while the author gets a warning
# first. A maintainer who replies, or who removes the label, keeps the issue
# open: every run re-reads the labels, the comments and the description.
#
# Never closed, whatever the timer says: `ready`,
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
QUESTION_WARN=8
QUESTION_CLOSE=15
IDLE_WARN=90
IDLE_CLOSE=104

# Labels that exempt an issue from the sweep entirely. `duplicate` is handled by
# duplicate-sweep.sh and must not be touched by a second closer.
EXEMPT='ready blocked in-progress duplicate'

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
  if printf '%s\n' "$1" | grep -qxF 'question'; then
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

  # A `seen` marker governs only while no warning is newer. A warning posted
  # after it belongs to a later cycle, and its own hash is then the record that
  # decides whether the description changed since. Trusting an older `seen` hash
  # would read a description reverted to that old text as "unedited" and close an
  # issue that was edited today.
  SEEN_LIVE=""
  if [ -n "$SEEN_HASH" ]; then
    if [ -z "$WARNED_AT" ] || [ "$SEEN_AT" \> "$WARNED_AT" ]; then SEEN_LIVE=1; fi
  fi

  # A live `seen` marker that still describes the current body is the record of
  # the edit that opened this cycle.
  SEEN_MATCH=""
  [ -n "$SEEN_LIVE" ] && [ "$BODY_HASH" = "$SEEN_HASH" ] && SEEN_MATCH=1

  # An edit is new when the body matches neither hash on record: the live `seen`
  # marker's, or — once that marker is spent — the newest warning's. Comparing
  # against a hash the body already matches would re-detect the same edit on
  # every run (the hash is never rewritten), so the issue would restart its clock
  # forever and never close.
  EDITED=""
  if [ -n "$SEEN_LIVE" ]; then
    [ "$BODY_HASH" != "$SEEN_HASH" ] && EDITED=1
  elif [ -n "$RECORDED" ]; then
    [ "$BODY_HASH" != "$RECORDED" ] && EDITED=1
  fi

  # An edit seen after a warning spends that warning: a warning governs only the
  # cycle it opened, so the cycle the edit began must warn afresh before anything
  # closes. Without this the old warning would close an issue whose new cycle had
  # never been warned about.
  SEEN_SPENT=""
  [ -n "$SEEN_MATCH" ] && [ -n "$WARNED_AT" ] && SEEN_SPENT=1

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

# --- the pull-request pass ---------------------------------------------------
# A pull request ages out too, and the timers differ from an issue's because the
# defect differs. Neither rule adds a label: the taxonomy has no `stale` state
# for a pull request (`duplicate-pr` and the type labels belong to other
# automations), so a PR is only ever warned and closed.
#
#   no linked issue   warned at once; closed if 5 days pass with the issue still
#                     missing. The entry rule is that a PR must be born from a
#                     `ready` issue (#772), so a PR that never links one is
#                     outside the process, not merely quiet.
#   linked issue      the idle timer, with the same warning-first grace as an
#                     issue (90 quiet days warn, 104 close).
#
# A draft is left alone: it is the author's explicit "not ready yet", and
# `pr-lifecycle.sh` treats a draft as work still being iterated on rather than
# abandoned work. A bot-authored PR (Dependabot) is left alone too — it is
# exempt from the linking rule by design (`pr-description-checks.yml` skips it by
# author), so applying the rule here would close it for doing nothing wrong.
#
# Activity that ends a cycle: a person's comment, a review or diff comment (the
# reviewer talking, not just the author), and — for a PR that already has its
# issue — a head commit, counted from the commit's own date rather than from the
# PR's creation. A push does *not* end the no-issue cycle: it leaves the defect
# (no linked issue) untouched, so it must not buy another 5 days. Linking an
# issue does end it, which is what the `kind` in the marker detects.
PR_MARK="<!-- stale-sweep:pr:warned -->"
PR_NOISSUE_MARK="<!-- stale-sweep:pr:noissue -->"
HEAD_MARK="stale-sweep:head:"
NO_ISSUE_DAYS=5

write_pr_comment() { # write_pr_comment <number> <body>
  if [ -n "$DRY" ]; then say "would comment on PR #$1"; else gh pr comment "$1" --repo "$REPO" --body "$2"; fi
}
write_pr_close() { # write_pr_close <number> <body>
  if [ -n "$DRY" ]; then say "would close PR #$1"; else gh pr close "$1" --repo "$REPO" --comment "$2"; fi
}
# The warning records the moment, the kind of rule that fired (`noissue` marker
# present or not), and the head it saw, so a later run can tell a linked issue
# and a pushed commit from quiet.
write_pr_warning() { # write_pr_warning <number> <body> <kind> <head>
  if [ "$3" = "noissue" ]; then kind_marker=" $PR_NOISSUE_MARK"; else kind_marker=""; fi
  write_pr_comment "$1" "$2 $PR_MARK
<!-- $AT_MARK$(date -u +%Y-%m-%dT%H:%M:%SZ) -->$kind_marker <!-- $HEAD_MARK$4 -->"
}

PRS=$(gh pr list --repo "$REPO" --state open --limit 500 \
  --json number,isDraft,author,createdAt,headRefOid,closingIssuesReferences \
  --jq '.[] | "\(.number)|\(.isDraft)|\(.author.is_bot)|\(.createdAt)|\(.headRefOid)|\([.closingIssuesReferences[].number] | join(","))"')

printf '%s\n' "$PRS" | while IFS='|' read -r pr DRAFT IS_BOT CREATED HEAD ISSUES; do
  [ -n "$pr" ] || continue
  if [ "$DRAFT" = "true" ]; then echo "PR #$pr is a draft; leaving it alone."; continue; fi
  if [ "$IS_BOT" = "true" ]; then echo "PR #$pr is bot-authored; leaving it alone."; continue; fi

  if [ -n "$ISSUES" ]; then KIND=hasissue; else KIND=noissue; fi

  RAW=$(gh api --paginate "repos/$REPO/issues/$pr/comments?per_page=100" \
    --jq '.[] | "\(.created_at)\t\(.user.login)\t\(.body | gsub("\n"; " ") | gsub("\t"; " "))"' 2>/dev/null || true)

  # A review and a diff comment are activity too, and they live on their own
  # endpoints (`pulls/reviews`, `pulls/comments`) — the issue-comment list alone
  # would let a PR under active review be closed. Same tab-separated shape, so
  # the human/reply scans below cover them without a second pass. A pending
  # review has no `submitted_at` and is not activity yet.
  REVIEWS=$(gh api --paginate "repos/$REPO/pulls/$pr/reviews?per_page=100" \
    --jq '.[] | select(.submitted_at != null) | "\(.submitted_at)\t\(.user.login)\t\(.body // "" | gsub("\n"; " ") | gsub("\t"; " "))"' 2>/dev/null || true)
  DIFF_COMMENTS=$(gh api --paginate "repos/$REPO/pulls/$pr/comments?per_page=100" \
    --jq '.[] | "\(.created_at)\t\(.user.login)\t\(.body // "" | gsub("\n"; " ") | gsub("\t"; " "))"' 2>/dev/null || true)
  RAW=$(printf '%s\n%s\n%s' "$RAW" "$REVIEWS" "$DIFF_COMMENTS")

  LAST_HUMAN=$(printf '%s\n' "$RAW" \
    | awk -F '\t' -v bot="$BOT_LOGIN" '$2 != bot && $2 !~ /\[bot\]$/ && $1 != "" { t = $1 } END { print t }' || true)
  LAST_HUMAN="${LAST_HUMAN:-$CREATED}"

  # A head commit is the author working, so it is an activity timestamp too —
  # not merely a difference against the head a warning recorded. Without this the
  # idle clock kept counting from the comment/creation date, so a PR pushed today
  # but created 120 days ago read as 120 days idle and was closed a week later.
  # Only for a PR that has its issue: for a PR with none, a push leaves the
  # defect (no linked issue) untouched and must not buy another window.
  if [ "$KIND" = "hasissue" ] && [ -n "$HEAD" ]; then
    HEAD_AT=$(gh api "repos/$REPO/commits/$HEAD" --jq '.commit.committer.date' 2>/dev/null || true)
    [ -z "$HEAD_AT" ] || LAST_HUMAN=$(printf '%s\n%s\n' "$LAST_HUMAN" "$HEAD_AT" | sort | tail -1)
  fi

  WARNED_LINE=$(printf '%s\n' "$RAW" | grep -F "$PR_MARK" | tail -1 || true)
  WARNED_AT=$(printf '%s\n' "$WARNED_LINE" | cut -f1 || true)
  WARNED_HEAD=$(printf '%s\n' "$WARNED_LINE" | grep -oE "$HEAD_MARK[0-9a-f]+" | head -1 | cut -d: -f3 || true)
  WARNED_KIND=hasissue
  printf '%s\n' "$WARNED_LINE" | grep -qF "$PR_NOISSUE_MARK" && WARNED_KIND=noissue

  REPLY=$(printf '%s\n' "$RAW" \
    | awk -F '\t' -v warned="$WARNED_AT" -v bot="$BOT_LOGIN" \
        '$1 > warned && $2 != bot && $2 !~ /\[bot\]$/ { line = $1 } END { print line }' || true)
  PUSHED=""
  [ -n "$WARNED_HEAD" ] && [ "$HEAD" != "$WARNED_HEAD" ] && PUSHED=1

  IDLE=$(days_since "${LAST_HUMAN:-$CREATED}")

  if [ -n "$WARNED_AT" ]; then
    if [ -z "$REPLY" ]; then
      if [ "$KIND" = "noissue" ] && [ "$WARNED_KIND" = "noissue" ]; then
        # The clock runs from the warning and a push does not stop it: only
        # linking an issue (which changes the kind, above) or a reply does.
        WARNED_AGE=$(days_since "$WARNED_AT")
        if [ "$WARNED_AGE" -ge "$NO_ISSUE_DAYS" ]; then
          write_pr_close "$pr" "Menutup karena pull request ini tidak menautkan issue sama sekali selama $NO_ISSUE_DAYS hari setelah peringatan. Buka lagi dengan menyebut issue terbuka berlabel \`ready\` lewat \`Fixes #<n>\` di deskripsi. $PR_MARK"
          echo "Closed PR #$pr: still no linked issue after $NO_ISSUE_DAYS days."
        else
          echo "PR #$pr has no linked issue (warned ${WARNED_AGE}d ago); within the ${NO_ISSUE_DAYS}d window."
        fi
        continue
      fi
      if [ "$KIND" = "hasissue" ] && [ "$WARNED_KIND" = "hasissue" ] && [ -z "$PUSHED" ]; then
        WARNED_AGE=$(days_since "$WARNED_AT")
        if [ "$WARNED_AGE" -ge "$GRACE_DAYS" ] && [ "$IDLE" -ge "$IDLE_CLOSE" ]; then
          write_pr_close "$pr" "Menutup karena tidak ada aktivitas selama $IDLE hari. Buka lagi bila masih berlaku, atau dorong commit baru sebelum timer berikutnya. $PR_MARK"
          echo "Closed PR #$pr as stale after $IDLE quiet days."
        else
          echo "PR #$pr warned ${WARNED_AGE}d ago (idle ${IDLE}d); within the grace period."
        fi
        continue
      fi
      echo "PR #$pr changed state after its warning; the cycle restarts."
    else
      echo "PR #$pr has a reply after the warning; the cycle restarts."
    fi
  fi

  if [ "$KIND" = "noissue" ]; then
    write_pr_warning "$pr" "Pull request ini belum menautkan issue sama sekali. Tambahkan \`Fixes #<n>\` pada deskripsi yang menunjuk issue terbuka berlabel \`ready\`; tanpa itu PR ini ditutup otomatis dalam $NO_ISSUE_DAYS hari." "noissue" "$HEAD"
    echo "Warned PR #$pr: no linked issue."
    continue
  fi

  if [ "$IDLE" -ge "$IDLE_WARN" ]; then
    write_pr_warning "$pr" "Pull request ini tidak ada aktivitas selama $IDLE hari dan akan ditutup otomatis setelah $IDLE_CLOSE hari tanpa balasan atau commit baru." "hasissue" "$HEAD"
    echo "Warned PR #$pr (idle ${IDLE}d)."
    continue
  fi

  echo "PR #$pr is active (idle ${IDLE}d); nothing to do."
done
