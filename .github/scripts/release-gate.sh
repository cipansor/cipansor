#!/bin/sh
# Refuse a production release whose prerequisites are not already satisfied.
#
# Why this is a gate and not a judgement: every prerequisite of a release is a
# fact a script can read, not a call an LLM has to make.
#
#   1. the SHA is a real 40-character commit;
#   2. staging is already serving that exact SHA — it was built, tested and
#      pushed by `deploy-staging.yml`, and `wait-for-release.sh` can confirm it;
#   3. a k6 smoke run for that SHA finished green.
#
# Before this gate, all three were prose in `docs/deploy-azure.md` and a
# `workflow_dispatch(sha)` a human had to remember to check by hand. A human who
# forgot could release a SHA staging never ran, or skip the load test. The gate
# makes the prose mechanical: `deploy-production.yml` runs it as its first job
# and the deploy job waits on it.
#
# It does NOT decide whether a release SHOULD happen — that stays the
# maintainer's call. It only refuses one whose facts are not in place.
#
# Usage: release-gate.sh
# Env:   SHA (required), REPO, GH_TOKEN, STAGING_URL, LOAD_WORKFLOW,
#        LOAD_PROBE_ATTEMPTS, RELEASE_GATE_DRY_RUN (print, never fail on probe)
set -eu

SHA="${SHA:?SHA is required}"
REPO="${REPO:?REPO is required}"
STAGING_URL="${STAGING_URL:-https://staging.cipansor.or.id}"
LOAD_WORKFLOW="${LOAD_WORKFLOW:-load-tests.yml}"
LOAD_PROBE_ATTEMPTS="${LOAD_PROBE_ATTEMPTS:-3}"
DRY="${RELEASE_GATE_DRY_RUN:-}"
CURL="${CURL:-curl}"

fail() {
  echo "::error title=Release gate::$1"
  exit 1
}

# --- 1. the SHA itself --------------------------------------------------------
# The full SHA is the image tag and what /health reports; a short one matches
# neither, so a truncated paste is refused before anything else happens.
case "$SHA" in
  *[!0-9a-f]* | '') fail "sha must be 40 lowercase hex characters, got '$SHA'" ;;
esac
[ "${#SHA}" -eq 40 ] || fail "sha must be 40 characters, got ${#SHA} ('$SHA')"

# --- 2. staging already serves this SHA ---------------------------------------
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

# --- 3. a green k6 smoke run for this SHA -------------------------------------
# `load-tests.yml` is not part of CI (it needs a reachable target), so its run is
# the only record that the load test was actually executed against this SHA.
# The run's head SHA is the ref it was dispatched on, so requiring a success on
# this SHA also requires the human to have dispatched it on the right commit.
RUNS=$(gh run list --repo "$REPO" --workflow "$LOAD_WORKFLOW" \
  --limit 100 --json headSha,conclusion,createdAt,url 2>/dev/null || true)

if [ -z "$RUNS" ] || [ "$RUNS" = "[]" ]; then
  if [ -n "$DRY" ]; then
    echo "[dry-run] no $LOAD_WORKFLOW run found (would refuse in a real run)"
    exit 0
  fi
  fail "could not read $LOAD_WORKFLOW runs for $REPO (missing token, or the workflow has never run)."
fi

GREEN=$(printf '%s' "$RUNS" | jq -r --arg sha "$SHA" \
  '[.[] | select(.headSha == $sha and .conclusion == "success")] | length')

if [ "$GREEN" -lt 1 ]; then
  if [ -n "$DRY" ]; then
    echo "[dry-run] no green $LOAD_WORKFLOW run for $SHA (would refuse in a real run)"
    exit 0
  fi
  fail "no green $LOAD_WORKFLOW run for $SHA. Run it first: \`gh workflow run $LOAD_WORKFLOW --ref $SHA\` — a release is not allowed to skip the load test."
fi

echo "Release gate passed for $SHA (staging serves it; $GREEN green $LOAD_WORKFLOW run(s))."
