#!/bin/sh
# Hard gate on the pull-request template (a required check that fails).
#
#   body missing a required part  -> upsert one comment listing what is missing
#                                    AND exit 1 (the check fails)
#   body complete                 -> remove that comment, exit 0
#
# The template is a rule, not a nudge (upstream OpenHands enforces the same
# shape: a linked, ready issue and the Why/Summary/How-to-test sections). The
# required parts are: a `## HUMAN` note on a risky PR (see RISKY_PATHS), `## Why`, `## What changed`,
# `## Acceptance criteria`, `## How to test`, and at least one linked issue —
# `Fixes #<n>`, once per issue the PR resolves. Every number it closes must be
# an open issue (not a pull request) labelled `ready` or `bot-implement`. There
# is no "no linked issue" way out: a PR without an issue starts with an issue
# (#772). Dependabot writes its own body and is skipped by the workflow, keyed
# on the PR's author. The PR-language rule is enforced in the same place: the
# body must read as Indonesian prose (see docs/LABELS.md).
#
# Env (optional, set by the workflow): BASE_REF and DEFAULT_BRANCH. GitHub
# reads a closing keyword only on a PR into the default branch, so a PR into
# any other branch is told its `Fixes` will close nothing.
#
# A PR that changes anything under apps/web is additionally asked for before and
# after visuals by the visual-evidence workflow, not by this one.
#
# Usage: pr-template-guard.sh <pr-number>
# Env:   GH_TOKEN, REPO (owner/name)
set -eu

PR="${1:?usage: pr-template-guard.sh <pr-number>}"
REPO="${REPO:?REPO is required}"

MARK="<!-- pr-template-guard -->"
DIR="$(mktemp -d)"
RAW="$DIR/raw"
CLEAN="$DIR/clean"
trap 'rm -rf "$DIR"' EXIT EXIT HUP INT TERM

gh pr view "$PR" --repo "$REPO" --json body --jq .body > "$RAW"

# Visible text: strip HTML comments (including multi-line ones and the template
# placeholders) and fenced code, so placeholders do not count as content.
# Normalise CRLF/CR first: a body written through a Windows editor arrives with
# `## Why\r`, which never equals the `## Why` the section matcher compares
# against — every section then reads empty and a complete body is refused.
perl -0777 -pe 's/\r\n?/\n/g; s/<!--.*?-->//gs; s/```.*?```//gs' "$RAW" > "$CLEAN"
BODY="$(cat "$CLEAN")"

# The visible text of the section starting at "## <heading>", blank lines and
# bare list markers dropped. Operates on the cleaned body. A lone "-" is the
# template's placeholder for "What changed", not content; dropping only a marker
# with nothing after it keeps real bullets and the "- [x]" acceptance boxes.
section() {
  awk -v h="## $1" '
    $0 == h { f = 1; next }
    f && /^## / { f = 0 }
    f { print }
  ' "$CLEAN" | sed -e '/^[[:space:]]*$/d' -e '/^[[:space:]]*[-*+][[:space:]]*$/d'
}

visible_len() { printf '%s' "$1" | tr -d '\n' | wc -c | tr -d ' '; }

missing=""

# The human note is required only where a human must look before the merge: a
# PR labelled `security`, or one that touches the schema, migrations and data
# scripts, the production data scripts, or auth/RBAC. Every other PR is reviewed
# by the gate, and a human approves the weekly release (docs/SDLC-FLOW.md: four
# human gates). Decided by the owner on 2026-10-10 (#760). A guard that cannot
# read the labels or the files treats the PR as risky: it never waves through
# what it could not see. A Markdown file is never risky, even under one of these
# paths: apps/api/prisma/AGENTS.md is a guide, not a schema or a data script
# (#765).
RISKY_PATHS='^(apps/api/prisma/|apps/api/scripts/|apps/api/src/middleware/auth\.ts$|apps/api/src/modules/(auth|roles)/|apps/api/src/utils/(student-scope|resolve-unit-id)\.ts$|apps/web/middleware\.ts$|apps/web/src/lib/rbac\.ts$|packages/shared/src/roles\.ts$)'
risk=""
if PR_LABELS="$(gh pr view "$PR" --repo "$REPO" --json labels --jq '[.labels[].name] | join(",")')"; then
  case ",$PR_LABELS," in *,security,*) risk="berlabel \`security\`" ;; esac
