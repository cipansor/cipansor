#!/bin/sh
# Report a failed CI/E2E run on `main` as a GitHub issue, deterministically.
#
# `Pemantau deployment` (SDLC 12) was retired on 2026-11-12 (owner decision): a
# diagnosis of a red `main` is not worth an LLM sandbox, and the failure is
# already visible on the run page. What remains is the deterministic half — open
# one issue per failing workflow, with the run, the commit and the check names a
# person needs to start looking. The maintainer reads the run from the Actions
# tab; the fleet no longer guesses the cause.
#
# Idempotent (one problem, one issue): a workflow that already has an OPEN issue
# from this script gets a comment with the new run instead of a second issue.
# The marker names the workflow, so `CI` and `E2E Tests` keep separate issues.
#
# Usage: main-failure-report.sh <workflow-name> <run-id> <sha> <run-url> [branch]
# Env:   GH_TOKEN, REPO (owner/name)
set -eu

WORKFLOW="${1:?usage: main-failure-report.sh <workflow> <run-id> <sha> <url> [branch]}"
RUN_ID="${2:?run id is required}"
SHA="${3:?sha is required}"
RUN_URL="${4:?run url is required}"
BRANCH="${5:-main}"
REPO="${REPO:?REPO is required}"

# The marker is per workflow: a red `CI` and a red `E2E Tests` are two problems
# and deserve two issues; a second red `CI` is the same problem continuing.
MARK="<!-- main-failure:${WORKFLOW} -->"
SHORT_SHA=$(printf '%s' "$SHA" | cut -c1-7)
TITLE="Deploy watchdog: $WORKFLOW run $RUN_ID failed"

ENTRY="- **$WORKFLOW** — run [\`$RUN_ID\`]($RUN_URL) at \`$SHORT_SHA\` on \`$BRANCH\` ($(date -u +%Y-%m-%dT%H:%M:%SZ))"

# An open issue from this script for this workflow, if any. The marker is
# matched in the body locally rather than through `--search`: the marker is an
# HTML comment, and GitHub's search syntax treats its punctuation specially.
EXISTING=$(gh issue list --repo "$REPO" --state open --label bug --limit 200 \
  --json number,body \
  --jq ".[] | select(.body | contains(\"$MARK\")) | .number" 2>/dev/null | head -n1 || true)

if [ -n "$EXISTING" ]; then
  BODY="Another \`$WORKFLOW\` run failed on \`$BRANCH\`:

$ENTRY

$MARK"
  if ! gh issue comment "$EXISTING" --repo "$REPO" --body "$BODY" >/dev/null; then
    echo "::error::could not comment on issue #$EXISTING for $WORKFLOW run $RUN_ID."
    exit 1
  fi
  echo "Commented on the open issue #$EXISTING for $WORKFLOW run $RUN_ID."
  exit 0
fi

BODY="$(printf '%s\n' \
  "بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ" \
  "" \
  "\`$WORKFLOW\` failed on \`$BRANCH\`." \
  "" \
  "## Kegagalan" \
  "" \
  "$ENTRY" \
  "" \
  "## Yang perlu dilakukan" \
  "" \
  "Buka run di tab Actions, baca langkah yang merah, dan perbaiki penyebabnya di \`$BRANCH\`. Satu issue per workflow; kegagalan berikutnya pada workflow yang sama menambah komentar di sini, bukan membuka issue baru. Tutup manual setelah perbaikan ter-merge dan \`$BRANCH\` hijau." \
  "" \
  "$MARK")"

if ! gh issue create --repo "$REPO" \
    --title "$TITLE" \
    --label bug --label priority:high \
    --body "$BODY" >/dev/null; then
  echo "::error::could not open the failure issue for $WORKFLOW run $RUN_ID."
  exit 1
fi
echo "Opened an issue for $WORKFLOW run $RUN_ID."
