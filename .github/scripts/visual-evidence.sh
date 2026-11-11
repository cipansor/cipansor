#!/bin/sh
# Visual-evidence check for UI changes (advisory, never a gate).
#
#   PR touches apps/web, body lacks a before or an after visual -> one reminder
#   PR does not touch apps/web, or has both                   -> remove the reminder
#
# It never fails, never labels and never changes the draft state. A "visual"
# counts as an image, a video, or a link to either (GitHub user-attachment URLs,
# raw/blob links to images, .png/.jpg/.gif/.webp/.mp4/.webm). Everything else is
# invisible to it, so it only ever asks — a reviewer judges the quality. Both
# sides are required: one After image does not satisfy the requirement for a
# Before.
#
# The split is anchored on a line that IS a marker (`**After**`, `## After`,
# `After:`, or the Indonesian `Sesudah`), not on the word "after" anywhere: a
# sentence under `## Cara menguji` that happens to contain "after" used to split
# the body and hide a valid Before/After pair.
#
# Usage: visual-evidence.sh <pr-number>
# Env:   GH_TOKEN, REPO (owner/name)
set -eu

PR="${1:?usage: visual-evidence.sh <pr-number>}"
REPO="${REPO:?REPO is required}"

MARK="<!-- visual-evidence -->"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT EXIT HUP INT TERM

gh pr view "$PR" --repo "$REPO" --json files,body > "$TMP"

touch_web="$(jq -r '[.files[].path] | map(select(startswith("apps/web/"))) | length > 0' "$TMP")"
body="$(jq -r .body "$TMP")"

# Lowercase on purpose: the count lowercases each line before matching, so
# `.PNG`/`.JPG` count like `.png` (the old `grep -iE` was case-insensitive).
img_re='user-images\.githubusercontent\.com|private-user-images\.githubusercontent\.com|github\.com/user-attachments/assets/|https?://[^ )]+\.(png|jpe?g|gif|webp|mp4|webm)'

# The Evidence requirement is a *before* visual AND an *after* visual. The check
# no longer splits the body at an after marker and reads each region for media:
# that split was fragile against prose. A bullet such as
# `- **Sesudah** — POST /portfolio dijawab 201` (a reproduction step, PR #1033)
# ends with an em dash, which the old marker accepted as punctuation, so the body
# split *before* the `| Sebelum | Sesudah |` screenshot table and the Before
# region came out empty — a complete pair still got the reminder.
#
# Instead the body is asked two independent questions:
#   * does it carry at least two media URLs? and
#   * does it label a before line AND an after line?
# A pair is present only when both hold. Prose cannot move a boundary because
# there is no boundary; a body with one image, or with two images and no labels,
# still gets the reminder.
#
# A label is the first word of a line (`Before`, `**Sesudah**`, `## After`,
# `- **Sebelum**`), never the word inside a sentence: "... after it passes"
# under `## Cara menguji` is not a label.
label_re() { printf '^[[:space:]]*([-*+][[:space:]]+)?(\\*\\*|#+[[:space:]]+)?[[:space:]]*(%s)([^[:alnum:]_]|$)' "$1"; }
before_re="$(label_re 'before|sebelum')"
after_re="$(label_re 'after|sesudah')"

