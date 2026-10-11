#!/usr/bin/env bash
# Deploy watchdog — report a deploy that failed, hung, or left its site
# unhealthy as a GitHub issue. It is read-only with respect to the deployment:
# it never rolls back, reruns, or repoints a container. A human decides.
#
#   GITHUB_REPOSITORY=org/repo GH_TOKEN=... bash .github/scripts/deploy-watch.sh
#
# DEPLOY_WATCH_DRY_RUN=1 prints what it would open without creating anything.
#
# It runs when a deploy finishes (deploy-watch.yml), not on a clock: the
# deploys are what change the sites. A site that degrades later with no deploy
# is the platform's to report (App Service Health check, an availability
# test). This is the automated form of the manual step the WebKit lesson
# records ("after any merge, check that staging moved",
# .claude/memory/lessons/webkit-seen-only-after-merge.md).
#
# The endpoint it probes and the commit it expects are the same ones
# deploy/azure/wait-for-release.sh uses, so a "healthy" verdict means the same
# thing the deploy job meant by it.
set -uo pipefail

REPO=${GITHUB_REPOSITORY:-}
TOKEN=${GH_TOKEN:-${GITHUB_TOKEN:-}}
API=${GITHUB_API_URL:-https://api.github.com}
LABEL=${DEPLOY_WATCH_LABEL:-deploy-watch}
STUCK_MINUTES=${DEPLOY_WATCH_STUCK_MINUTES:-45}
DRY_RUN=${DEPLOY_WATCH_DRY_RUN:-0}
NOW=$(date -u +%s)

# name|workflow file|public base url — the two workflows that reach a site.
WORKFLOWS=${DEPLOY_WATCH_WORKFLOWS:-'Deploy staging|deploy-staging.yml|https://staging.cipansor.or.id
Deploy production|deploy-production.yml|https://cipansor.or.id'}

if [ -z "$REPO" ]; then
  echo "deploy-watch: GITHUB_REPOSITORY is required" >&2
  exit 1
fi
if [ -z "$TOKEN" ] && [ "$DRY_RUN" != 1 ]; then
  echo "deploy-watch: GH_TOKEN (or GITHUB_TOKEN) is required" >&2
  exit 1
fi

auth=()
[ -n "$TOKEN" ] && auth=(-H "Authorization: Bearer $TOKEN")

# The last HTTP status. Written to a file, not a variable: callers capture the
# body with `x=$(req ...)`, which runs req in a subshell — a variable set there
# never reaches the caller.
CODE_FILE=$(mktemp)
# A workflow whose runs could not be read: the watch saw nothing, which must
# not end green (lesson github-actions-minutes-exhausted, "a monitor that
# hears nothing"). Written to a file because check() runs in a pipe.
BLIND_FILE=$(mktemp)
trap 'rm -f "$CODE_FILE" "$BLIND_FILE"' EXIT
httpcode() { cat "$CODE_FILE" 2>/dev/null || echo ""; }

req() { # req <GET|POST> <url> [data-file] -> body on stdout; httpcode() set
  local method=$1 url=$2 datafile=${3:-} out code
  out=$(mktemp)
  if [ "$method" = POST ]; then
    if [ -n "$datafile" ]; then
      code=$(curl -sS --max-time 30 -X POST "${auth[@]}" \
        -H 'Accept: application/vnd.github+json' -H 'Content-Type: application/json' \
        --data-binary @"$datafile" -o "$out" -w '%{http_code}' "$url" 2>/dev/null || true)
    else
      code=$(curl -sS --max-time 30 -X POST "${auth[@]}" \
        -H 'Accept: application/vnd.github+json' -H 'Content-Type: application/json' \
        -d '{}' -o "$out" -w '%{http_code}' "$url" 2>/dev/null || true)
    fi
  else
    # -L: a job's logs answer 302 to a signed blob URL. curl drops the
    # Authorization header on a redirect to another host, which the signed URL
    # does not need.
    code=$(curl -sS -L --max-time 30 "${auth[@]}" \
      -H 'Accept: application/vnd.github+json' \
      -o "$out" -w '%{http_code}' "$url" 2>/dev/null || true)
  fi
  printf '%s' "$code" > "$CODE_FILE"
  cat "$out" 2>/dev/null || true
  rm -f "$out"
}

probe() { # probe <url> -> body on stdout; httpcode() set (no auth, like a visitor)
  local url=$1 out code
  out=$(mktemp)
  code=$(curl -sS --max-time 20 -H 'Cache-Control: no-cache' \
    -o "$out" -w '%{http_code}' "$url" 2>/dev/null || true)
  printf '%s' "$code" > "$CODE_FILE"
  cat "$out" 2>/dev/null || true
  rm -f "$out"
}

post_json() { # post_json <url> <json> -> body on stdout; httpcode() set
  local f
  f=$(mktemp)
  printf '%s' "$2" > "$f"
  req POST "$1" "$f"
  rm -f "$f"
}

log() { echo "deploy-watch: $*"; }

iso_to_epoch() { date -u -d "$1" +%s 2>/dev/null || echo 0; }

ensure_label() {
  local payload
  payload=$(jq -n --arg l "$LABEL" \
    '{name:$l, color:"b60205", description:"Automatic deploy watchdog report"}')
  post_json "$API/repos/$REPO/labels" "$payload" >/dev/null
  # 201 created, 422 already exists — both fine.
}

# collect_logs <run-id> -> the failing job's key log lines (empty if unavailable)
collect_logs() {
  local rid=$1 jobs jid logs raw matched
  jobs=$(req GET "$API/repos/$REPO/actions/runs/$rid/jobs")
  [ "$(httpcode)" = 200 ] || return 0
  jid=$(printf '%s' "$jobs" | jq -r '(.jobs // []) | map(select(.conclusion != null and .conclusion != "success")) | .[0].id // empty')
  [ -n "$jid" ] || jid=$(printf '%s' "$jobs" | jq -r '(.jobs // []) | .[0].id // empty')
  [ -n "$jid" ] || return 0
  logs=$(req GET "$API/repos/$REPO/actions/jobs/$jid/logs")
  [ "$(httpcode)" = 200 ] || return 0
  raw=$(printf '%s' "$logs" | sed -E 's/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z //')
  matched=$(printf '%s' "$raw" \
    | grep -aE '::error|##\[error\]|not answering|failed|Failed|ERROR|Error:|timeout|Timeout|timed out' \
    | tail -n 25)
  # If nothing matched the error words, still show the tail — an empty log
  # section reads as "no problem" (lesson: github-actions-minutes-exhausted).
  if [ -n "$matched" ]; then
    printf '%s' "$matched"
  else
    printf '%s' "$raw" | grep -av '^[[:space:]]*$' | tail -n 25
  fi
}

# report <name> <workflow-file> <run-json> <kind> <why> [evidence]
report() {
  local name=$1 wf=$2 run=$3 kind=$4 why=$5 extra=${6:-}
  local id sha url marker existing logs title body payload resp
  id=$(printf '%s' "$run" | jq -r '.id')
  sha=$(printf '%s' "$run" | jq -r '.head_sha')
  url=$(printf '%s' "$run" | jq -r '.html_url')
  marker="deploy-watch:run=$id"

  # Closed ones too: closing a report while its run is still the latest must
  # not raise the same report again on the next check.
  existing=$(req GET "$API/repos/$REPO/issues?state=all&labels=$LABEL&per_page=100")
  if [ "$(httpcode)" = 200 ] && printf '%s' "$existing" \
    | jq -e --arg m "$marker" '[.[]? | (.body // "") | contains($m)] | any' >/dev/null 2>&1; then
    log "$name: run $id already reported (open issue carries $marker) — nothing to do"
    return 0
  fi

  logs=""
  [ "$kind" != degraded ] && logs=$(collect_logs "$id")

  title="Deploy watchdog: $name run $id $kind"
  # Built with quoted printf arguments, never an unquoted heredoc: a heredoc
  # would run the backticks in this Markdown (lesson: gh-cli-and-shell-traps).
  body=$(printf '%s\n' \
    "<!-- $marker -->" \
    "## Deploy watchdog — $name $kind" \
    "" \
    "**Workflow:** $name (\`$wf\`)" \
    "**Run:** [$id]($url) — commit \`$sha\`" \
    "**State:** $kind" \
    "**Detected:** $(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "" \
    "### Why" \
    "$why")
  if [ -n "$extra" ]; then
    body="$body$(printf '\n\n### Evidence\n%s' "$extra")"
  fi
  if [ -n "$logs" ]; then
    body="$body$(printf '\n\n### Log lines\n```\n%s\n```' "$logs")"
  fi
  body="$body$(printf '\n\n> Opened automatically by the deploy watchdog. It does not roll anything back — a human decides. A later failure of the same run will not open a second issue. Release procedure: `docs/deploy-azure.md` → "How a change is released".')"

  if [ "$DRY_RUN" = 1 ]; then
    echo "----- would open issue: $title"
    printf '%s\n' "$body"
    return 0
  fi

  payload=$(mktemp)
  jq -n --arg t "$title" --arg b "$body" --arg l "$LABEL" \
    '{title:$t, body:$b, labels:[$l]}' > "$payload"
  resp=$(req POST "$API/repos/$REPO/issues" "$payload")
  rm -f "$payload"
  if [ "$(httpcode)" = 201 ]; then
    log "$name: opened issue #$(printf '%s' "$resp" | jq -r '.number // "?"') for run $id ($kind)"
  else
    log "$name: could not open an issue for run $id (HTTP $(httpcode)): $(printf '%s' "$resp" | head -c 200)"
  fi
}

# check <name> <workflow-file> <base-url>
check() {
  local name=$1 wf=$2 base=$3 runs latest id status conclusion sha created url age health hcode hcommit man mcode
  runs=$(req GET "$API/repos/$REPO/actions/workflows/$wf/runs?per_page=15")
  if [ "$(httpcode)" != 200 ]; then
    log "$name: could not list runs (HTTP $(httpcode))"
    printf '%s (HTTP %s)\n' "$name" "$(httpcode)" >> "$BLIND_FILE"
    return 0
  fi
  # A `skipped` run deployed nothing: its gate job did not run because CI or
  # E2E did not pass on main. That failure is upstream and is reported there
  # (main-failure-bridge.yml); calling it a failed deploy would raise a second
  # alert for one problem. The run that matters is the latest one that tried.
  latest=$(printf '%s' "$runs" | jq -c '(.workflow_runs // []) | map(select(.conclusion != "skipped")) | sort_by(.created_at) | last // empty')
  if [ -z "$latest" ] || [ "$latest" = null ]; then
    log "$name: no runs to watch"
    return 0
  fi

  id=$(printf '%s' "$latest" | jq -r '.id')
  status=$(printf '%s' "$latest" | jq -r '.status')
  conclusion=$(printf '%s' "$latest" | jq -r '.conclusion // ""')
  sha=$(printf '%s' "$latest" | jq -r '.head_sha')
  created=$(printf '%s' "$latest" | jq -r '.created_at')
  url=$(printf '%s' "$latest" | jq -r '.html_url')

  if [ "$status" != completed ]; then
    age=$(( NOW - $(iso_to_epoch "$created") ))
    if [ "$age" -gt $(( STUCK_MINUTES * 60 )) ]; then
      report "$name" "$wf" "$latest" stuck \
        "The run has been '$status' for $(( age / 60 )) minutes (threshold ${STUCK_MINUTES}m). A hung or cancelled workflow never deploys, so the commit it carries is not live — the shape that let the WebKit timeout hold staging back (lesson: webkit-seen-only-after-merge)." \
        "run status: $status for $(( age / 60 )) minutes (created $created)"
    else
      log "$name: run $id is $status ($(( age / 60 ))m old) — within the ${STUCK_MINUTES}m threshold"
    fi
    return 0
  fi

  if [ "$conclusion" != success ]; then
    report "$name" "$wf" "$latest" failed \
      "The run ended '$conclusion'. Staging keeps its previous release and production was not released — nothing was rolled back. Read the failed job's log lines below, then re-run or release a fix." \
      "run conclusion: $conclusion"
    return 0
  fi

  # Green but nothing deployed: with no code between the commit staging runs
  # and this one, its `Update …` job is skipped and the site keeps serving the
  # earlier commit on purpose (docs/deploy-azure.md, step 2). Only check that
  # the site answers; the commit it reports is not this run's.
  local jobs expected=$sha
  jobs=$(req GET "$API/repos/$REPO/actions/runs/$id/jobs")
  if [ "$(httpcode)" = 200 ] && printf '%s' "$jobs" \
    | jq -e '[(.jobs // [])[] | select((.name | startswith("Update ")) and .conclusion == "skipped")] | length > 0' >/dev/null 2>&1; then
    expected=""
  fi

  # Green — verify the site actually serves this commit (the deploy job's own
  # acceptance test, re-run later in case the site degraded since).
  health=$(probe "$base/healthz?release=$sha")
  hcode=$(httpcode)
  hcommit=$(printf '%s' "$health" | jq -r '.commit // empty' 2>/dev/null || true)
  if [ "$hcode" != 200 ] || { [ -n "$expected" ] && [ "$hcommit" != "$expected" ]; }; then
    report "$name" "$wf" "$latest" degraded \
      "The run is green but $base/healthz is not answering with this commit. The site is not serving what the workflow released — the api container may be restarting or a migration failed on start." \
      "$base/healthz: HTTP ${hcode:-000}, commit '${hcommit:-none}', expected $sha
body: $(printf '%s' "$health" | head -c 400)"
    return 0
  fi

  man=$(probe "$base/manifest.json")
  mcode=$(httpcode)
  if [ "$mcode" != 200 ]; then
    report "$name" "$wf" "$latest" degraded \
      "The api reports commit $sha at $base, but $base/manifest.json (nginx -> web) returned HTTP ${mcode:-000}: the web container is not answering." \
      "$base/manifest.json: HTTP ${mcode:-000}"
    return 0
  fi

  if [ -n "$expected" ]; then
    log "$name: run $id success — $base is serving $sha (api and web)"
  else
    log "$name: run $id deployed nothing (no code changed) — $base answers, serving ${hcommit:-?}"
  fi
}

main() {
  log "threshold ${STUCK_MINUTES}m, dry-run=$DRY_RUN, label '$LABEL'"
  [ "$DRY_RUN" = 1 ] || ensure_label
  printf '%s\n' "$WORKFLOWS" | while IFS='|' read -r name wf base; do
    [ -n "${wf:-}" ] || continue
    check "$name" "$wf" "$base"
  done
  if [ -s "$BLIND_FILE" ]; then
    echo "::error::deploy-watch could not read the runs of: $(paste -sd, "$BLIND_FILE"). Nothing was checked for them (does the token have actions: read?)."
    exit 1
  fi
}

main "$@"
