#!/usr/bin/env bash
# PreToolUse (terminal): refuse a `git push` that carries .ts/.tsx files Prettier
# would change — the user's rule (2026-09-24): format before pushing; a push
# that is not formatted is sent back to be formatted first.
#
# The check itself lives in .claude/hooks/format-before-push.sh (the one
# definition, shared by both tools). That script speaks Claude's Bash payload
# ({tool_name: "Bash", tool_input: {command}}); this adapter reads OpenHands'
# terminal event, rewrites it into that shape, pipes it across, and forwards the
# exit code. It stays thin on purpose: the logic is not duplicated.
#
# Only files the pushed commits change are checked, Prettier comes from the
# repo's node_modules, and anything unexpected lets the push through — CI still
# checks. Fails open, like every hook here.
set -uo pipefail

input="$(cat)"

real="$(python3 - "$input" <<'PY'
import json, os, sys

try:
    data = json.loads(sys.argv[1])
except Exception:
    print("")
    sys.exit(0)

if str(data.get("tool_name", "")) not in ("terminal", "Bash"):
    print("")
    sys.exit(0)

cmd = str((data.get("tool_input") or {}).get("command", ""))
if "push" not in cmd:
    print("")
    sys.exit(0)

# The shared check resolves `git -C` and `cd` from the event's working
# directory. Dropping it made it start from this script's own directory, so a
# push run from another worktree was checked against the wrong commit range
# (and a `cd` inside the command resolved against the wrong base).
print(json.dumps({
    "tool_name": "Bash",
    "tool_input": {"command": cmd},
    "cwd": data.get("working_dir") or data.get("cwd") or os.getcwd(),
}))
PY
)"

[ -n "$real" ] || exit 0

here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
impl="$here/../../.claude/hooks/format-before-push.sh"
[ -f "$impl" ] || exit 0  # no shared check available -> let the push through

printf '%s' "$real" | bash "$impl"
exit $?
