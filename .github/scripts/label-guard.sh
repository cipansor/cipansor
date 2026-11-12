#!/bin/sh
# Only `cipansor-bot` labels. Any protected label added by another account is
# removed, and the account is told once. Labels are the machine-readable
# interface between the OpenHands automations and the GitHub Actions guards
# (docs/LABELS.md), so a hand-applied `ready`, `priority:*` or type label makes
# the two disagree about an issue's real state. The bot owns the taxonomy; a
# person states what they want and the bot records it.
#
# The protected set is every label that exists in the repository minus the
# provenance labels in ALLOWED_LABELS. It is read from the repository, never
# hardcoded, so a new label is protected the moment it is created and the set
# cannot drift from `gh label list`.
#
# A GitHub App (`*[bot]`) is exempt: the Actions workflows (`issue-label-sync`,
# the label sync itself) label through `github-actions[bot]`, and revoking those
# would break the guards. The automations post as `cipansor-bot` (the runner
# injects GITHUB_BOT_TOKEN), so they are covered by BOT_LOGIN.
#
# ALLOWED_LABELS holds labels the *issue* template applies by itself, not a
# person or a PR claiming a state: each form sets its own type label the moment
# an issue is created (one form per type, 2026-11-11 — see
# `.github/ISSUE_TEMPLATE/`), so revoking them fights the template and posts a
# notice on every new issue (#842). A type label is the reporter's declared
# intent — the triage owner sets the *correct* type on top of it — so the guard
# leaves it on an **issue**. A pull request has no such form, so on a PR the type
# labels stay protected: a PR that closes an `enhancement` issue but carries
# `bug` would fail the type sync (`issue-label-sync.sh`), which reads a PR's type
# as a claim to match. Everything else (`ready`, `priority:*`, the workflow
# labels) stays the bot's everywhere.
#
# Usage: label-guard.sh --stdin          # a `labeled` webhook event on stdin
#        label-guard.sh <number> <label> [actor]   # by hand
# Env:   GH_TOKEN, REPO (owner/name), BOT_LOGIN, EXEMPT_LABELS, ALLOWED_LABELS
set -eu

REPO="${REPO:?REPO is required}"
BOT_LOGIN="${BOT_LOGIN:-cipansor-bot}"
# There are no human-decision labels left: `bot-implement` was removed on
# 2026-11-11 (the fleet implements from `ready` now), and the release gate is a
# tag, not a label. Every label is the bot's, so EXEMPT_LABELS is empty and kept
# only so the variable can still be set for a one-off exception.
EXEMPT_LABELS="${EXEMPT_LABELS:-}"
# Labels the issue forms apply by themselves. Left in place so a fresh issue is
# not met with a revocation notice (#842).
ALLOWED_LABELS="${ALLOWED_LABELS:-bug enhancement documentation refactor chore security}"

REVOKE_MARK="<!-- label-guard:revoked -->"

# Whether the standard path revoked a label this run. `label-guard.yml` reads it
# to decide whether to call the triage bridge's `--relabel` mode (#838): a run
# that revoked nothing must not dispatch a relabel, or an ordinary human label on
# an untriaged issue would wake the triage owner. Written to $GITHUB_OUTPUT only
# when a label is actually removed; a no-op when run by hand. The workflow treats
# a missing value as "nothing revoked".
set_revoked() { echo "revoked=$1" >> "${GITHUB_OUTPUT:-/dev/null}"; }

# Every existing label except, on an issue, the repository's own template
# labels. Read once per run. On a pull request the template labels are *not*
# exempt, so a type label applied to a PR is protected and revoked like any other
# claim.
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
# that says the issue is still being discussed, decided, or waiting on something
# (#814 carried `ready` and `question` together, which makes the machine-readable
# state ambiguous). `question` and `blocked` win over `ready`.
#
# `blocked` belongs here because it is the same contradiction: an issue that
# cannot proceed until a dependency resolves is not one a contributor can pick
# up, which is exactly what `ready` promises. The two together also lie to the
# queue — `Tiket jadi PR` reads `ready` to pick its next ticket, so a `ready`
# that is also `blocked` would hand it a ticket it cannot start. One of them has
# to go, and it is always
# `ready`: `blocked` carries the harder information, and withdrawing it would
# claim the issue is startable again (aturan pemilik, 2026-11-10).
#
# The decision is made from the issue's *effective* label set: the event's own
# label counts unless the standard path below is about to revoke it (an
# unauthorized actor applied a protected, non-human-decision label). Ignoring it
# when it will be revoked is what lets the standard path's removal resolve a
# conflict the event itself created — a human adding `question` beside `ready`
# is resolved by removing `question`, not `ready`. But any exclusion still
# present after that removal keeps the conflict, so `ready` must go: `ready` +
# `blocked` with a human adding `question` is still `ready` + `blocked`.
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
  for excl in question blocked; do
    printf '%s\n' "$effective" | grep -qxF "$excl" && conflict="$excl"
  done
