#!/bin/sh
# Only `cipansor-bot` labels. Any protected label added by another account is
# removed, and the account is told once. Labels are the machine-readable
# interface between the OpenHands automations and the GitHub Actions guards
# (docs/LABELS.md), so a hand-applied `ready`, `priority:*` or type label makes
# the two disagree about an issue's real state. The bot owns the taxonomy; a
# person states what they want and the bot records it.
#
# The protected set is every label that exists in the repository minus the few
# human-decision labels in EXEMPT_LABELS and the provenance labels in
# ALLOWED_LABELS. It is read from the repository, never hardcoded, so a new label
# is protected the moment it is created and the set cannot drift from
# `gh label list`.
#
# A GitHub App (`*[bot]`) is exempt: the Actions workflows (`issue-label-sync`,
# `deploy-watch`, the label sync itself) label through `github-actions[bot]`, and
# revoking those would break the guards. The automations post as `cipansor-bot`
# (the runner injects GITHUB_BOT_TOKEN), so they are covered by BOT_LOGIN.
#
# ALLOWED_LABELS holds labels the *issue* template applies by itself, not a
# person or a PR claiming a state: `bug_report.yml` sets `bug` and
# `feature_request.yml` sets `enhancement` the moment an issue is created, so
# revoking them fights the template and posts a notice on every new issue (#842).
# A type label is the reporter's declared intent — the triage owner sets the
# *correct* type on top of it — so the guard leaves it on an **issue**. A pull
# request has no such form, so on a PR the type labels stay protected: a PR that
# closes an `enhancement` issue but carries `bug` would fail the type sync
# (`issue-label-sync.sh`), which reads a PR's type as a claim to match. Everything
# else (`ready`, `priority:*`, the workflow labels) stays the bot's everywhere.
#
# Usage: label-guard.sh --stdin          # a `labeled` webhook event on stdin
#        label-guard.sh <number> <label> [actor]   # by hand
# Env:   GH_TOKEN, REPO (owner/name), BOT_LOGIN, EXEMPT_LABELS, ALLOWED_LABELS
set -eu

REPO="${REPO:?REPO is required}"
BOT_LOGIN="${BOT_LOGIN:-cipansor-bot}"
# Human-decision labels: the release gate is the maintainer's to apply (that is
# the whole point of the label), and `bot-implement` is the maintainer's choice
# to hand an issue to the bot. Everything else is the bot's.
EXEMPT_LABELS="${EXEMPT_LABELS:-rilis-disetujui rilis-ditolak bot-implement}"
# Labels the issue template applies by itself. Left in place so a fresh issue is
# not met with a revocation notice (#842).
ALLOWED_LABELS="${ALLOWED_LABELS:-bug enhancement}"

REVOKE_MARK="<!-- label-guard:revoked -->"

# Every existing label except the human-decision ones and, on an issue, the
# repository's own template labels. Read once per run. On a pull request the
# template labels are *not* exempt, so `bug`/`enhancement` applied to a PR are
# protected and revoked like any other type claim.
protected_labels() {
  exempt="$EXEMPT_LABELS"
  [ "$IS_PR" = "1" ] || exempt="$exempt $ALLOWED_LABELS"
  { gh label list --repo "$REPO" --limit 1000 --json name --jq '.[].name' 2>/dev/null || true; } \
    | grep -vxF "$(printf '%s\n' $exempt)" || true
}

# The `labeled` event, read from stdin.
if [ "${1:-}" = "--stdin" ]; then
  EVENT=$(cat)
  ACTION=$(printf '%s' "$EVENT" | jq -r '.action // empty')
  ACTOR=$(printf '%s' "$EVENT" | jq -r '.sender.login // empty')
  NUMBER=$(printf '%s' "$EVENT" | jq -r '.issue.number // .pull_request.number // empty')
  LABEL=$(printf '%s' "$EVENT" | jq -r '.label.name // empty')
  # A pull request's number is its issue number; the label API is the same. The
  # `pull_request_target` payload names the PR under `.pull_request`, the
  # `issues` payload under `.issue`.
  IS_PR=$(printf '%s' "$EVENT" | jq -r 'if (.issue.pull_request != null) or (.pull_request != null) then "1" else "0" end')
else
  NUMBER="${1:?usage: label-guard.sh --stdin | <number> <label> [actor]}"
  LABEL="${2:?label is required}"
  ACTOR="${3:-}"
  ACTION="labeled"
  IS_PR="${IS_PR:-0}"
fi

[ "$ACTION" = "labeled" ] || { echo "action='$ACTION'; nothing to do."; exit 0; }
[ -n "$NUMBER" ] && [ -n "$LABEL" ] || { echo "No number/label in the event; nothing to do."; exit 0; }

# `ready` is a strong claim and it is exclusive: it must never sit beside a label
# that says the issue is still being discussed or decided (#814 carried `ready`
# and `question` together, which makes the machine-readable state ambiguous).
# `question`, `needs-info` and `pending-maintainer` all win over `ready`.
#
# The decision is made from the issue's *effective* label set: the event's own
# label counts unless the standard path below is about to revoke it (an
# unauthorized actor applied a protected, non-human-decision label). Ignoring it
# when it will be revoked is what lets the standard path's removal resolve a
# conflict the event itself created — a human adding `question` beside `ready`
# is resolved by removing `question`, not `ready`. But any exclusion still
# present after that removal keeps the conflict, so `ready` must go: `ready` +
# `needs-info` with a human adding `question` is still `ready` + `needs-info`.
READY_MARK="<!-- label-guard:ready-exclusive -->"

