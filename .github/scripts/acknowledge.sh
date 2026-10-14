#!/bin/sh
# React 👀 on a comment when a comment-triggered automation will handle it, so
# the person can see the fleet is working before the answer lands (asked
# 2026-10-13). The bot's own comment is never acknowledged, so a reply does not
# acknowledge itself.
#
# The comment-driven automations and their triggers (docs/SDLC-FLOW.md):
#   - `Bot sebutan`      — an `@openhands` mention, maintainer only;
#   - `Penjernih issue`  — any reply to a `needs-info` issue, the reporter included;
#   - `Diskusi`          — a maintainer's reply to a `pending-maintainer`/`needs-info` issue.
# Reacting only for these keeps an ordinary comment thread unspammed.
#
# Usage: acknowledge.sh --stdin          # a `issue_comment.created` webhook event
#        acknowledge.sh <number> <comment-id> [author_association] [labels] [body]
# Env:   REPO (owner/name); the reaction itself is reaction.sh.
set -eu

REPO="${REPO:?REPO is required}"

if [ "${1:-}" = "--stdin" ]; then
  EVENT=$(cat)
  BODY=$(printf '%s' "$EVENT" | jq -r '.comment.body // ""')
  AUTHOR=$(printf '%s' "$EVENT" | jq -r '.comment.author_association // ""')
  LABELS=$(printf '%s' "$EVENT" | jq -r '[.issue.labels[].name] | join(",")')
  NUMBER=$(printf '%s' "$EVENT" | jq -r '.issue.number // empty')
  CID=$(printf '%s' "$EVENT" | jq -r '.comment.id // empty')
else
  NUMBER="${1:?usage: acknowledge.sh --stdin | <number> <comment-id> [author_association] [labels] [body]}"
  CID="${2:?comment id is required}"
  AUTHOR="${3:-}"
  LABELS="${4:-}"
  BODY="${5:-}"
fi

[ -n "$NUMBER" ] && [ -n "$CID" ] || { echo "No number/comment in the event; nothing to do."; exit 0; }

# Never acknowledge the bot's own comment — the anti-loop guard the fleet uses.
case "$BODY" in
  *"This comment was created by an AI agent"*) echo "Bot's own comment; nothing to do."; exit 0 ;;
esac

react=0
# `Bot sebutan` is maintainer-triggered (docs/SDLC-FLOW.md): a stray mention by
# anyone else does not start it, so it is not acknowledged either.
case "$BODY" in
  *"@openhands"*)
    case "$AUTHOR" in OWNER | MEMBER | COLLABORATOR) react=1 ;; esac ;;
esac
case ",$LABELS," in
  *,needs-info,*)
    # Penjernih issue fires on any reply, the reporter included.
    react=1 ;;
  *,pending-maintainer,*)
    # Diskusi is about a maintainer's decision.
    case "$AUTHOR" in OWNER | MEMBER | COLLABORATOR) react=1 ;; esac ;;
esac
[ "$react" = "1" ] || { echo "No comment-triggered automation will run; nothing to do."; exit 0; }

REPO="$REPO" sh "$(dirname "$0")/reaction.sh" "$NUMBER" "$CID"
