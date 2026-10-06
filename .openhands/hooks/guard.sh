#!/usr/bin/env bash
# PreToolUse guard for OpenHands — the three mechanical mistakes that have
# actually bitten this repo, ported from .claude/hooks/guard.sh to OpenHands'
# tool vocabulary:
#
#   1. A wholesale rewrite of prisma/schema.prisma (~10k lines; it has been
#      truncated by a rewrite before). It must only ever be edited surgically.
#   2. A `git push` that targets `main`. Work happens on feature branches; main
#      is protected by convention, and an agent should never push it directly.
#   3. Sensitive text written into a Markdown file of this repository (project
#      memory, docs, guides). The repo is public until release; the patterns
#      live in .github/scripts/check-sensitive.py, which the Security CI job
#      also runs. Machine-local memory (~/.openhands, ~/.claude) is not a
#      checkout, so it is never checked — that is where sensitive notes belong.
#
# OpenHands' tool names differ from Claude's — `terminal` (was `Bash`),
# `file_editor` (was `Write`/`Edit`/`MultiEdit`) with `path` / `command` /
# `file_text` / `new_str` instead of `file_path` / `content` / `new_string` —
# so this script normalizes both vocabularies and can be shared between the
# two tools.
#
# The hook reads the tool call as JSON on stdin. Exit 0 allows the call; exit 2
# blocks it and shows the message to the model. Anything it does not recognise
# is allowed — it fails open on purpose, so a parsing hiccup can never wedge a
# session.
set -uo pipefail

input="$(cat)"

python3 - "$input" <<'PY'
import json, os, re, subprocess, sys

try:
    data = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)  # unparseable -> allow

tool = str(data.get("tool_name", ""))
ti = data.get("tool_input") or {}


def block(msg: str):
    print(msg, file=sys.stderr)
    sys.exit(2)


# --- normalize the two tool vocabularies into (verb, path, new_text) --------
path = str(ti.get("path") or ti.get("file_path") or "")
verb = None
new_text = ""
if tool == "file_editor":  # OpenHands
    verb = ti.get("command")
    if verb == "create":
        new_text = str(ti.get("file_text") or "")
    elif verb in ("str_replace", "insert"):
        new_text = str(ti.get("new_str") or "")
elif tool == "Write":  # Claude
    verb, new_text = "create", str(ti.get("content") or "")
elif tool == "Edit":
    verb, new_text = "str_replace", str(ti.get("new_string") or "")
elif tool == "MultiEdit":
    verb = "str_replace"
    new_text = "\n".join(str(e.get("new_string", "")) for e in (ti.get("edits") or []))

# 1. Never rewrite the Prisma schema wholesale (only a create can overwrite).
if verb == "create" and path.replace("\\", "/").endswith("prisma/schema.prisma"):
    block(
        "Refusing a wholesale write to prisma/schema.prisma: it must be edited "
        "surgically (file_editor `str_replace` / `insert`), never rewritten "
        "wholesale (a full rewrite has truncated it before). Then run "
        "`pnpm --filter api db:generate`."
    )

# 2. Sensitive text into a Markdown file of a checkout of this repository.
if verb in ("create", "str_replace", "insert") and path.endswith(".md"):
    scanner = None
    d = os.path.dirname(os.path.abspath(path))
    while d and d != os.path.dirname(d):
        cand = os.path.join(d, ".github", "scripts", "check-sensitive.py")
        if os.path.isfile(cand):
            scanner = cand
            break
        d = os.path.dirname(d)
    if scanner:
        repo = os.path.dirname(os.path.dirname(os.path.dirname(scanner)))
        try:
            r = subprocess.run(
                ["python3", scanner, "--stdin", os.path.relpath(path, repo)],
                input=new_text, capture_output=True, text=True, timeout=20,
            )
        except Exception:
            sys.exit(0)  # fail open
        if r.returncode == 1 and r.stdout.strip():
            block(
                "Refusing this write: the text carries what AGENTS.md -> "
                '"Where things live" keeps out of the (public) repository:\n'
                + r.stdout.strip()
                + "\nWrite it to the machine-local memory instead, or replace the "
                "value with a placeholder (user:pass@host, 203.0.113.7, <vault-name>)."
            )

# 3. Terminal: never `git push` to main, never overwrite the schema wholesale.
if tool in ("terminal", "Bash"):
    cmd = str(ti.get("command", ""))

    for segment in re.split(r"[;&|\n]+", cmd):
        s = segment.strip()
        # drop leading env-var assignments (FOO=bar git push ...)
        while re.match(r"^\w+=\S*\s+", s):
            s = s.split(None, 1)[1] if " " in s else ""
        if not re.match(r"^git\s+(-\S+\s+|--\S+(=\S+)?\s+)*push\b", s):
            continue
        if re.search(r"(\s|:)(HEAD:)?main(\s|$)", s):
            block(
                "Refusing to push to main. Push to the feature branch instead "
                "and open a PR; main is not a direct-push target."
            )

    # A terminal command that would overwrite the schema wholesale: a redirect
    # into it, `tee`, `dd of=`, or `cp`/`mv` with it as the destination. `cp`/`mv`
    # are checked per segment so a source file that merely contains the path is
    # not matched.
    norm = cmd.replace("\\", "/")
    if (
        re.search(r">>?\s*[\"']?[^\s\"'|;&]*prisma/schema\.prisma", norm)
        or re.search(r"\btee\b[^|;&]*prisma/schema\.prisma", norm)
        or re.search(r"\bdd\b[^|;&]*\bof=\s*[\"']?[^\s\"']*prisma/schema\.prisma", norm)
    ):
        block(
            "Refusing to overwrite prisma/schema.prisma from the terminal: it "
            "must be edited surgically (file_editor `str_replace`), never "
            "rewritten wholesale. Then run `pnpm --filter api db:generate`."
        )
    for segment in re.split(r"[;&|\n]+", cmd):
        words = [w.strip("\"'") for w in segment.split()]
        if words and words[0] in ("cp", "mv") and words[-1].endswith("prisma/schema.prisma"):
            block(
                "Refusing to overwrite prisma/schema.prisma from the terminal: it "
                "must be edited surgically (file_editor `str_replace`), never "
                "rewritten wholesale. Then run `pnpm --filter api db:generate`."
            )

sys.exit(0)
PY
