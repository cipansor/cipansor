#!/usr/bin/env bash
# PreToolUse (Bash): refuse a `git push` that carries .ts/.tsx files Prettier
# would change, and say exactly how to fix them. The user's rule (2026-09-24):
# format before pushing; a push that is not formatted is sent back to be
# formatted first. CI's Lint job checks the whole repo too (`pnpm format:check`),
# but that is 5+ minutes after the push; this answers before it.
#
# Only files the pushed commits change are checked (merge-base with origin/main
# ..HEAD), so it costs a second or two. Prettier comes from the repo's own
# node_modules when node is on PATH; otherwise from Docker (`node:26-alpine`,
# the runtime the project pins, npm cache in a named volume); with neither, the
# push is allowed — CI still checks. Fails open on anything unexpected: a hook
# that wedges a session is worse than one CI backs up.
# CLAUDE_SKIP_FORMAT_CHECK=1 turns it off.
set -uo pipefail

[ "${CLAUDE_SKIP_FORMAT_CHECK:-}" = "1" ] && exit 0
input="$(cat)"

python3 - "$input" <<'PY'
import json, os, re, shlex, shutil, subprocess, sys

try:
    data = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)
if data.get("tool_name") != "Bash":
    sys.exit(0)
cmd = str((data.get("tool_input") or {}).get("command", ""))
cwd = data.get("cwd") or os.getcwd()

# Walk the command's segments like a shell would, only as far as this needs:
# NAME=value assignments (so `cd $SP/wt` resolves), `cd DIR`, and the segment
# that runs `git [-C DIR] push`.
env = dict(os.environ)
here = cwd
repo = None

def expand(word):
    word = re.sub(r"\$\{?(\w+)\}?", lambda m: env.get(m.group(1), m.group(0)), word)
    return os.path.expanduser(word)

def absolute(path):
    path = expand(path)
    return path if os.path.isabs(path) else os.path.normpath(os.path.join(here, path))

for segment in re.split(r"[;&|\n]+", cmd):
    try:
        words = shlex.split(segment)
    except ValueError:
        continue
    if words and words[0] == "export":
        words = words[1:]
    # A segment of bare assignments sets shell variables (`SP=/tmp/x`); leading
    # assignments before a command only set that command's environment.
    assigns = []
    while words and re.fullmatch(r"[A-Za-z_]\w*=.*", words[0]):
        assigns.append(words.pop(0))
    if not words:
        for a in assigns:
            name, value = a.split("=", 1)
            env[name] = expand(value)
        continue
    if words[0] == "cd" and len(words) >= 2:
        here = absolute(words[1])
        continue
    if words[0] != "git":
        continue
    i, git_dir = 1, here
    while i < len(words) and words[i].startswith("-"):
        if words[i] == "-C" and i + 1 < len(words):
            git_dir = absolute(words[i + 1])
            i += 2
        else:
            i += 1
    if i < len(words) and words[i] == "push":
        repo = git_dir
        break

if repo is None:
    sys.exit(0)

def git(*args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, timeout=20)

try:
    top = git("rev-parse", "--show-toplevel").stdout.strip()
    if not top or not os.path.exists(os.path.join(top, "package.json")):
        sys.exit(0)
    base = git("merge-base", "HEAD", "origin/main").stdout.strip()
    if not base:
        sys.exit(0)
    files = [
        f for f in git("diff", "--name-only", "--diff-filter=ACMR", f"{base}..HEAD", "--", "*.ts", "*.tsx").stdout.split("\n")
        if f.strip()
    ]
except Exception:
    sys.exit(0)
if not files:
    sys.exit(0)

try:
    with open(os.path.join(top, "package.json"), encoding="utf-8") as fh:
        version = (json.load(fh).get("devDependencies") or {}).get("prettier", "")
except Exception:
    version = ""
if not re.fullmatch(r"\d+\.\d+\.\d+", version or ""):
    sys.exit(0)  # only an exact pin gives the same answer as CI

local = os.path.join(top, "node_modules", ".bin", "prettier")
if shutil.which("node") and os.path.exists(local):
    run = [local, "--check", *files]
    fix = f"pnpm exec prettier --write {' '.join(shlex.quote(f) for f in files)}"
    cwd_run = top
elif shutil.which("docker"):
    # The check mounts the repo read-only. The fix command runs as the calling
    # user: as root it left root-owned files that `git worktree remove` could
    # not delete (2026-09-24).
    run = ["docker", "run", "--rm", "-v", f"{top}:/w:ro", "-w", "/w", "-v", "claude-prettier-npm:/root/.npm",
           "node:26-alpine", "npx", "-y", f"prettier@{version}", "--check", *files]
    fix = (f"docker run --rm --user \"$(id -u):$(id -g)\" -e npm_config_cache=/tmp/.npm "
           f"-v \"$PWD\":/w -w /w node:26-alpine "
           f"npx -y prettier@{version} --write {' '.join(shlex.quote(f) for f in files)}")
    cwd_run = top
else:
    sys.exit(0)

try:
    result = subprocess.run(run, cwd=cwd_run, capture_output=True, text=True, timeout=120)
except Exception:
    sys.exit(0)
if result.returncode == 0:
    sys.exit(0)
unformatted = [
    line.split("] ", 1)[1] for line in (result.stdout + result.stderr).split("\n")
    if line.startswith("[warn] ") and not line.startswith("[warn] Code style")
]
if result.returncode != 1 or not unformatted:
    sys.exit(0)  # prettier itself failed (syntax error, download) — not our call

listing = "\n".join(f"  - {f}" for f in unformatted[:20])
more = f"\n  … and {len(unformatted) - 20} more" if len(unformatted) > 20 else ""
print(
    f"Push refused: {len(unformatted)} file(s) in this push are not in Prettier's format:\n"
    f"{listing}{more}\n\n"
    f"Format them, commit, then push again. From {top}:\n  {fix}\n"
    f"(or `pnpm format` for the whole repo). CI's Lint job fails on the same files.",
    file=sys.stderr,
)
sys.exit(2)
PY