fi
if [ -n "$conflict" ]; then
  if ! gh api -X DELETE "repos/$REPO/issues/$NUMBER/labels/ready" >/dev/null 2>&1; then
    echo "::error::Could not remove the contradictory 'ready' label from #$NUMBER."
    exit 1
  fi
  echo "Removed 'ready' from #$NUMBER: it contradicts '$conflict'."
  set_revoked 1
  if ! gh api --paginate "repos/$REPO/issues/$NUMBER/comments?per_page=100" \
      --jq '.[].body' 2>/dev/null | grep -qF "$READY_MARK"; then
    if [ "$conflict" = "blocked" ]; then
      RWHY="masih terhalang ketergantungan, jadi belum bisa dikerjakan siapa pun. Label \`ready\` dan \`blocked\` tidak boleh berdampingan; \`ready\` ditahan sampai penghambatnya hilang. \`blocked\` tetap dipasang supaya issue ini tidak ikut ditutup \`stale-sweep\`."
    else
      RWHY="masih punya pertanyaan terbuka atau menunggu keputusan, jadi belum siap dikerjakan. \`ready\` hanya diberikan bila sangat yakin — tanpa pertanyaan terbuka. Hilangkan dulu \`$conflict\`-nya (jawab pertanyaannya, atau putuskan), lalu \`ready\` boleh dipasang lagi."
    fi
    RBODY="Label \`ready\` dicabut dari #$NUMBER karena bertentangan dengan \`$conflict\`: issue yang $RWHY

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

# A label named in EXEMPT_LABELS is the maintainer's to apply. The set is empty
# by default; it exists so a one-off exception can be set for a single run.
if [ -n "$EXEMPT_LABELS" ] && printf '%s\n' $EXEMPT_LABELS | grep -qxF "$LABEL"; then
  echo "Label '$LABEL' is an exempt label; left in place."
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
set_revoked 1

# Say so once. The permission decides both the escalation pointer and what the
# actor is told to do next. `Bot sebutan` (SDLC 07) admits a mention by the
# comment author's *association*, and `COLLABORATOR` covers every collaborator
# role — including `triage`, which is exactly the permission a person needs to
# apply a label. So `triage` belongs on the mention path, not the outsider one.
#
# `read` is the outsider signal, not `none`: `GET /collaborators/<user>/permission`
# answers `read`/`read` for an unrelated public account (`triage` for a triage
# collaborator, `admin` for the owner — verified 2026-11-11). Both fields are read
# because `role_name` is the finer one; the notice is posted only when a label was
# actually revoked, which itself requires `triage`+, so the `read` branch is the
# rare case of a manual invocation rather than a label event.
PERMS=$(gh api "repos/$REPO/collaborators/$ACTOR/permission" \
  --jq '"\(.permission // "none") \(.role_name // "none")"' 2>/dev/null || echo "none none")
ALERT=""
case " $PERMS " in
  *" admin "* | *" maintain "* | *" write "* | *" triage "*)
    ASK="sebut \`@cipansor-bot\` dengan apa yang Anda inginkan, lalu bot menindaklanjutinya — memasang label yang jelas, atau membuka issue ber-\`ready\` bila itu pekerjaan baru." ;;
  *)
    ASK="mintakan penilaian kepada maintainer (\`@adminypc\`) di thread ini; bot tidak memproses permintaan dari akun di luar kolaborator."
    ALERT=" (@adminypc tolong tinjau)" ;;
esac

BODY="Label \`$LABEL\` dicabut dari $KIND #$NUMBER: hanya \`$BOT_LOGIN\` yang boleh memasang label di repositori ini. Label adalah antarmuka mesin antara automasi dan workflow (docs/LABELS.md), jadi label manual membuat keduanya berbeda pendapat soal keadaan sebenarnya. Label tidak dipasang atas permintaan langsung: $ASK$ALERT

$REVOKE_MARK"

# One notice per item: a repeat run must not stack comments.
if gh api --paginate "repos/$REPO/issues/$NUMBER/comments?per_page=100" \
    --jq '.[].body' 2>/dev/null | grep -qF "$REVOKE_MARK"; then
  echo "A revocation notice already exists on #$NUMBER; not repeating."
  exit 0
fi
gh api "repos/$REPO/issues/$NUMBER/comments" -f body="$BODY" >/dev/null \
  || echo "::warning::could not post the revocation notice on #$NUMBER."
