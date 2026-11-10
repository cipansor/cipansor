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
# presence stops a second pass. That is also what respects a person's verdict —
# a maintainer who removes the `duplicate` label after a warning is answering
# "not a duplicate", and re-adding it would overrule them. The label it applies
# is the same one the triage owner applies, so `duplicate-sweep.sh` then owns the
# warn-and-close, and a maintainer's label removal still cancels the close.
#
# The marker is the *only* evidence that the detector ran, so the label and its
# marker must never be left out of step: the label is applied first (so a
# concurrent run and `duplicate-sweep.sh` see it), and if the link comment then
# fails the label is rolled back. A label with no marker would, after a
# maintainer removes it, be re-applied by the next sweep — overruling the very
# verdict the marker exists to respect. If the rollback also fails the run warns
# loudly; the next sweep re-checks the issue from a clean state.
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
#        DUPLICATE_DETECT_DRY_RUN=1 prints what it would do, writing nothing
set -eu

REPO="${REPO:?REPO is required}"
DRY="${DUPLICATE_DETECT_DRY_RUN:-}"
MARK="<!-- duplicate-detect -->"
MASK_MIN="${DUPLICATE_DETECT_MASK_MIN:-6}"
MIN_KEY_LEN="${DUPLICATE_DETECT_MIN_KEY_LEN:-12}"

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

  case "$(link_state "$dup")" in
    linked)
      echo "#$dup was already linked by the detector; left alone."
      continue ;;
    unreadable)
      echo "::warning::#$dup: comments unreadable; not labelling (would risk a second link)."
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

  BODY="Issue ini punya judul yang sama dengan #$orig setelah dinormalkan, jadi ditandai \`duplicate\` secara deterministik (\`duplicate-detect.yml\`). \`Duplicate sweep\` akan menutupnya dalam 7 hari bila tidak ditunjukkan berbeda — sunting deskripsi, balas dengan alasannya, atau minta maintainer mencabut label \`duplicate\`. Menghapus label itu membatalkan penutupan, dan pendeteksi tidak akan memasangnya lagi.

$MARK"
  # The marker comment is the only evidence the detector ran: without it a
  # maintainer's label removal would be undone by the next sweep. So the label
  # goes first (a concurrent run and duplicate-sweep.sh must see it), and a
  # failed comment rolls the label back rather than leaving the two out of step.
  if ! gh issue comment "$dup" --repo "$REPO" --body "$BODY" >/dev/null 2>&1; then
    if gh issue edit "$dup" --repo "$REPO" --remove-label duplicate >/dev/null 2>&1; then
      echo "::warning::could not post the link on #$dup; removed the label again so it is not left without its marker."
    else
      echo "::error::could not post the link on #$dup, and could not remove the label either; the next sweep re-checks it."
    fi
    continue
  fi
  echo "Labelled #$dup as a duplicate of #$orig (title '$key')."
done

echo "Done. A duplicate label is a candidate: duplicate-sweep.sh warns, then closes after the grace period, and a maintainer's label removal cancels it."
