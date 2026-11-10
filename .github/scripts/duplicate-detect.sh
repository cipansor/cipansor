#!/bin/sh
# Flag an open issue as a duplicate of another open issue when their titles are
# the same once normalised. Run on `issues.opened` and daily by
# duplicate-detect.yml.
#
# Why this exists: the *enforcement* half of the duplicate lifecycle was already
# deterministic (`duplicate-sweep.sh` warns once, then closes after a grace
# period), but the *detection* half was not — it was one instruction inside the
# `Triase issue` prompt (`SDLC 15`), so a family no triage run noticed stayed
# open until a person closed it by hand. That is what happened to the
# deploy-watch family: #944 and #957 were closed by hand, and #958 sat open a day
# because no triage run ever labelled it `duplicate`.
#
# The signal is deliberately narrow: two titles equal after lowercasing,
# collapsing whitespace, dropping trailing punctuation and masking digit runs of
# `MASK_MIN` or more (so "run 42569593649" and "run 38324975861" match). That
# catches a family an automation re-opens under a fixed title while leaving the
# semantic "these two are about the same thing" to the triage owner, which reads
# the issue. A fuzzy match here would label unrelated issues, and a wrong
# `duplicate` costs a maintainer's time to undo. A title shorter than
# `MIN_KEY_LEN` is skipped: a generic one-word title ("Bug", "Login") is not
# evidence of a duplicate.
#
# It labels at most once per issue: the link comment carries a marker, and its
# presence stops a second pass. The label it applies is the same one the triage
# owner applies, so `duplicate-sweep.sh` then owns the warn-and-close.
#
# A removal of the label is a verdict, but only from the account the fleet and
# the maintainers drive: `DUPLICATE_DETECT_TRUSTED_ACTOR` (default `cipansor-bot`).
# Before labelling, the issue's `unlabeled` events are read; if that account
# removed `duplicate`, the detector leaves the issue alone for good. A removal by
# any other actor — a human, another automation, `github-actions[bot]` — is not a
# verdict: the label is re-applied on the next sweep, and because the link comment
# is already there it is only the label that comes back, never a second comment.
# The detector's own rollback (below) is not a verdict either: a trusted `labeled`
# immediately followed by a trusted `unlabeled` is the label added and removed in
# one run because the comment failed, so the issue is processed again. The login
# is matched exactly, so a look-alike ("cipansor-bot-fake") cannot impersonate it.
#
# The marker is the *only* evidence that the detector linked the issue, so the
# label and its marker must never be left out of step: the label is applied first
# (so a concurrent run and `duplicate-sweep.sh` see it), and if the link comment
# then fails the label is rolled back — retried once — rather than left without
# its marker. If the rollback also fails the run warns loudly; the next sweep
# re-checks the issue from a clean state.
#
# A recurrence is not a duplicate: the candidate set is the OPEN issues, so an
# open issue whose only same-titled sibling is CLOSED is not labelled. A closed
# original that was fixed and a new issue that reappears is a regression, not a
# repeat, and only an open duplicate pair is a duplicate by this signal. Within a
# title group the earliest-open issue is the original and the rest are the
# duplicates; "earliest" is the lowest issue number, which is monotonic in
# creation order.
#
# Pull requests are never touched: the API lists a PR as an issue, so they are
# filtered out. A PR duplicate is a maintainer's judgement (`pr-duplicate.sh`
# only labels a candidate; docs/LABELS.md rule 4), and a PR must never carry the
# issue-lifecycle `duplicate` label.
#
# Usage: duplicate-detect.sh
# Env:   GH_TOKEN, REPO (owner/name)
#        DUPLICATE_DETECT_MASK_MIN (default 6; digit runs this long or longer
#          become a single `#`, so a run id or a long counter in a fixed title
#          matches while a year or a small number stays significant)
#        DUPLICATE_DETECT_MIN_KEY_LEN (default 12; a shorter normalised title is
#          skipped as too generic to be evidence)
#        DUPLICATE_DETECT_TRUSTED_ACTOR (default `cipansor-bot`; the only account
#          whose removal of the `duplicate` label is a permanent "not a duplicate")
#        DUPLICATE_DETECT_DRY_RUN=1 prints what it would do, writing nothing
set -eu

REPO="${REPO:?REPO is required}"
DRY="${DUPLICATE_DETECT_DRY_RUN:-}"
MARK="<!-- duplicate-detect -->"
MASK_MIN="${DUPLICATE_DETECT_MASK_MIN:-6}"
MIN_KEY_LEN="${DUPLICATE_DETECT_MIN_KEY_LEN:-12}"
TRUSTED="${DUPLICATE_DETECT_TRUSTED_ACTOR:-cipansor-bot}"

