#!/usr/bin/env bash
# PreToolUse guard for the two mechanical mistakes that have actually bitten
# this repo before:
#
#   1. A full-file `Write` to prisma/schema.prisma. The schema is ~9k lines and
#      has been silently truncated by a rewrite; it must only ever be edited
#      surgically. Force `Edit`.
#   2. A `git push` that targets `main`. Work happens on feature branches; main
#      is protected by convention, and an agent should never push it directly.
#   3. Sensitive text written into a Markdown file of this repository (project
#      memory, docs, guides). The repo is public until release; the rule is in
#      AGENTS.md → "Where things live", the patterns in
#      .github/scripts/check-sensitive.py (the Security CI job runs the same
#      script). The machine-local memory under ~/.claude is not a checkout, so
#      it is never checked — that is where sensitive notes belong.
#
# The hook reads the tool call as JSON on stdin. Exit 0 allows the call; exit 2
# blocks it and shows the message to the model. Anything the guard does not
# recognise is allowed — it fails open on purpose, so a parsing hiccup can never
# wedge a session.
set -euo pipefail

input="$(cat)"

python3 - "$input" <<'PY'
import json, re, sys

try:
    data = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)  # unparseable -> allow

tool = data.get("tool_name", "")
ti = data.get("tool_input", {}) or {}

def block(msg: str):
    print(msg, file=sys.stderr)
    sys.exit(2)

# 1. Never Write (full rewrite) the Prisma schema.
if tool == "Write":
    path = str(ti.get("file_path", ""))
    if path.replace("\\", "/").endswith("prisma/schema.prisma"):
        block(
            "Refusing Write to prisma/schema.prisma: it must be edited "
            "surgically with Edit, never rewritten wholesale (a full Write has "
            "truncated it before). Use Edit, then run "
            "`pnpm --filter api db:generate`."
        )