# Media is grouped per side, not merely counted: two images on the *after* side
# and a text-only before used to satisfy "two media + both labels" and clear the
# reminder without any before evidence. Each labelled side owns the media that
# follows it until the next label, and a `| Sebelum | Sesudah |` table maps each
# column to its own side.
media=$(printf '%s\n' "$body" | awk -v img="$img_re" '
  function side_of(word) {
    w = tolower(word)
    # A table header may be bold (`| **Sebelum** | **Sesudah** |`), so strip
    # markdown emphasis and whitespace from both ends before matching.
    gsub(/^[[:space:]*_`]+/, "", w)
    gsub(/[[:space:]*_`]+$/, "", w)
    if (w ~ /^before([^a-z0-9_]|$)/ || w ~ /^sebelum([^a-z0-9_]|$)/) return "b"
    if (w ~ /^after([^a-z0-9_]|$)/  || w ~ /^sesudah([^a-z0-9_]|$)/) return "a"
    return ""
  }
  BEGIN { before = 0; after = 0; side = ""; intable = 0 }
  {
    line = $0
    if (line ~ /^[[:space:]]*\|/) {
      n = split(line, cells, "|")
      hasb = 0; hasa = 0
      delete nc
      for (i = 1; i <= n; i++) {
        s = side_of(cells[i])
        if (s != "") { nc[i] = s; if (s == "b") hasb = 1; else hasa = 1 }
      }
      if (hasb && hasa) {
        delete col
        for (i in nc) col[i] = nc[i]
        intable = 1; next
      }
      if (intable) {
        for (i = 1; i <= n; i++) {
          t = tolower(cells[i])
          c = gsub(img, "&", t)
          if (col[i] == "b") before += c
          else if (col[i] == "a") after += c
        }
        next
      }
    }
    l = line
    sub(/^[[:space:]]*([-*+][[:space:]]+)?/, "", l)
    sub(/^(\*\*|#+[[:space:]]+)/, "", l)
    s = side_of(l)
    if (s != "") side = s
    lt = tolower(line)
    c = gsub(img, "&", lt)
    if (side == "b") before += c
    else if (side == "a") after += c
  }
  END { printf "%d %d\n", before, after }
')
media_before=${media%% *}
media_after=${media##* }
has_pair=0
if [ "${media_before:-0}" -ge 1 ] && [ "${media_after:-0}" -ge 1 ]; then
  has_pair=1
fi

find_comment() {
  # --paginate: a reminder past the first 100 comments would otherwise look
  # absent and be duplicated. tail -n1 keeps the newest marker comment.
  gh api --paginate "repos/$REPO/issues/$PR/comments?per_page=100" \
    --jq ".[] | select(.body | contains(\"$MARK\")) | .id" 2>/dev/null | tail -n1
}
CID="$(find_comment || true)"

need=0
[ "$touch_web" = "true" ] && [ "$has_pair" = "0" ] && need=1

if [ "$need" = "1" ]; then
  cat > "$TMP" <<EOF
$MARK
Pull request ini mengubah \`apps/web\`, tetapi deskripsinya belum memuat
tangkapan visual sebelum dan sesudah. Mohon tambahkan:

- **Sebelum** — tangkapan layar atau video singkat perilaku lama.
- **Sesudah** — tampilan atau alur yang sama setelah perubahan.

Tempel lewat pengunggah GitHub (tautannya menjadi
\`user-images.githubusercontent.com\`) atau tautkan berkasnya. Ini pengingat,
bukan gerbang merge — agar peninjau dapat melihat perubahannya tanpa mengambil
branch.
EOF
  if [ -n "$CID" ]; then
    # -F, not -f: only a typed field reads `@file` (see pr-template-guard.sh).
    if gh api -X PATCH "repos/$REPO/issues/comments/$CID" -F body=@"$TMP" >/dev/null; then
      echo "PR #$PR: UI change without before/after visuals; reminder updated."
    else
      echo "::warning::could not update the visual reminder on PR #$PR"
    fi
  elif gh pr comment "$PR" --repo "$REPO" --body-file "$TMP" >/dev/null; then
    echo "PR #$PR: UI change without before/after visuals; reminder posted."
  else
    echo "::warning::could not post the visual reminder on PR #$PR"
  fi
elif [ -n "$CID" ]; then
  if gh api -X DELETE "repos/$REPO/issues/comments/$CID" >/dev/null; then
    echo "PR #$PR: visuals present (or no UI change); reminder removed."
  else
    echo "::warning::could not remove the visual reminder on PR #$PR"
  fi
else
  echo "PR #$PR: nothing to ask for."
fi