else
  risk="label PR tidak terbaca"
fi
if [ -z "$risk" ]; then
  if FILES="$(gh api --paginate "repos/$REPO/pulls/$PR/files?per_page=100" --jq '.[].filename')"; then
    HIT="$(printf '%s\n' "$FILES" | grep -E "$RISKY_PATHS" | grep -vE '\.md$' | head -n1 || true)"
    [ -z "$HIT" ] || risk="mengubah \`$HIT\`"
  else
    risk="daftar berkas PR tidak terbaca"
  fi
fi

if [ -n "$risk" ] && [ "$(visible_len "$(section HUMAN)")" -lt 20 ]; then
  missing="$missing
- catatan manusia singkat di bawah \`## HUMAN\` (minimal 20 karakter, apa yang Anda uji) — wajib karena PR ini berisiko: $risk"
fi

[ -n "$(section Why)" ] || missing="$missing
- \`## Why\` — masalah dan motivasinya"
[ -n "$(section 'What changed')" ] || missing="$missing
- \`## What changed\` — apa perubahannya"

# Every issue the PR closes, once each. GitHub links and closes an issue only
# for a closing keyword (docs.github.com, "Linking a pull request to an
# issue"), so a bare "#12" or "Refs #12" is a mention, not a link. The keyword
# must be a word of its own: without the boundary "prefix #12" or "hotfix #15"
# read as a link to an issue the PR never names.
LINKED="$(printf '%s' "$BODY" | grep -oiE '(^|[^[:alnum:]_])(fix(e[sd])?|close[sd]?|resolve[sd]?) #[0-9]+' | grep -oE '#[0-9]+' | tr -d '#' | awk '!seen[$0]++')"
if [ -z "$LINKED" ]; then
  missing="$missing
- \`Fixes #<n>\` untuk setiap issue yang diselesaikan PR ini. PR tanpa issue tidak diterima: buat issue-nya dulu, lalu tautkan"
fi
for N in $LINKED; do
  # One lookup per issue: open or closed, issue or pull request (the issues
  # endpoint answers for both), and its labels.
  if ! INFO="$(gh api "repos/$REPO/issues/$N" --jq '"\(.state) \(if .pull_request then "pr" else "issue" end) \([.labels[].name] | join(","))"' 2>/dev/null)" || [ -z "$INFO" ]; then
    missing="$missing
- #$N tidak ditemukan di repositori ini; tautkan issue yang ada"
    continue
  fi
  STATE="${INFO%% *}"; REST="${INFO#* }"; KIND="${REST%% *}"; LABELS="${REST#* }"
  [ "$LABELS" = "$REST" ] && LABELS=""
  if [ "$KIND" = "pr" ]; then
    missing="$missing
- #$N adalah pull request, bukan issue; tautkan issue yang diselesaikan PR ini"
    continue
  fi
  if [ "$STATE" != "open" ]; then
    missing="$missing
- issue #$N sudah tertutup; tautkan issue yang masih terbuka, atau buka kembali bila belum selesai"
    continue
  fi
  # A link is only a green light when the issue is ready for development:
  # `ready` (ready for anyone) or `bot-implement` (handed to the bot). A link to
  # an issue still in `needs-info` or `pending-maintainer` is not.
  case ",$LABELS," in
    *,ready,* | *,bot-implement,*) ;;
    *) missing="$missing
- issue tertaut #$N harus berlabel \`ready\` atau \`bot-implement\` sebelum ditinjau (sekarang: ${LABELS:-tidak ada})" ;;
  esac
done
if [ -n "$LINKED" ] && [ -n "${BASE_REF:-}" ] && [ -n "${DEFAULT_BRANCH:-}" ] && [ "$BASE_REF" != "$DEFAULT_BRANCH" ]; then
  missing="$missing
- PR ini menuju \`$BASE_REF\`, bukan \`$DEFAULT_BRANCH\`: GitHub hanya membaca \`Fixes #<n>\` pada PR ke branch default, jadi issue-nya tidak akan tertutup. Arahkan PR ke \`$DEFAULT_BRANCH\`"
fi

[ -n "$(section 'How to test')" ] || missing="$missing
- \`## How to test\` — perintah yang dijalankan peninjau, dan apa yang Anda lihat"

if ! section 'Acceptance criteria' | grep -qE '^[[:space:]]*- \[[ x]\]'; then
  missing="$missing
- \`## Acceptance criteria\` — minimal satu kotak centang yang disalin dari issue tertaut"
fi

# The repo writes its GitHub prose in Indonesian (docs/LABELS.md). The check is
# deliberately coarse: it only fails a body that reads as English, i.e. it has
# common English function words and no common Indonesian ones. `English is
# intended` is the explicit escape hatch for the rare deliberate exception.
ID_WORDS='dan|yang|atau|dengan|untuk|tidak|adalah|pada|dari|ini|itu|akan|bisa|sudah|belum|perubahan|pengujian|perbaikan|masalah|berkas|kesalahan'
EN_WORDS='(^|[^a-z])(the|and|with|this|that|for|not|should|change|changes|changed|test|tests|tested|testing|fix|fixes|fixed|fixing|adds|added|adding)([^a-z]|$)'
# Both sides need word boundaries: `ini` sits inside "initial" and `dan` inside
# "abundant", so an unanchored Indonesian match would let an English body pass.
if ! printf '%s' "$BODY" | grep -qiE "(^|[^a-z])($ID_WORDS)([^a-z]|$)" \
   && printf '%s' "$BODY" | grep -qiE "$EN_WORDS" \
   && ! printf '%s' "$BODY" | grep -qiE '^[[:space:]]*english is intended'; then
  missing="$missing
