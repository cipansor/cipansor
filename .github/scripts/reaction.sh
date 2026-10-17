#!/bin/sh
# React to an issue, a pull request, or a comment so the person can see an
# automation has picked it up. A reporter who opens an issue, or a maintainer
# who comments `@cipansor-bot …`, otherwise has no signal that anything is
# happening until a bot comment appears minutes later — the reporter asked for
# this (2026-10-13). The `eyes` reaction means "the automation is looking at
# this"; the automated comment that follows carries the substance.
#
# Idempotent: the reaction is added once and never stacked. Before adding, the
# bot's own reactions on that object are removed, so a run that fires twice (a
# webhook re-delivery, a retry) leaves exactly one.
#
# Usage: reaction.sh <number> [comment-id]
#        <number>       the issue or pull request number
#        [comment-id]   react to that comment instead of the issue/PR itself
# Env:   GH_TOKEN (the bot's token, so the reaction reads as cipansor-bot),
#        REPO (owner/name), REACTION (default eyes)
set -eu

NUMBER="${1:?usage: reaction.sh <number> [comment-id]}"
COMMENT="${2:-}"
REPO="${REPO:?REPO is required}"
REACTION="${REACTION:-eyes}"

if [ -n "$COMMENT" ]; then
  TARGET="repos/$REPO/issues/comments/$COMMENT"
  WHAT="comment $COMMENT on #$NUMBER"
else
  TARGET="repos/$REPO/issues/$NUMBER"
  WHAT="#$NUMBER"
fi

# The account the token belongs to is the one whose reactions to replace, so the
# script works whether the runner holds the bot token or the Actions token.
BOT_LOGIN="${BOT_LOGIN:-$(gh api /user --jq .login 2>/dev/null || echo cipansor-bot)}"

# Remove that account's reactions first, so a changed default never leaves two.
existing=$(gh api --paginate "$TARGET/reactions?per_page=100" \
  --jq ".[] | select(.user.login == \"$BOT_LOGIN\") | .id" 2>/dev/null || true)
if [ -n "$existing" ]; then
  printf '%s\n' "$existing" | while read -r id; do
    [ -n "$id" ] || continue
    gh api -X DELETE "$TARGET/reactions/$id" >/dev/null 2>&1 \
      || echo "::warning::could not remove reaction $id from $WHAT."
  done
fi

# Re-add exactly one. The reaction content is sent verbatim, so `-f` (raw field)
# is correct — `-F` would read `content=+1` as a file reference.
if ! gh api "$TARGET/reactions" -f content="$REACTION" >/dev/null 2>&1; then
  echo "::warning::could not react $REACTION on $WHAT."
  exit 0
fi
echo "Reacted $REACTION on $WHAT as $BOT_LOGIN."