# Every OPEN issue, one `number<TAB>key<TAB>labels` row (a PR is filtered out by
# its `pull_request` field). The key is the normalised title; the guard test
# asserts against the same expression. A failed read exits non-zero so the caller
# warns instead of treating an empty list as "no duplicates".
index_rows() {
  raw=$(gh api --paginate "repos/$REPO/issues?state=open&per_page=100" 2>/dev/null) || return 1
  [ -n "$raw" ] || return 1
  printf '%s' "$raw" | jq -rs --argjson d "$MASK_MIN" '
    (map(select(type == "array") | .[]) | map(select(.pull_request == null)))
    | .[]
    | [ (.number | tostring),
        (.title | ascii_downcase | gsub("\\s+"; " ") | sub("^ +"; "") | sub(" +$"; "")
          | sub("[.!?:;,]+$"; "") | gsub("[0-9]{" + ($d | tostring) + ",}"; "#")),
        ([.labels[].name] | join(",")) ]
    | @tsv' 2>/dev/null
}

# The pairs to act on: `key<TAB>original<TAB>duplicate`, one row per open issue
# that is not the earliest open issue of its title group. Empty when no title
# group holds two or more open issues, or the key is too short to be evidence.
pairs() {
  awk -F '\t' -v minlen="$MIN_KEY_LEN" '
    NF < 3 { next }
    { num[NR] = $1; key[NR] = $2; n = NR; count[$2]++ }
    END {
      for (i = 1; i <= n; i++) {
        if (length(key[i]) < minlen) continue
        if (!(key[i] in orig) || num[i] + 0 < orig[key[i]] + 0) orig[key[i]] = num[i]
      }
      for (i = 1; i <= n; i++) {
        if (length(key[i]) < minlen) continue
        if (count[key[i]] < 2) continue
        if (num[i] + 0 == orig[key[i]] + 0) continue
        print key[i] "\t" orig[key[i]] "\t" num[i]
      }
    }'
}

# The index row's label list for an issue, from the index already in memory.
labels_of() { # labels_of <number>
  printf '%s\n' "$INDEX" | awk -F '\t' -v n="$1" '$1 == n { print $3; exit }'
}

# Echoes `linked` when the detector already linked this issue, `unlinked` when
# the comments are readable without its marker, and `unreadable` when they cannot
# be read. A read failure must not read as "no marker" — labelling would stack a
# second comment — so the caller skips on `unreadable`. Echoing a word keeps the
# caller's `case` from depending on `$?` surviving a nested command.
link_state() { # link_state <number>
  if ! comments=$(gh api --paginate "repos/$REPO/issues/$1/comments?per_page=100" \
      --jq '.[].body' 2>/dev/null); then
    echo unreadable; return 0
  fi
  if printf '%s\n' "$comments" | grep -qF "$MARK"; then echo linked; else echo unlinked; fi
}

# Classifies the `duplicate`-label history of an issue into the action the caller
# should take. `$2` is the link state (`linked`/`unlinked`). Echoes one word:
#
#   verdict  — the trusted account removed the label as a maintainer's decision;
#              the detector leaves the issue alone for good.
#   relabel  — the label is gone but the link comment is there (`linked`) and the
#              removal was by an untrusted actor, so only the label comes back.
#   linked   — the link comment is there and no removal is recorded (the index is
#              probably stale): leave the issue alone.
#   proceed  — label and comment both belong (fresh issue, an untrusted removal
#              with no comment yet, or this detector's own rollback).
#   unreadable — the events could not be read.
#
# Only the trusted account's removal is a verdict, and a verdict needs the run to
# have completed: with a marker present any trusted removal is a verdict, but
# with no marker a trusted `labeled` immediately followed by a trusted `unlabeled`
# is this detector's own rollback (the label added and removed in one run because
# the comment failed) and is not. The login is matched exactly — never as a
# substring — so a look-alike ("cipansor-bot-fake") cannot impersonate it, and the
# `[bot]` suffix form (`cipansor-bot[bot]`) is accepted.
unlabel_state() { # unlabel_state <number> <linked|unlinked>
  if ! events=$(gh api --paginate "repos/$REPO/issues/$1/events?per_page=100" \
      --jq '.[] | select((.event=="labeled" or .event=="unlabeled") and .label.name=="duplicate") | "\(.event)\t\(.actor.login)"' 2>/dev/null); then
    echo unreadable; return 0
  fi
  printf '%s\n' "$events" | awk -F '\t' -v t="$TRUSTED" -v linked="$2" '
    function trusted(l) { return l == t || l == t "[bot]" }
    NF < 2 { next }
    {
      ev0 = ev1; l0 = l1; ev1 = $1; l1 = $2
      if ($1 == "unlabeled") { removed = 1; if (trusted($2)) trusted_removed = 1 }
    }
    END {
      rollback = (ev1 == "unlabeled" && trusted(l1) && ev0 == "labeled" && trusted(l0))
      if (linked == "linked" && trusted_removed) print "verdict"
      else if (linked == "linked" && removed) print "relabel"
      else if (linked == "linked") print "linked"
      else if (trusted_removed && !rollback) print "verdict"
      else print "proceed"
    }'
}

