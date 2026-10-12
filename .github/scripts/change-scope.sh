#!/bin/sh
# Does this change touch code? The one answer CI, E2E and the staging deploy
# share, so a documentation-only change does not spend runner minutes on lint,
# builds, tests, the E2E suite and an image rebuild that cannot come out
# differently.
#
#   change-scope.sh classify              stdin: paths; stdout: the ones that are code
#   change-scope.sh pr <number>           the pull request's files
#   change-scope.sh since-pass <workflow> push to main: everything since the last
#                                         commit on which <workflow> passed
#   change-scope.sh between <base> <head> two commits (the staging deploy)
#
# The last three write `run=true|false` to $GITHUB_OUTPUT (the key can be
# changed with SCOPE_KEY) and print the reason. Every doubt answers `true`: a
# file list that cannot be read, a list the API may have truncated, history
# that is not a straight line. Skipping a needed run is the expensive mistake.
#
# Why "since the last pass" on main and not "since the previous commit":
# concurrency cancels a run when the next commit lands. If a code commit's run
# is cancelled by a docs-only commit that then compares itself only to its
# parent, the code is never tested. Comparing with the last commit that passed
# covers everything the cancelled run would have. That works by induction,
# because a skipped run only passes when its own change was not code.
#
# POSIX sh on purpose: the unit test runs it inside the gate's Alpine container.
set -u

# Paths that nothing builds, lints, tests or ships. A file that a test READS is
# code, whatever its extension. List it in the first branch: the first
# matching pattern wins. change-scope.guard.test.ts fails if a test reads a
# markdown file that this function calls non-code.
is_code() {
  case "$1" in
    docs/DEPLOYMENT.md) return 0 ;; # decommissioned-modules.guard.test.ts pins its numbers
    docs/LABELS.md) return 0 ;; # the label/lifecycle guard tests read it
    .claude/hooks/guard.sh) return 0 ;; # agent-guard.guard.test.ts runs it
    *.md | docs/* | .claude/* | .github/ISSUE_TEMPLATE/* | LICENSE | LICENSE.*) return 1 ;;
    *) return 0 ;;
  esac
}

classify() {
  while IFS= read -r path; do
    [ -n "$path" ] || continue
    if is_code "$path"; then printf '%s\n' "$path"; fi
  done
}

decide() {
  echo "${SCOPE_KEY:-run}=$1" >> "${GITHUB_OUTPUT:-/dev/null}"
  echo "scope: ${SCOPE_KEY:-run}=$1 — $2"
  exit 0
}

# Decide from a file list (renames contribute both names).
decide_from() {
  files=$1 cap=$2
  total=$(printf '%s\n' "$files" | grep -c . || true)
  [ "$total" -lt "$cap" ] || decide true "$total files: the API caps this list at $cap, it may be incomplete"
  code=$(printf '%s\n' "$files" | classify | grep -c . || true)
  [ "$code" -eq 0 ] && decide false "no code among $total changed file(s) — documentation / agent tooling only"
  decide true "$code of $total changed file(s) are code"
}

# compare <base> <head>: decide on the difference, fail open on anything odd.
compare() {
  base=$1 head=$2
  body=$(gh api "repos/$GITHUB_REPOSITORY/compare/$base...$head") || decide true "could not compare $base...$head"
  status=$(printf '%s' "$body" | jq -r '.status')
  [ "$status" = identical ] && decide false "$head is identical to $base"
  [ "$status" = ahead ] || decide true "$head is $status relative to $base, not a straight line"
  files=$(printf '%s' "$body" | jq -r '.files[] | .filename, (.previous_filename // empty)')
  decide_from "$files" 300
}

mode=${1:-}
case "$mode" in
  classify)
    classify
    ;;
  pr)
    files=$(gh api --paginate "repos/$GITHUB_REPOSITORY/pulls/$2/files" \
      --jq '.[] | .filename, (.previous_filename // empty)') || decide true "could not list the files of #$2"
    decide_from "$files" 3000
    ;;
  since-pass)
    base=$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/$2/runs?branch=main&event=push&status=success&per_page=1" \
      --jq '.workflow_runs[0].head_sha // empty') || decide true "could not look up the last passing run of $2"
    [ -n "$base" ] || decide true "$2 has never passed on main"
    [ "$base" != "$GITHUB_SHA" ] || decide true "re-run of a commit that already passed"
    compare "$base" "$GITHUB_SHA"
    ;;
  between)
    compare "$2" "$3"
    ;;
  *)
    echo "usage: $0 classify | pr <number> | since-pass <workflow-file> | between <base> <head>" >&2
    exit 2
    ;;
esac
