#!/bin/sh
# Refuse a production release whose prerequisites are not already satisfied.
#
# Why this is a gate and not a judgement: every prerequisite of a release is a
# fact a script can read, not a call an LLM has to make.
#
#   release (a `v*` tag was pushed):
#     1. the tag is an official release — `vX.Y.Z`, never a `-rc` prerelease;
#     2. the tag points at a commit on `main` (nothing off-branch is releasable);
#     3. the SHA is a real 40-character commit;
#     4. staging is already serving that exact SHA;
#     5. a k6 smoke run for that SHA finished green against staging.
#   rollback (a human dispatched an older SHA):
#     only 3, plus that the SHA is a commit on `main`. A rollback target is by
#     definition a commit staging no longer serves and whose load test is long
#     past, so requiring 4 and 5 would make rollback impossible — exactly when it
#     is needed. But it must still be a commit `main` already carried: otherwise
#     a dispatcher could point production at code no release ever approved. The
#     `deploy` job still refuses a SHA whose images were never built.
#
# Before this gate, all of it was prose in `docs/deploy-azure.md` and a
# `workflow_dispatch(sha)` a human had to remember to check by hand. A human who
# forgot could release a SHA staging never ran, or skip the load test.
#
# It does NOT decide whether a release SHOULD happen — that stays the
# maintainer's call. It only refuses one whose facts are not in place.
#
# Usage: release-gate.sh
# Env:   SHA (required), REPO, GH_TOKEN, STAGING_URL, LOAD_URL, LOAD_WORKFLOW,
#        LOAD_PROBE_ATTEMPTS, MODE (release|rollback), TAG, MAIN_REF,
#        RELEASE_GATE_DRY_RUN (print, never fail on probe)
set -eu

SHA="${SHA:?SHA is required}"
REPO="${REPO:?REPO is required}"
STAGING_URL="${STAGING_URL:-https://staging.cipansor.or.id}"
# The target the load test must have measured. `load-tests.yml`'s `url` input is
# free-form, so a green run proves only that *some* host passed; the run title
# records the host it actually used, and that is compared against this.
LOAD_URL="${LOAD_URL:-https://staging.cipansor.or.id}"
LOAD_WORKFLOW="${LOAD_WORKFLOW:-load-tests.yml}"
LOAD_PROBE_ATTEMPTS="${LOAD_PROBE_ATTEMPTS:-3}"
MODE="${MODE:-release}"
TAG="${TAG:-}"
DRY="${RELEASE_GATE_DRY_RUN:-}"
CURL="${CURL:-curl}"
# The ref a commit must be an ancestor of to be releasable. Overridable so the
# guard tests can point it at a temporary repository instead of a real remote.
MAIN_REF="${MAIN_REF:-origin/main}"

fail() {
  echo "::error title=Release gate::$1"
  exit 1
}

# Is <commit-ish> an ancestor of the release branch? Both a pushed release tag
# and a dispatched rollback SHA must be commits `main` already carried: one path
# ships what main has, the other returns to something main once had.
on_main() { # on_main <commit-ish>
  git merge-base --is-ancestor "$1" "$MAIN_REF" 2>/dev/null
}

case "$MODE" in
  release | rollback) ;;
  *) fail "MODE must be 'release' or 'rollback', got '$MODE'" ;;
esac

# --- 1. an official release tag, not a prerelease -----------------------------
# SDLC 13 used to cut `-rc` tags weekly; it is retired, and nothing ever consumed
# those tags. A release is now a human pushing `vX.Y.Z`, so anything else is
# refused: a `-rc` here would silently ship a candidate.
if [ -n "$TAG" ]; then
  case "$TAG" in
    v[0-9]*.[0-9]*.[0-9]*) ;;
    *) fail "tag '$TAG' is not a release tag; expected vX.Y.Z (no -rc, no suffix)" ;;
  esac
  ver=${TAG#v}
  case "$ver" in
    *[!0-9.]*) fail "tag '$TAG' is not a plain vX.Y.Z release tag" ;;
  esac
  # Exactly three parts: `v0.2.0.1` and `v0.2` are not release tags.
  dots=$(printf '%s' "$ver" | tr -cd '.' | wc -c | tr -d ' ')
  [ "$dots" -eq 2 ] || fail "tag '$TAG' is not a plain vX.Y.Z release tag"
fi

# --- 2. the tag points at a commit on `main` ----------------------------------
# Releasing a commit that is not on `main` would ship code no review, CI or E2E
# run ever saw. The gate job checks out with full history so this is answerable.
if [ -n "$TAG" ]; then
  git rev-parse --verify --quiet "refs/tags/$TAG" >/dev/null \
    || fail "tag '$TAG' is not present in this checkout"
  git rev-parse --verify --quiet "$MAIN_REF" >/dev/null \
    || fail "$MAIN_REF is not available; the gate must fetch it to check the tag"
  if ! on_main "$TAG^{commit}"; then
    fail "tag '$TAG' does not point at a commit on main; release only what main has"
  fi
  echo "Tag $TAG is an official release on main."