# Will the standard path revoke the event's own label (unauthorized actor,
# protected, not a human-decision label)?
revoke_event_label=0
if [ "$ACTOR" != "$BOT_LOGIN" ]; then
  case "$ACTOR" in
    *'[bot]') ;;
    *)
      if ! printf '%s\n' $EXEMPT_LABELS | grep -qxF "$LABEL" \
        && protected_labels | grep -qxF "$LABEL"; then
        revoke_event_label=1
      fi
      ;;
  esac
fi

current=$(gh api "repos/$REPO/issues/$NUMBER/labels" --jq '.[].name' 2>/dev/null || true)
effective="$current"
if [ "$revoke_event_label" = "1" ]; then
  effective=$(printf '%s\n' "$current" | grep -vxF "$LABEL" || true)
fi

conflict=""
if printf '%s\n' "$effective" | grep -qxF ready; then
  for excl in question needs-info pending-maintainer; do
    printf '%s\n' "$effective" | grep -qxF "$excl" && conflict="$excl"
  done
fi
if [ -n "$conflict" ]; then
  if ! gh api -X DELETE "repos/$REPO/issues/$NUMBER/labels/ready" >/dev/null 2>&1; then
    echo "::error::Could not remove the contradictory 'ready' label from #$NUMBER."
    exit 1
  fi
  echo "Removed 'ready' from #$NUMBER: it contradicts '$conflict'."
  if ! gh api --paginate "repos/$REPO/issues/$NUMBER/comments?per_page=100" \
      --jq '.[].body' 2>/dev/null | grep -qF "$READY_MARK"; then
    RBODY="Label \`ready\` dicabut dari #$NUMBER karena bertentangan dengan \`$conflict\`: issue yang masih punya pertanyaan terbuka atau menunggu keputusan belum siap dikerjakan. \`ready\` hanya diberikan bila sangat yakin — tanpa pertanyaan terbuka. Hilangkan dulu \`$conflict\`-nya (jawab pertanyaannya, atau putuskan), lalu \`ready\` boleh dipasang lagi.

$READY_MARK"
    gh api "repos/$REPO/issues/$NUMBER/comments" -f body="$RBODY" >/dev/null \
      || echo "::warning::could not post the ready-conflict notice on #$NUMBER."
  fi
  # If the event label was `ready` itself, it is gone; otherwise fall through so
  # the standard path also deals with the event's label.
  if [ "$LABEL" = "ready" ]; then
    exit 0
  fi
fi

# The bot and any GitHub App may label.
[ "$ACTOR" = "$BOT_LOGIN" ] && { echo "Label '$LABEL' was applied by $BOT_LOGIN; fine."; exit 0; }
case "$ACTOR" in
  *'[bot]') echo "Label '$LABEL' was applied by a GitHub App ('$ACTOR'); fine."; exit 0 ;;
esac

# A human-decision label is the maintainer's to apply.
if printf '%s\n' $EXEMPT_LABELS | grep -qxF "$LABEL"; then
  echo "Label '$LABEL' is a human-decision label; left in place."
  exit 0
fi

# Only labels that exist are protected. An unknown label is either a typo (the
# author can fix it) or something GitHub added; either way it is not the bot's
# taxonomy to police, and it cannot be removed by name if it does not exist.
if ! protected_labels | grep -qxF "$LABEL"; then
  echo "Label '$LABEL' is not a protected label; left in place."
  exit 0
fi

KIND="issue"; [ "$IS_PR" = "1" ] && KIND="pull request"

# Remove it. The labels endpoint is shared by issues and pull requests.
if ! gh api -X DELETE "repos/$REPO/issues/$NUMBER/labels/$LABEL" >/dev/null 2>&1; then
  echo "::error::Could not remove label '$LABEL' from $KIND #$NUMBER (applied by '$ACTOR')."
  exit 1
fi
echo "Removed label '$LABEL' from $KIND #$NUMBER (applied by '$ACTOR')."

# Say so once, and only alert the maintainer when the actor was not authorized
# to label at all — a stray label by a maintainer is a slip, not an incident.
PERM=$(gh api "repos/$REPO/collaborators/$ACTOR/permission" --jq '.permission' 2>/dev/null || echo none)
ALERT=""
case "$PERM" in
  admin | maintain | write) ;;
  *) ALERT=" (akun ini tidak punya izin menulis; @adminypc tolong tinjau)" ;;
esac

BODY="Label \`$LABEL\` dicabut dari $KIND #$NUMBER: hanya \`$BOT_LOGIN\` yang boleh memasang label di repositori ini. Label adalah antarmuka mesin antara automasi dan workflow (docs/LABELS.md), jadi label manual membuat keduanya berbeda pendapat soal keadaan sebenarnya. Sebutkan apa yang Anda inginkan dan bot akan memasangnya. Label keputusan manusia (\`rilis-disetujui\`, \`rilis-ditolak\`, \`bot-implement\`) tetap boleh dipasang manual.$ALERT

$REVOKE_MARK"

# One notice per item: a repeat run must not stack comments.
if gh api --paginate "repos/$REPO/issues/$NUMBER/comments?per_page=100" \
    --jq '.[].body' 2>/dev/null | grep -qF "$REVOKE_MARK"; then
  echo "A revocation notice already exists on #$NUMBER; not repeating."
  exit 0
fi
gh api "repos/$REPO/issues/$NUMBER/comments" -f body="$BODY" >/dev/null \
  || echo "::warning::could not post the revocation notice on #$NUMBER."
