#!/bin/sh
# Warn on a `duplicate` issue, then close it if nothing changes within the grace
# period. Re-run daily by duplicate-sweep.yml.
#
# For each open issue labelled `duplicate`:
#   * no warning comment yet          -> post the warning, record the timestamp+hash
#   * warning present, still labelled -> if older than GRACE_DAYS, close it
#   * label removed                   -> nothing (the sweep only sees the label)
#   * description edited after warning -> nothing (shown distinct)
#   * a person replied after warning  -> nothing (given to a maintainer)
#
# PRs are deliberately NOT swept here. `duplicate-pr` is a maintainer-facing
# candidate (see pr-duplicate.sh): which of two PRs is the more correct one is a
# judgement (docs/LABELS.md, rule 4), so a PR labelled `duplicate-pr` is never
# closed automatically. The label differs (`duplicate` vs `duplicate-pr`) because
# `duplicate` is an issue-lifecycle label that must never sit on a PR, and the
# issue-label-sync workflow fails a PR that carries one (docs/LABELS.md, rule 2).
#
# "Show it is not a duplicate" means the author did something a maintainer can
# weigh: edited the description, or replied to the warning. The sweep holds no
# state between runs: it reads the warning's timestamp back from the marker in
# its own comment, and it detects an edit by comparing the description hash it
# recorded in that comment against the text now. Relying on the item's updatedAt
# is not enough - a later automated comment also bumps it, so an edit made
# before that comment would be invisible.
#
# Usage: duplicate-sweep.sh
# Env:   GH_TOKEN, REPO, GRACE_DAYS (default 7)
set -eu

REPO="${REPO:?REPO is required}"
GRACE_DAYS="${GRACE_DAYS:-7}"
MARK="<!-- duplicate-sweep:warned -->"
# The detector's link comment (`duplicate-detect.sh`). The detector may write it
# before it manages to apply the label, so the sweep must count a person's reply
# from that comment, not only from its own warning — otherwise a reply in the
# gap between the link and the label is ignored and the issue closes on top of
# it. The marker is what identifies the comment; a legacy triage-linked issue
# has no such comment, so the window falls back to the warning.
LINK_MARK="<!-- duplicate-detect -->"
# The account that posts every automated comment. A comment by it, or by any
# GitHub App (`*[bot]`), is automated and must not count as a human reply —
# otherwise one bot comment exempts a duplicate forever. The guard is by author,
# not by the AI-disclosure footer: `cipansor-bot` is a bot account, so its name
# already says the comment is automated and no footer is needed (#680).
BOT_LOGIN="${BOT_LOGIN:-cipansor-bot}"

body_hash() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

NOW=$(date -u +%s)

# Every comment, oldest first, as tab-separated created_at / author / body.
# A PR is an issue to the REST API, so `issues/$n/comments` serves any item, but
# this sweep only ever passes issue numbers now. Each comment is emitted as three
# tab-separated fields so the reply scan can tell a person from a bot account
# without an underscore index (sh lacks one). --paginate so an item with more than
# one page of comments is not truncated: a lone `?per_page=100` omitted a later
# reply and the sweep closed on top of it. `gh --paginate` puts a bare newline
# between pages; the reply scan's timestamp comparison below drops it (an empty
# first field is less than any timestamp), so the separator cannot be read as a
# reply.
ITEMS=$(gh issue list --repo "$REPO" --state open --label duplicate --limit 200 \
  --json number --jq '.[].number')