- deskripsi terbaca sebagai Bahasa Inggris; repo ini menulis prosa GitHub-nya dalam Bahasa Indonesia (tambahkan baris \`English is intended\` hanya bila itu memang disengaja)"
fi

# Find any existing marker comment, so it can be updated instead of duplicated.
find_comment() {
  # --paginate: on an active PR the reminder can move past the first 100
  # comments; without it the guard would post a duplicate (or fail to delete a
  # resolved one). tail -n1 keeps the newest marker comment.
  gh api --paginate "repos/$REPO/issues/$PR/comments?per_page=100" \
    --jq ".[] | select(.body | contains(\"$MARK\")) | .id" 2>/dev/null | tail -n1
}
CID="$(find_comment || true)"

OUT="$DIR/out"
if [ -n "$missing" ]; then
  {
    printf '%s\n' "$MARK" "" "Deskripsi pull request ini belum lengkap:"
    printf '%s\n' "$missing"
    printf '%s\n' "" \
      "Check \`PR description\` gagal sampai ini diperbaiki. Lihat" \
      "\`docs/LABELS.md\`."
  } > "$OUT"
  if [ -n "$CID" ]; then
    # -F, not -f: only a typed field reads `@file`. With -f the comment became
    # the literal text "@/tmp/…/out", lost its marker, and the next run posted
    # a fresh reminder — which the run after that clobbered again.
    if gh api -X PATCH "repos/$REPO/issues/comments/$CID" -F body=@"$OUT" >/dev/null; then
      echo "PR #$PR: updated the missing-description reminder."
    else
      echo "::warning::could not update the description reminder on PR #$PR"
    fi
  elif gh pr comment "$PR" --repo "$REPO" --body-file "$OUT" >/dev/null; then
    echo "PR #$PR: posted the missing-description reminder."
  else
    echo "::warning::could not post the description reminder on PR #$PR"
  fi
  echo "::error::PR #$PR description is incomplete; the check fails."
  exit 1
elif [ -n "$CID" ]; then
  if gh api -X DELETE "repos/$REPO/issues/comments/$CID" >/dev/null; then
    echo "PR #$PR: description is complete; removed the reminder."
  else
    echo "::warning::could not remove the description reminder on PR #$PR"
  fi
else
  echo "PR #$PR: description is complete."
fi