fi

# --- 3. the SHA itself --------------------------------------------------------
# The full SHA is the image tag and what /health reports; a short one matches
# neither, so a truncated paste is refused before anything else happens.
case "$SHA" in
  *[!0-9a-f]* | '') fail "sha must be 40 lowercase hex characters, got '$SHA'" ;;
esac
[ "${#SHA}" -eq 40 ] || fail "sha must be 40 characters, got ${#SHA} ('$SHA')"

if [ "$MODE" = "rollback" ]; then
  # A rollback is an explicit human act on an older, already-verified SHA. Its
  # prerequisites (staging serving it, a green load test) are stale by
  # definition, so this mode stops here and lets `deploy` check the images. It is
  # not unconstrained, though: the target must be a commit `main` carried, or a
  # dispatcher could point production at code no release ever approved.
  git rev-parse --verify --quiet "$MAIN_REF" >/dev/null \
    || fail "$MAIN_REF is not available; the gate must fetch it to check the rollback target"
  if ! on_main "$SHA"; then
    fail "rollback sha '$SHA' is not a commit on main; release only what main has"
  fi
  echo "Rollback mode: shape checked for $SHA; staging and load-test checks skipped by design."
  exit 0
fi

# --- 4. staging already serves this SHA ---------------------------------------
# The same probe the deploy workflows use, but non-blocking: a gate asks whether
# the fact is true now, it does not wait for it to become true. Staging gets the
# SHA from `deploy-staging.yml`, which runs after E2E passes on `main`.
probe_commit() {
  $CURL -s --max-time 15 -H 'Cache-Control: no-cache' "$STAGING_URL/healthz?release=$SHA" 2>/dev/null \
    | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([0-9a-f]\{7,40\}\)".*/\1/p' | head -1
}

served=""
attempt=1
while [ "$attempt" -le "$LOAD_PROBE_ATTEMPTS" ]; do
  served=$(probe_commit || true)
  if [ "$served" = "$SHA" ]; then
    break
  fi
  if [ "$attempt" -lt "$LOAD_PROBE_ATTEMPTS" ]; then
    sleep 10
  fi
  attempt=$((attempt + 1))
done

if [ -n "$DRY" ]; then
  echo "[dry-run] staging $STAGING_URL reports commit '${served:-none}' (want $SHA)"
else
  if [ "$served" != "$SHA" ]; then
    fail "staging ($STAGING_URL) reports commit '${served:-none}', not $SHA. Release only what staging has actually run: let \`deploy-staging.yml\` finish for this SHA first."
  fi
  echo "Staging serves $SHA."
fi

# --- 5. a green k6 smoke run for this SHA, against staging --------------------
# `load-tests.yml` is not part of CI (it needs a reachable target), so its run is
# the only record that the load test was actually executed against this SHA. But
# headSha alone proves nothing about WHERE a run measured: the workflow's `url`
# input is free-form, so a green run against a throwaway host would otherwise
# satisfy the gate. The workflow's `run-name` records the target it was actually
# pointed at, so the gate reads that back and requires it to name staging.
RUNS=$(gh run list --repo "$REPO" --workflow "$LOAD_WORKFLOW" \
  --limit 100 --json headSha,conclusion,createdAt,url,displayTitle 2>/dev/null || true)

if [ -z "$RUNS" ] || [ "$RUNS" = "[]" ]; then
  if [ -n "$DRY" ]; then
    echo "[dry-run] no $LOAD_WORKFLOW run found (would refuse in a real run)"
    exit 0
  fi
  fail "could not read $LOAD_WORKFLOW runs for $REPO (missing token, or the workflow has never run)."
fi

# A run qualifies only if it measured this SHA, succeeded, and its title names
# the staging target. `displayTitle` is the workflow's `run-name`, built from the
# same `inputs` the runner used, so it cannot disagree with what was measured.
GREEN=$(printf '%s' "$RUNS" | jq -r --arg sha "$SHA" --arg url "$LOAD_URL" \
  '[.[] | select(.headSha == $sha and .conclusion == "success" and (.displayTitle | contains($url)))] | length')

if [ "$GREEN" -lt 1 ]; then
  if [ -n "$DRY" ]; then
    echo "[dry-run] no green $LOAD_WORKFLOW run for $SHA against $LOAD_URL (would refuse in a real run)"
    exit 0
  fi
  fail "no green $LOAD_WORKFLOW run for $SHA against $LOAD_URL. Run it first: \`gh workflow run $LOAD_WORKFLOW --ref $SHA\` — a release is not allowed to skip the load test, and a run against another host does not prove staging."
fi

echo "Release gate passed for $SHA (staging serves it; $GREEN green $LOAD_WORKFLOW run(s) against $LOAD_URL)."
