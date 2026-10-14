#!/bin/sh
# Put the basmalah at the top of every issue and pull-request description.
#
# The owner asked (2026-10-13) that every main description open with
# «بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ» (transliterated
# `Bismillaahirrohmaanirrohiim`). The automations are told to open their own
# bodies with it; this workflow is the deterministic guarantee, so an issue a
# person files, or a body an automation forgot, still carries it.
#
# Idempotent: a body already opening with the basmalah (either script) is left
# alone, so editing a description does not stack a second copy. The scripts are
# the ones the issue forms and the automations use, so the check is exact.
#
# Usage: basmalah.sh --stdin          # an `opened`/`edited` webhook event
#        basmalah.sh <number>         # by hand
# Env:   GH_TOKEN, REPO (owner/name)
set -eu

REPO="${REPO:?REPO is required}"

# The two accepted openings. Arabic first (the automations), transliteration
# second (a person who cannot type Arabic).
ARABIC="بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ"
TRANSLIT="Bismillaahirrohmaanirrohiim"

if [ "${1:-}" = "--stdin" ]; then
  EVENT=$(cat)
  ACTION=$(printf '%s' "$EVENT" | jq -r '.action // empty')
  # A pull request's number is its issue number; the `pull_request_target`
  # payload names it under `.pull_request`, the `issues` payload under `.issue`.
  NUMBER=$(printf '%s' "$EVENT" | jq -r '.issue.number // .pull_request.number // empty')
else
  ACTION="opened"
  NUMBER="${1:?usage: basmalah.sh --stdin | <number>}"
fi

# Only for an opened or edited description; a `closed`/`labeled` event is not
# a reason to touch the body.
case "$ACTION" in
  opened | edited | reopened) ;;
  *) echo "action='$ACTION'; nothing to do."; exit 0 ;;
esac
[ -n "$NUMBER" ] || { echo "No issue number in the event; nothing to do."; exit 0; }

# Read the body, prepend the basmalah, and write it back.
#
# GitHub offers no conditional write here (the REST issue object has no
# `version` field, and `If-Match` is rejected with 400), so the body is re-read
# immediately before the PATCH: if an automation wrote its `<!-- sdlc:… -->`
# summary between the first read and the write, the basmalah is prepended to the
# fresh body instead of overwriting the summary with the stale copy. This
# narrows the window to the PATCH call itself — the closest a compare-and-swap
# can get without an atomic API.
read_body() { gh api "repos/$REPO/issues/$NUMBER" --jq '.body // ""' 2>/dev/null; }
# The description's first real content line — skipping leading blank lines and
# any leading HTML comment. The pull-request template opens with a multi-line
# `<!-- … -->` note, so the basmalah sits *below* it; a check that only looked at
# the first non-blank line saw the comment, concluded "no basmalah", and stacked a
# second copy on every templated body (found by the review gate on PR #817).
opens_with_basmalah() {
  h=$(printf '%s' "$1" | awk '
    /^[[:space:]]*$/ { next }
    /^[[:space:]]*<!--/ { c = 1 }
    c && /-->/ { c = 0; next }
    c { next }
    { print; exit }
  ')
  [ "$h" = "$ARABIC" ] || [ "$h" = "$TRANSLIT" ]
}

BODY=$(read_body) || { echo "::warning::could not read the body of #$NUMBER."; exit 0; }
if opens_with_basmalah "$BODY"; then
  echo "#$NUMBER already opens with the basmalah; nothing to do."
  exit 0
fi

FRESH=$(read_body) || FRESH="$BODY"
if opens_with_basmalah "$FRESH"; then
  echo "#$NUMBER already opens with the basmalah (written concurrently); nothing to do."
  exit 0
fi

NEW="$ARABIC

$FRESH"
# Assemble the JSON with jq (a body with quotes or newlines survives) and send
# it with --input, so the body is never mangled by shell word splitting.
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
jq -n --arg body "$NEW" '{body: $body}' > "$TMP"
if ! gh api "repos/$REPO/issues/$NUMBER" -X PATCH --input "$TMP" >/dev/null 2>&1; then
  echo "::warning::could not prepend the basmalah to #$NUMBER."
  exit 0
fi
echo "Prepended the basmalah to #$NUMBER."