for n in $ITEMS; do
  RAW_COMMENTS=$(gh api --paginate "repos/$REPO/issues/$n/comments?per_page=100" \
    --jq '.[] | "\(.created_at)\t\(.user.login)\t\(.body | gsub("\n"; " ") | gsub("\t"; " "))"' 2>/dev/null || true)
  COMMENTS=$(printf '%s\n' "$RAW_COMMENTS" | cut -f1,3)
  WARNED_AT=$(printf '%s\n' "$COMMENTS" | grep -F "$MARK" | head -1 | cut -f1 || true)

  if [ -z "$WARNED_AT" ]; then
    # Record a hash of the description as it stands now, so a later run can
    # tell it changed. GitHub bumps updatedAt for comments too, so this marker
    # - not updatedAt - is what makes an edit detectable.
    BODY=$(gh issue view "$n" --repo "$REPO" --json body --jq '.body // empty' || true)
    HASH=$(body_hash "$BODY")
    gh issue comment "$n" --repo "$REPO" --body "This issue looks like a **duplicate** of one already open or closed. It will be closed automatically in $GRACE_DAYS days unless it is shown to be distinct — edit the issue, or reply with why it is not a duplicate.

If a maintainer agrees it is distinct, removing the \`duplicate\` label cancels the close. $MARK

<!-- duplicate-sweep:hash:$HASH -->"
    echo "Warned on issue #$n."
    continue
  fi

  # A person's reply counts from the earliest point the issue was publicly
  # flagged as a duplicate — the detector's link comment when there is one,
  # otherwise the sweep's own warning. Counting only from the warning would
  # ignore a reply made between the link and the label (the detector writes the
  # link first), and the issue would close on top of it.
  LINKED_AT=$(printf '%s\n' "$COMMENTS" | grep -F "$LINK_MARK" | head -1 | cut -f1 || true)
  REPLY_SINCE="$WARNED_AT"
  if [ -n "$LINKED_AT" ] && [ "$LINKED_AT" \< "$REPLY_SINCE" ]; then
    REPLY_SINCE="$LINKED_AT"
  fi

  AGE=$(( (NOW - $(date -u -d "$WARNED_AT" +%s)) / 86400 ))
  if [ "$AGE" -lt "$GRACE_DAYS" ]; then
    echo "issue #$n warned ${AGE}d ago; within the ${GRACE_DAYS}d grace period."
    continue
  fi

  # A comment after the flag by a person (not the bot, not a GitHub App)
  # means the author responded; give it to a maintainer instead of closing on
  # top of a reply. `cipansor-bot` posts as a plain User, so it is matched by
  # login; a GitHub App's login ends in `[bot]`.
  NEW_REPLY=$(printf '%s\n' "$RAW_COMMENTS" \
    | awk -F '\t' -v warned="$REPLY_SINCE" -v bot="$BOT_LOGIN" \
        '$1 > warned && $2 != bot && $2 !~ /\[bot\]$/ { line = $3 } END { print line }' || true)
  if [ -n "$NEW_REPLY" ]; then
    echo "issue #$n has a reply after it was flagged as a duplicate; leaving it open for a maintainer."
    continue
  fi

  # An edit to the description after the warning also shows it is distinct.
  # Compare the hash with the one recorded in the warning, not updatedAt: a
  # later comment bumps updatedAt and would hide an earlier edit.
  RECORDED=$(printf '%s\n' "$COMMENTS" | grep -oE 'duplicate-sweep:hash:[0-9a-f]+' | head -1 | cut -d: -f3 || true)
  BODY=$(gh issue view "$n" --repo "$REPO" --json body --jq '.body // empty' || true)
  if [ -z "$RECORDED" ]; then
    # A warning posted before the sweep recorded a hash carries no way to tell
    # whether the description changed since. Do not close on a guess: report it
    # and leave it for a maintainer. (Warnings the current sweep posts always
    # carry a hash, so this only covers an older warning, e.g. one edited by
    # hand.)
    echo "::warning::issue #$n was warned without a description hash; leaving it open for a maintainer to decide."
    continue
  fi
  if [ "$(body_hash "$BODY")" != "$RECORDED" ]; then
    echo "issue #$n was edited after the warning; leaving it open for a maintainer."
    continue
  fi

  gh issue close "$n" --repo "$REPO" --reason "not planned" --comment "Closing as a duplicate: no response in $GRACE_DAYS days. Reopen if it is in fact distinct. $MARK"
  echo "Closed issue #$n as a stale duplicate."
done
