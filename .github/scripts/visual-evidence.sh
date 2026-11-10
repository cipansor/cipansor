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

img_re='user-images\.githubusercontent\.com|private-user-images\.githubusercontent\.com|github\.com/user-attachments/assets/|https?://[^ )]+\.(png|jpe?g|gif|webp|mp4|webm)'

# The Evidence requirement is a *before* visual AND an *after* visual. Split the
# body at the first line that IS an after marker; each region must contain media.
# A body with only an After image leaves the Before region empty and keeps the
# reminder — the earlier single Boolean cleared it on any image anywhere.
# The marker is the first word of a line (`**After**`, `## After`, `After:`, the
# Indonesian `Sesudah`), optionally behind a Markdown list bullet (`- **After**`,
# `* Sesudah`) — the list form is what the reminder text below and most bodies
# use, so leaving it out kept the reminder up on a body that already had the
# pair. It is the word at the start of a line, not the word anywhere: matching it
# anywhere split the body on a sentence such as "... after it passes" under
# `## Cara menguji`, hiding a real before/after pair.
marker='^[[:space:]]*([-*+][[:space:]]+)?(\*\*|#+[[:space:]]+)?[[:space:]]*(after|sesudah)([^[:alnum:]_]|$)'
before_part=$(printf '%s\n' "$body" | awk -v m="$marker" '{ if (tolower($0) ~ m) exit; print }')
after_part=$(printf '%s\n' "$body" | awk -v m="$marker" '{ if (tolower($0) ~ m) f = 1; if (f) print }')
has_before=0
has_after=0
printf '%s\n' "$before_part" | grep -qiE "$img_re" && has_before=1
printf '%s\n' "$after_part" | grep -qiE "$img_re" && has_after=1

find_comment() {
  # --paginate: a reminder past the first 100 comments would otherwise look
  # absent and be duplicated. tail -n1 keeps the newest marker comment.
  gh api --paginate "repos/$REPO/issues/$PR/comments?per_page=100" \
    --jq ".[] | select(.body | contains(\"$MARK\")) | .id" 2>/dev/null | tail -n1
}
CID="$(find_comment || true)"

need=0
[ "$touch_web" = "true" ] && { [ "$has_before" = "0" ] || [ "$has_after" = "0" ]; } && need=1

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
