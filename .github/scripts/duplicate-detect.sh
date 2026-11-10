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
# A removal of the label is a verdict, but only from the account the triage owner
# and the maintainers drive: `DUPLICATE_DETECT_TRUSTED_ACTOR` (default
# `cipansor-bot`). Before labelling, the issue's `unlabeled` history is read; if
# that account removed `duplicate`, the detector leaves the issue alone for good.
# A removal by any other actor is not a verdict: the label is re-applied on the
# next sweep, and because the link comment is already there it is only the label
# that comes back, never a second comment.
#
# That rule is unambiguous because the detector never removes a label itself: the
# link comment is written *before* the label, so a failed comment leaves nothing
# to roll back and a failed label is simply re-applied next sweep. There is no
# rollback to tell apart from a maintainer's removal, and no marker a third party
# could forge to suppress one — a removal by the trusted account is always a
# decision. The discriminator is the actor, never the closeness of two events: a
# triage removal by `cipansor-bot` that lands beside a label-add is a decision,
# and a removal by anyone else (a human, `github-actions[bot]`, another
# automation) is not. The login is matched exactly, never as a substring, so a
# look-alike ("cipansor-bot-fake") cannot impersonate it; the `[bot]` suffix form
# (`cipansor-bot[bot]`) is accepted.
#
# The link comment is the only evidence the detector linked the issue, so it is
# written first: if it fails, nothing was written and the next sweep retries from
# a clean state; if the label then fails, the marker is already there and the next
# sweep re-applies just the label. The label is never left without its marker, and
# the marker never without a chance to get its label.
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
# should take, given that the issue does NOT carry the label (the caller checked).
# Echoes one word:
#
#   verdict  — the trusted account removed the label as a maintainer's decision;
#              the detector leaves the issue alone for good.
#   apply    — the label belongs: re-apply it (the caller also writes the link
#              comment when it is not there yet).
#   unreadable — the events could not be read.
#
# The discriminator is the actor of the removal, never the closeness of two
# events. A removal by the trusted account is always a verdict — the detector
# never removes a label itself, so there is no rollback to confuse with one — and
# a removal by anyone else (a human, `github-actions[bot]`, another automation) is
# not. The login is matched exactly — never as a substring — so a look-alike
# ("cipansor-bot-fake") cannot impersonate it; the `[bot]` suffix form
# (`cipansor-bot[bot]`) is accepted.
unlabel_state() { # unlabel_state <number>
  if ! actors=$(gh api --paginate "repos/$REPO/issues/$1/events?per_page=100" \
      --jq '.[] | select(.event=="unlabeled" and .label.name=="duplicate") | .actor.login' 2>/dev/null); then
    echo unreadable; return 0
  fi
  if printf '%s\n' "$actors" | grep -qxF "$TRUSTED" \
      || printf '%s\n' "$actors" | grep -qxF "$TRUSTED[bot]"; then
    echo verdict
  else
    echo apply
  fi
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

  case "$(unlabel_state "$dup")" in
    verdict)
      echo "#$dup: label duplicate pernah dicabut $TRUSTED; left alone."
      continue ;;
    unreadable)
      echo "::warning::#$dup: events unreadable; not labelling (a trusted removal could be missed)."
      continue ;;
  esac

  if [ -n "$DRY" ]; then
    echo "would label #$dup as a duplicate of #$orig (title '$key')."
    continue
  fi

  BODY="Issue ini punya judul yang sama dengan #$orig setelah dinormalkan, jadi ditandai \`duplicate\` secara deterministik (\`duplicate-detect.yml\`). \`Duplicate sweep\` akan menutupnya dalam 7 hari bila tidak ditunjukkan berbeda — sunting deskripsi, balas dengan alasannya, atau minta \`$TRUSTED\` mencabut label \`duplicate\`. Pencabutan label oleh \`$TRUSTED\` membatalkan penutupan dan pendeteksi tidak akan memasangnya lagi; pencabutan oleh akun lain bisa dipasang ulang pada sapuan berikutnya.

$MARK"
  # The comment is written before the label. The comment is the only evidence the
  # detector linked the issue, and the label is what `duplicate-sweep.sh` acts on,
  # so the order that cannot leave them out of step is comment-then-label: a failed
  # comment writes nothing (next sweep retries from a clean state), and a failed
  # label leaves the marker in place, so the next sweep reaches here again with the
  # comment already written and re-applies just the label. The detector therefore
  # never removes a label, and a trusted removal is always a maintainer's decision.
  if [ "$LINK" = unlinked ]; then
    if ! gh issue comment "$dup" --repo "$REPO" --body "$BODY" >/dev/null 2>&1; then
      echo "::error::could not post the link on #$dup; nothing written, the next sweep retries."
      continue
    fi
  fi
  if ! gh issue edit "$dup" --repo "$REPO" --add-label duplicate >/dev/null 2>&1; then
    echo "::warning::could not label #$dup as a duplicate of #$orig; the link is written, the next sweep re-applies the label."
    continue
  fi
  echo "Labelled #$dup as a duplicate of #$orig (title '$key')."
done

echo "Done. A duplicate label is a candidate: duplicate-sweep.sh warns, then closes after the grace period, and a removal of the label by $TRUSTED cancels it for good."
