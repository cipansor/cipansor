#!/bin/sh
# Report documentation that has drifted from the code, as one issue, without an
# LLM. Replaces the `SDLC 03 · Peta basis kode` and `SDLC 14 · Pengelola
# dokumentasi` automations (retired 2026-11-09).
#
# Why an Action and not an automation: both prompts asked for a *list of files
# and paths* to open as one issue. The documentation skill
# (`.claude/skills/dokumen-aplikasi-cipansor`) already measures that list
# deterministically — `collect_facts.py` counts modules, models, routes and
# cron entries, and `check_docs.py` compares the prose (Appendix A row by row,
# every number) against the code. SDLC 03/14 were an LLM re-reading a result a
# script had already produced, 68 sandbox runs a week for a diff.
#
# Two independent signals, one issue:
#   facts   -> `check_docs.py` finds an ERROR in a tracked doc (a stale number,
#              a missing decision, an Appendix A row that disagrees with code)
#   orphan  -> a module, route file, or scheduled job appeared in the code with
#              no mention in any tracked doc
#
# One issue per cause, reopened by a comment when it already exists, so a doc
# that stays stale does not open a new issue every run. The issue is labelled
# `documentation` and `pending-maintainer`: fixing prose is a judgement call,
# and `Tiket jadi PR` only starts on `bot-implement`, which a maintainer adds.
#
# Usage: docs-drift.sh
# Env:   GH_TOKEN, REPO, DOCS_DRIFT_DRY_RUN (print, write nothing)
#        MODULES_DIR / DOCS_DIR override the scanned trees (tests)
set -eu

REPO="${REPO:?REPO is required}"
DRY="${DOCS_DRIFT_DRY_RUN:-}"
SKILL=".claude/skills/dokumen-aplikasi-cipansor/scripts"
MODULES_DIR="${MODULES_DIR:-apps/api/src/modules}"
DOCS_DIR="${DOCS_DIR:-docs}"
TITLE="docs: dokumentasi menyimpang dari kode"
MARK="<!-- docs-drift -->"

# The skill is stdlib-only, so it runs on the runner's Python with no install.
python3 "$SKILL/collect_facts.py" . --out /tmp/fakta >/dev/null

REPORT=/tmp/docs-drift.md
: > "$REPORT"

# --- signal 1: the checker's own ERRORs, on every tracked doc -----------------
for doc in docs/DOKUMEN-TEKNIS.md docs/PANDUAN-PENGGUNA-UMUM.md; do
  [ -f "$doc" ] || continue
  kind=teknis
  case "$doc" in *PANDUAN*) kind=pengguna ;; esac
  OUT=$(python3 "$SKILL/check_docs.py" "$doc" --kind "$kind" --repo . \
    --facts /tmp/fakta/facts.json 2>&1 || true)
  echo "$OUT" | grep -q '^ERROR' || continue
  {
    echo "### \`$doc\`"
    echo
    echo '```'
    echo "$OUT" | grep '^ERROR'
    echo '```'
    echo
  } >> "$REPORT"
done

# --- signal 2: code paths with no mention in any tracked doc ------------------
# A module directory, a route file, or a scheduled job whose *name* never appears
# in docs/. Names are the signal: a new module the docs never name is the drift
# SDLC 03 existed to catch. The prompt pointed at `docs/MODULE_MAP.md`, which has
# never existed in this repository — the module catalog lives in Appendix A of
# `docs/DOKUMEN-TEKNIS.md`.
ORPHANS=""
add_orphan() { # add_orphan <label> <name>
  grep -rqF "$2" "$DOCS_DIR" 2>/dev/null || ORPHANS="$ORPHANS
- $1 \`$2\`"
}
for d in "$MODULES_DIR"/*/; do
  [ -d "$d" ] && add_orphan "modul" "$(basename "$d")"
done
for f in "$MODULES_DIR"/*/*.routes.ts; do
  [ -f "$f" ] && add_orphan "rute" "$(basename "$f" .routes.ts)"
done

if [ -n "$ORPHANS" ]; then
  {
    echo "### Kode yang tidak disebut dokumentasi mana pun"
    echo
    echo "Nama berikut ada di kode tetapi tidak muncul di berkas mana pun di"
    echo "\`docs/\`. Tambahkan ke \`docs/ARCHITECTURE.md\` / Lampiran A"
    echo "\`docs/DOKUMEN-TEKNIS.md\`, atau jelaskan mengapa ia tidak perlu dicatat."
    echo "$ORPHANS"
    echo
  } >> "$REPORT"
fi

if [ ! -s "$REPORT" ]; then
  echo "Dokumentasi sejalan dengan kode; tidak ada yang dilaporkan."
  exit 0
fi

BODY=$(printf 'Ditemukan oleh `docs-drift.sh` (deterministik, tanpa LLM). Perbaikan prosa adalah keputusan penilaian: tambahkan `bot-implement` bila `Tiket jadi PR` yang harus mengerjakannya.\n\n%s\n\n%s\n' "$MARK" "$(cat "$REPORT")")

EXISTING=$(gh issue list --repo "$REPO" --state open --label documentation \
  --limit 100 --json number,title \
  --jq ".[] | select(.title == \"$TITLE\") | .number" | head -1 || true)

if [ -n "$EXISTING" ]; then
  if [ -n "$DRY" ]; then
    echo "[dry-run] akan mengomentari issue #$EXISTING"
  else
    gh issue comment "$EXISTING" --repo "$REPO" --body "$BODY"
    echo "Diperbarui issue #$EXISTING."
  fi
else
  if [ -n "$DRY" ]; then
    echo "[dry-run] akan membuka issue baru: $TITLE"
  else
    gh issue create --repo "$REPO" --title "$TITLE" --body "$BODY" \
      --label documentation --label pending-maintainer
    echo "Dibuka issue baru: $TITLE"
  fi
fi