# 2. Never git push to main. Refuse a push that would land on main — named
# explicitly (`git push origin main`, `… HEAD:main`) or implicitly, when the
# current branch (or its upstream) is main and the push names no destination
# (`git push`, `git push origin` while on main). The repo is resolved from the
# event's cwd and any `git -C DIR`, so a push from a worktree is judged there.
if tool == "Bash":
    import os, shlex, subprocess

    cmd = str(ti.get("command", ""))
    cwd = str(data.get("cwd") or os.getcwd())

    def git_in(repo, *args):
        try:
            r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, timeout=15)
            return r.stdout.strip()
        except Exception:
            return ""

    def push_repo_dir(words, base):
        i, repo = 1, base
        while i < len(words) and words[i].startswith("-"):
            if words[i] == "-C" and i + 1 < len(words):
                d = words[i + 1]
                if "$" in d or "`" in d:
                    return None, i + 2  # unmodeled shell expansion
                repo = d if os.path.isabs(d) else os.path.normpath(os.path.join(repo, d))
                i += 2
            else:
                i += 1
        return repo, i

    def resolve_dir(word, base):
        """The directory a `cd` moves to, or None when the target is a shell
        expansion we cannot model (the push then fails closed). A plain target
        that does not exist leaves the shell put, so the result is `base`."""
        if word in ("-",) or "$" in word or "`" in word:
            return None
        word = os.path.expanduser(word)
        d = word if os.path.isabs(word) else os.path.normpath(os.path.join(base, word))
        return d if os.path.isdir(d) else base

    def resolve_refspec(repo, refspec):
        """Where a `push` refspec lands on the remote, or None if unknowable.

        An explicit `HEAD` / `HEAD:HEAD` pushes the current branch to the
        same-named remote branch — the branch's upstream does NOT choose that
        destination, so `git push -u origin HEAD` on a branch that tracks main
        must be allowed. An explicit `src:dst` names its destination; a bare
        refspec names a same-named branch.
        """
        if refspec in ("HEAD", "HEAD:HEAD"):
            return git_in(repo, "rev-parse", "--abbrev-ref", "HEAD")
        if ":" in refspec:
            dst = refspec.split(":", 1)[1]
            if dst.startswith("refs/heads/"):
                dst = dst[len("refs/heads/"):]
            return dst or None
        return refspec

    def refuse_push(why):
        block(
            "Refusing to push to main: " + why + " Push to the feature branch "
            "instead and open a PR; main is not a direct-push target."
        )

    here = cwd  # follows `cd` across segments, like the shell does
    uncertain = False  # a `cd` we could not resolve; the next push fails closed
    for segment in re.split(r"[;&|\n]+", cmd):
        s = segment.strip()
        # drop leading env-var assignments (FOO=bar git push ...)
        while re.match(r"^\w+=\S*\s+", s):
            s = s.split(None, 1)[1] if " " in s else ""
        try:
            words = shlex.split(s)
        except ValueError:
            continue
        if not words:
            continue
        if words[0] == "cd":
            target = words[1] if len(words) >= 2 else "~"
            nd = resolve_dir(target, here)
            if nd is None:
                uncertain = True  # a shell expansion moved us somewhere we cannot see
            else:
                here, uncertain = nd, False
            continue
        if words[0] != "git":
            continue
        repo, i = push_repo_dir(words, here)
        if i >= len(words) or words[i] != "push":
            continue
        if repo is None or uncertain:
            refuse_push("the working directory is set by a shell expansion this guard cannot resolve; run the push from a plain path.")
        if re.search(r"(?:^|\s|:)(?:HEAD:)?(?:refs/heads/)?main(?:\s|$)", s):
            refuse_push("the command names main as its destination.")
        # Positional args after `push` are [remote] [refspec ...]; flags are not.
        positional = [w for w in words[i + 1:] if not w.startswith("-")]
        refspecs = positional[1:]
        if refspecs:
            if any(resolve_refspec(repo, r) == "main" for r in refspecs):
                refuse_push("the refspec resolves to main.")
            continue  # an explicit refspec sets its own destination
        # No refspec: Git picks the destination, and the branch's upstream
        # decides it. Only now does branch.<name>.merge matter.
        branch = git_in(repo, "rev-parse", "--abbrev-ref", "HEAD")
        merge = git_in(repo, "config", "--get", "branch.%s.merge" % branch) if branch else ""
        if branch == "main":
            refuse_push("the current branch is `main` and the push names no other destination.")
        if merge in ("main", "refs/heads/main"):
            refuse_push("the current branch's upstream is main and the push names no other destination.")

# 3. Sensitive text into a Markdown file of a checkout of this repository.
if tool in ("Write", "Edit", "MultiEdit"):
    import os, subprocess
    path = str(ti.get("file_path", ""))
    if path.endswith(".md"):
        scanner = None
        d = os.path.dirname(os.path.abspath(path))
        while d and d != os.path.dirname(d):
            cand = os.path.join(d, ".github", "scripts", "check-sensitive.py")
            if os.path.isfile(cand):
                scanner = cand
                break
            d = os.path.dirname(d)
        if scanner:
            if tool == "Write":
                text = str(ti.get("content", ""))
            elif tool == "Edit":
                text = str(ti.get("new_string", ""))
            else:
                text = "\n".join(str(e.get("new_string", "")) for e in ti.get("edits", []) or [])
            try:
                r = subprocess.run(
                    ["python3", scanner, "--stdin", os.path.relpath(path, os.path.dirname(os.path.dirname(os.path.dirname(scanner))))],
                    input=text, capture_output=True, text=True, timeout=20,
                )
            except Exception:
                sys.exit(0)  # fail open
            if r.returncode == 1 and r.stdout.strip():
                block(
                    "Refusing this write: the text carries what AGENTS.md → "
                    "\"Where things live\" keeps out of the (public) repository:\n"
                    + r.stdout.strip()
                    + "\nWrite it to the machine-local memory (~/.claude/projects/…/memory/) "
                    "instead, or replace the value with a placeholder (user:pass@host, "
                    "203.0.113.7, <vault-name>)."
                )

sys.exit(0)
PY