INDEX=$(index_rows) || { echo "::warning::could not read the issue index; nothing done."; exit 0; }
[ -n "$INDEX" ] || { echo "::warning::the issue index is empty; nothing done."; exit 0; }

# Iterate the pairs. A `while read` in a pipeline runs in a subshell, so the loop
# cannot set a variable for a summary; each action prints its own line.
printf '%s\n' "$INDEX" | pairs | while IFS="$(printf '\t')" read -r key orig dup; do
  [ -n "${dup:-}" ] || continue

  case ",$(labels_of "$dup")," in
    *,duplicate,* | *,duplicate-pr,*)
      echo "#$dup already carries a duplicate label; left alone."
      continue ;;
  esac

  LINK="$(link_state "$dup")"
  case "$LINK" in
    unreadable)
      echo "::warning::#$dup: comments unreadable; not labelling (would risk a second link)."
      continue ;;
  esac

  case "$(unlabel_state "$dup" "$LINK")" in
    verdict)
      echo "#$dup: label duplicate pernah dicabut $TRUSTED; left alone."
      continue ;;
    relabel)
      if gh issue edit "$dup" --repo "$REPO" --add-label duplicate >/dev/null 2>&1; then
        echo "Re-applied the duplicate label on #$dup (removed by an untrusted actor); the link comment was kept."
      else
        echo "::error::could not re-apply the duplicate label on #$dup."
      fi
      continue ;;
    linked)
      echo "#$dup was already linked by the detector; left alone."
      continue ;;
    unreadable)
      echo "::warning::#$dup: events unreadable; not labelling (a trusted removal could be missed)."
      continue ;;
  esac

  if [ -n "$DRY" ]; then
    echo "would label #$dup as a duplicate of #$orig (title '$key')."
    continue
  fi

  if ! gh issue edit "$dup" --repo "$REPO" --add-label duplicate >/dev/null 2>&1; then
    echo "::error::could not label #$dup as a duplicate of #$orig."
    continue
  fi

  BODY="Issue ini punya judul yang sama dengan #$orig setelah dinormalkan, jadi ditandai \`duplicate\` secara deterministik (\`duplicate-detect.yml\`). \`Duplicate sweep\` akan menutupnya dalam 7 hari bila tidak ditunjukkan berbeda — sunting deskripsi, balas dengan alasannya, atau minta \`$TRUSTED\` mencabut label \`duplicate\`. Pencabutan label oleh \`$TRUSTED\` membatalkan penutupan dan pendeteksi tidak akan memasangnya lagi; pencabutan oleh akun lain bisa dipasang ulang pada sapuan berikutnya.

$MARK"
  # The marker comment is the only evidence the detector linked the issue: it is
  # what tells a later sweep that the label was removed on purpose, and it is what
  # lets unlabel_state tell this run's rollback from a maintainer's verdict. So
  # the label goes first (a concurrent run and duplicate-sweep.sh must see it),
  # and a failed comment rolls the label back — retried once — rather than
  # leaving the two out of step.
  if ! gh issue comment "$dup" --repo "$REPO" --body "$BODY" >/dev/null 2>&1; then
    rolled_back=""
    for _attempt in 1 2; do
      if gh issue edit "$dup" --repo "$REPO" --remove-label duplicate >/dev/null 2>&1; then
        rolled_back="1"; break
      fi
      sleep 2
    done
    if [ -n "$rolled_back" ]; then
      echo "::warning::could not post the link on #$dup; removed the label again so it is not left without its marker."
    else
      echo "::error::could not post the link on #$dup, and could not remove the label either; the next sweep re-checks it."
    fi
    continue
  fi
  echo "Labelled #$dup as a duplicate of #$orig (title '$key')."
done

echo "Done. A duplicate label is a candidate: duplicate-sweep.sh warns, then closes after the grace period, and a removal of the label by $TRUSTED cancels it for good."
