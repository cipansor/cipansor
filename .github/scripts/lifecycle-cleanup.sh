#!/bin/sh
# Release the lifecycle labels when an issue closes.
#
# `ready` and `in-progress` describe an *open* issue's place in the pipeline:
# `ready` means "specified enough to be picked up", `in-progress` means someone
# is working on it (docs/LABELS.md). A closed issue is neither, and leaving the
# labels on makes the machine-readable state lie — 136 closed issues still
# carried them (e.g. #857, whose PR merged and which closed two seconds later
# with `ready` still attached, #1083). The fix is a consequence, not a
# judgement, so it belongs in GitHub Actions (docs/SDLC-FLOW.md invariant 2).
#
# Only these two labels are released. `stale`, `question`, `duplicate` and the
# type/priority labels are left alone: the taxonomy keeps them as the record of
# why the issue closed, and `stale-sweep.sh` closes a `stale` issue precisely so
# the label stays readable afterwards.
#
# The removal is made by `cipansor-bot`, so `label-guard.sh` treats it as
# deliberate and never restores the label (it restores only a bot-applied label
# a *person* removed).
#
# Usage: lifecycle-cleanup.sh <number>    # one closed issue
#        lifecycle-cleanup.sh --sweep     # every closed issue still carrying them
# Env:   GH_TOKEN, REPO (owner/name)
set -eu

REPO="${REPO:?REPO is required}"
LIFECYCLE_LABELS='ready in-progress'

labels_of() { gh api "repos/$REPO/issues/$1/labels" --jq '.[].name' 2>/dev/null || true; }

has() { printf '%s\n' "$1" | grep -qxF "$2"; }

# Strip both lifecycle labels from one issue. One `gh issue edit` carrying every
# flag, the same shape `issue-claim.sh` uses: two calls could die between them
# and leave one label behind.
release_issue() { # <issue-number>
  N="$1"
  LABELS=$(labels_of "$N")
  drop=""
  for L in $LIFECYCLE_LABELS; do
    has "$LABELS" "$L" && drop="$drop $L"
  done
  if [ -z "$drop" ]; then
    echo "issue #$N carries no lifecycle label; nothing to release."
    return 0
  fi
  args=""
  for L in $drop; do args="$args --remove-label $L"; done
  # shellcheck disable=SC2086 # the flags are built word by word on purpose
  if ! gh issue edit "$N" --repo "$REPO" $args >/dev/null; then
    echo "::error::could not release the lifecycle label(s)$drop from issue #$N."
    return 1
  fi
  echo "released the lifecycle label(s)$drop from issue #$N."
}

if [ "${1:-}" = "--sweep" ]; then
  # The repair pass for the backlog and for any closure whose event never
  # arrived. The search API is the only listing that filters by label on a
  # closed issue cheaply, so one query per label (search has no OR across label
  # qualifiers: `label:ready label:in-progress` would mean *both*).
  FOUND=$(mktemp)
  for L in $LIFECYCLE_LABELS; do
    page=1
    while :; do
      if ! items=$(gh api -X GET search/issues \
          -f q="repo:$REPO is:issue is:closed label:$L" -f per_page=100 \
          -f page="$page" --jq '.items[].number' 2>/dev/null); then
        # A failed listing must not look like "none left": that would report
        # success while closed issues keep their labels.
        echo "::error::could not list closed issues labelled '$L'; the sweep cannot reconcile."
        rm -f "$FOUND"
        exit 1
      fi
      [ -n "$items" ] || break
      printf '%s\n' "$items" >> "$FOUND"
      got=$(printf '%s\n' "$items" | grep -c . || true)
      [ "$got" -ge 100 ] || break
      page=$((page + 1))
    done
  done
  sort -u -o "$FOUND" "$FOUND"
  if [ ! -s "$FOUND" ]; then
    echo "No closed issue carries a lifecycle label; nothing to release."
    rm -f "$FOUND"
    exit 0
  fi
  # A pipeline runs the loop in a subshell, so a failure recorded in a variable
  # would be lost; a temp file survives it, and the sweep must not report
  # success while a release it found went unmade.
  FAILS=$(mktemp)
  while read -r n; do
    [ -n "$n" ] || continue
    release_issue "$n" || echo "release failed for issue #$n" >> "$FAILS"
  done < "$FOUND"
  rm -f "$FOUND"
  if [ -s "$FAILS" ]; then
    cat "$FAILS"
    rm -f "$FAILS"
    exit 1
  fi
  rm -f "$FAILS"
  echo "sweep done"
  exit 0
fi

N="${1:?usage: lifecycle-cleanup.sh <issue-number> | --sweep}"
release_issue "$N"
