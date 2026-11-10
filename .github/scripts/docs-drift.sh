#!/bin/sh
# Refresh the "open findings" section of the single documentation-drift issue,
# from the code, without an LLM.
#
# Why this is the MEASURED layer and not a replacement for all of SDLC 03/14:
#   `SDLC 03 · Peta basis kode` retired 2026-11-09 — most of what it produced was
#   measured (module/model/route/cron counts, Appendix A rows), which the
#   documentation skill already computes exactly: `collect_facts.py` counts, and
#   `check_docs.py` compares the prose (Appendix A row by row, every number)
#   against the code.
#   `SDLC 14 · Pengelola dokumentasi` is KEPT as an LLM automation: which prose
#   went stale and what it should become is a judgement, not a path diff. SDLC
#   03's judgement half (is the module map in `docs/ARCHITECTURE.md` still true)
#   is folded into it.
#
# This script writes to the EXISTING parent issue #782, never a new one. That is
# the owner's decision of 2026-10-11 (`#782` rule 3, `otomasi-armada.md` 14):
# between 2026-10-09 and 2026-10-11 the mapper opened sixteen overlapping doc
# issues, so it now updates one parent issue's body instead. This script
# therefore edits the body between its markers (rule 1: rewritten whole, not a
# comment; rule 2: a finding that no longer holds is gone; rule 5: an empty list
# says so, and the issue stays open).
#
# Two independent signals:
#   facts   -> `check_docs.py` finds an ERROR in a tracked doc (a stale number,
#              a missing decision, an Appendix A row that disagrees with code)
#   orphan  -> a module or route file appeared in the code with no mention in any
#              tracked doc
#
# Usage: docs-drift.sh
# Env:   GH_TOKEN, REPO, DOCS_DRIFT_DRY_RUN (print, write nothing)
#        DOCS_DRIFT_PARENT (default 782), MODULES_DIR / DOCS_DIR (tests)
set -eu

REPO="${REPO:?REPO is required}"
DRY="${DOCS_DRIFT_DRY_RUN:-}"
SKILL=".claude/skills/dokumen-aplikasi-cipansor/scripts"
MODULES_DIR="${MODULES_DIR:-apps/api/src/modules}"
JOBS_DIR="${JOBS_DIR:-apps/api/src/jobs}"
DOCS_DIR="${DOCS_DIR:-docs}"
# The single drift issue (owner decision 2026-10-11, `#782` rule 3).
PARENT="${DOCS_DRIFT_PARENT:-782}"
START_MARK="<!-- docs-drift:start -->"
END_MARK="<!-- docs-drift:end -->"

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
# A job is named by its file, minus `.job.ts`: that is the name the schedule and
# the docs speak of. Checked here, not only in the number gate: a new job whose
# name no doc carries is exactly the orphan this signal exists for.
for f in "$JOBS_DIR"/*.job.ts; do
  [ -f "$f" ] && add_orphan "job" "$(basename "$f" .job.ts)"
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
  printf 'Tidak ada temuan terbuka (diperiksa pada %s).\n' "${GITHUB_SHA:-$(git rev-parse --short HEAD 2>/dev/null || echo unknown)}" > "$REPORT"
fi

# Rule 1: the body between the markers is REWRITTEN WHOLE on every run, never
# appended as a comment, and rule 2 removes a finding that no longer holds —
# rewriting is what removes it.
BLOCK=$(printf '%s\n%s\n%s' "$START_MARK" "$(cat "$REPORT")" "$END_MARK")

if [ -n "$DRY" ]; then
  echo "[dry-run] badan issue #$PARENT akan disegarkan:"
  cat "$REPORT"
  exit 0
fi

BODY=$(gh issue view "$PARENT" --repo "$REPO" --json body --jq .body)
case "$BODY" in
  *"$START_MARK"*"$END_MARK"*)
    NEW=$(printf '%s' "$BODY" | awk -v s="$START_MARK" -v e="$END_MARK" -v b="$BLOCK" '
      index($0, s) { print b; skip = 1; next }
      index($0, e) { skip = 0; next }
      !skip')
    ;;
  *)
    # First run: create the section at the end of the body. Its heading is
    # deliberately distinct from the LLM's "Temuan terbuka" section so the
    # measured layer and the judged layer do not blur into one list.
    NEW=$(printf '%s\n\n## Temuan terukur (dijaga `docs-drift.sh`)\n\n%s' "$BODY" "$BLOCK")
    ;;
esac

gh issue edit "$PARENT" --repo "$REPO" --body "$NEW"
echo "Badan issue #$PARENT disegarkan."
