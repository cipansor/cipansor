#!/usr/bin/env bash
# PreToolUse guard for the mechanical mistakes that have actually bitten this
# repo — one script for both agents: Claude Code runs it from
# .claude/settings.json, OpenHands from .openhands/hooks.json.
#
#   1. A wholesale rewrite of prisma/schema.prisma (~10k lines; it has been
#      truncated by a rewrite before). It must only ever be edited surgically:
#      a file `Write`/`create`, or a terminal redirect, `tee`, `dd of=`, `cp` or
#      `mv` onto it, is refused.
#   2. A `git push` that would land on `main` — named (`origin main`,
#      `HEAD:main`, `+main`), implicit (no destination while on main or
#      tracking it), or every branch at once (`--all`, `--mirror`). Work
#      happens on feature branches; an agent never pushes main.
#   3. Sensitive text written into a Markdown file of this repository (project
#      memory, docs, guides). The repo is public until release; the rule is in
#      AGENTS.md → "Where things live", the patterns in
#      .github/scripts/check-sensitive.py (the Security CI job runs the same
#      script). The machine-local memories (~/.claude/projects/…/memory/,
#      ~/.openhands/memory/) are not checkouts, so they are never checked —
#      that is where sensitive notes belong.
#   4. A write to .openhands/memory/MEMORY.md. With "Persistent Agent Memory"
#      on, OpenHands is told to fold what it learned into that file; here it is
#      a committed pointer, and the project memory lives in .claude/memory/
#      (decided 2026-10-09). The refusal says where the finding goes instead.
#
# The two tools name things differently: Claude's `Bash` / `Write` / `Edit` /
# `MultiEdit` with `file_path` / `content` / `new_string`, OpenHands'
# `terminal` / `file_editor` with `path` / `command` / `file_text` / `new_str`,
# and the working directory arrives as `cwd` or `working_dir`. Both are read.
#
# The hook reads the tool call as JSON on stdin. Exit 0 allows the call; exit 2
# blocks it and shows the message to the model. Anything the guard does not
# recognise is allowed — it fails open on purpose, so a parsing hiccup can never
# wedge a session. apps/api/src/utils/agent-guard.guard.test.ts holds the cases.
set -uo pipefail

input="$(cat)"

python3 - "$input" <<'PY'
import json, os, re, shlex, subprocess, sys

try:
    data = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)  # unparseable -> allow

tool = str(data.get("tool_name", ""))
ti = data.get("tool_input") or {}
cwd = str(data.get("cwd") or data.get("working_dir") or os.getcwd())


def block(msg: str):
    print(msg, file=sys.stderr)
    sys.exit(2)


def repo_root(start):
    """The checkout of this repository that `start` lies in, or None."""
    d = start
    while d and d != os.path.dirname(d):
        if os.path.isfile(os.path.join(d, ".github", "scripts", "check-sensitive.py")):
            return d
        d = os.path.dirname(d)
    return None


# --- normalize the two tool vocabularies into (verb, path, new_text) --------
path = str(ti.get("file_path") or ti.get("path") or "")
if path and not os.path.isabs(path):
    path = os.path.join(cwd, path)
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
writes = verb in ("create", "str_replace", "insert")
norm_path = path.replace("\\", "/")

SCHEMA_MSG = (
    "Refusing a wholesale rewrite of prisma/schema.prisma: it must be edited "
    "surgically (Claude: Edit; OpenHands: file_editor `str_replace`/`insert`), "
    "never rewritten wholesale (a full rewrite has truncated it before). Then run "
    "`pnpm --filter api db:generate`."
)
MEMORY_MSG = (
    "Refusing a write to .openhands/memory/MEMORY.md: in this repository it is a "
    "committed pointer, not a memory. Put what you learned in the matching file "
    "under .claude/memory/ — progress.md, roadmap.md, known-issues.md, a file in "
    "decisions/ or lessons/ — and its line in .claude/memory/INDEX.md, as the "
    "sync-records skill says, on a branch and through a PR. Anything sensitive or "
    "specific to this machine goes to ~/.openhands/memory/ instead."
)

# 1. Never rewrite the Prisma schema wholesale (only a create can overwrite).
if verb == "create" and norm_path.endswith("prisma/schema.prisma"):
    block(SCHEMA_MSG)

# 4. The OpenHands project-memory index of this checkout is a pointer.
if writes and norm_path.endswith("/.openhands/memory/MEMORY.md"):
    root = repo_root(os.path.dirname(os.path.abspath(path)))
    if root and os.path.abspath(path) == os.path.join(root, ".openhands", "memory", "MEMORY.md"):
        block(MEMORY_MSG)

# 3. Sensitive text into a Markdown file of a checkout of this repository.
if writes and path.endswith(".md"):
    root = repo_root(os.path.dirname(os.path.abspath(path)))
    if root:
        scanner = os.path.join(root, ".github", "scripts", "check-sensitive.py")
        try:
            r = subprocess.run(
                ["python3", scanner, "--stdin", os.path.relpath(path, root)],
                input=new_text, capture_output=True, text=True, timeout=20,
            )
        except Exception:
            sys.exit(0)  # fail open
        if r.returncode == 1 and r.stdout.strip():
            block(
                "Refusing this write: the text carries what AGENTS.md → "
                "\"Where things live\" keeps out of the (public) repository:\n"
                + r.stdout.strip()
                + "\nWrite it to the machine-local memory (Claude: "
                "~/.claude/projects/…/memory/; OpenHands: ~/.openhands/memory/) "
                "instead, or replace the value with a placeholder (user:pass@host, "
                "203.0.113.7, <vault-name>)."
            )

if tool not in ("Bash", "terminal"):
    sys.exit(0)

cmd = str(ti.get("command", ""))

# 2. Never `git push` to main. The repo is resolved from the event's working
# directory, any `git -C DIR`, and a `cd` earlier in the command, so a push run
# from a worktree is judged in that worktree.

# git options that take their value as the next word.
GIT_OPTS_WITH_VALUE = {"-c", "--git-dir", "--work-tree", "--namespace", "--exec-path", "--config-env"}
# `git push` options that take their value as the next word.
PUSH_OPTS_WITH_VALUE = {"-o", "--push-option", "--repo", "--receive-pack", "--exec"}
EVERY_BRANCH = {"--all", "--mirror", "--branches"}


def git_in(repo, *args):
    try:
        r = subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True, timeout=15)
        return r.stdout.strip()
    except Exception:
        return ""


def push_repo_dir(words, base):
    """(repo the command runs in, index of the git subcommand). The repo is
    None when a `-C` names a shell expansion this guard cannot resolve."""
    i, repo = 1, base
    while i < len(words) and words[i].startswith("-"):
        if words[i] == "-C" and i + 1 < len(words):
            d = words[i + 1]
            if "$" in d or "`" in d:
                return None, i + 2
            repo = d if os.path.isabs(d) else os.path.normpath(os.path.join(repo, d))
            i += 2
        elif words[i] in GIT_OPTS_WITH_VALUE:
            i += 2
        else:
            i += 1
    return repo, i


def resolve_dir(word, base):
    """The directory a `cd` moves to, or None when the target is a shell
    expansion we cannot model (the push then fails closed). A plain target
    that does not exist leaves the shell put, so the result is `base`."""
    if word == "-" or "$" in word or "`" in word:
        return None
    word = os.path.expanduser(word)
    d = word if os.path.isabs(word) else os.path.normpath(os.path.join(base, word))
    return d if os.path.isdir(d) else base


def resolve_refspec(repo, refspec):
    """Where a `push` refspec lands on the remote, or None if unknowable.

    A leading `+` only forces the update; it does not change the destination.
    An explicit `HEAD` / `HEAD:HEAD` pushes the current branch to the
    same-named remote branch — the branch's upstream does NOT choose that
    destination, so `git push -u origin HEAD` on a branch that tracks main
    must be allowed. An explicit `src:dst` names its destination; a bare
    refspec names a same-named branch.
    """
    refspec = refspec.lstrip("+")
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
    try:
        words = shlex.split(s)
    except ValueError:
        # A quote this split cannot close (`git push origin main #"`, or a
        # quoted `;` cut in two). Fall back to reading the raw text, so an
        # unbalanced quote never turns a push to main into an allowed one.
        if re.match(r"^git\s+(?:(?:-c|-C|--git-dir|--work-tree)\s+\S+\s+|-\S+\s+)*push\b", s) and re.search(
            r"(\s|:|\+)(HEAD:)?(refs/heads/)?main(\s|$|[\"'#])", s
        ):
            refuse_push("the command names main as its destination.")
        continue
    # `export NAME=value ...` only sets shell variables; it never runs a
    # command, so the segment is not a push.
    if words and words[0] == "export":
        continue
    # A leading assignment only sets the command's environment; strip it after
    # tokenizing so a quoted value (`FOO="a b" git push`) still yields the
    # command.
    while words and re.fullmatch(r"[A-Za-z_]\w*=.*", words[0]):
        words.pop(0)
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
        refuse_push(
            "the working directory is set by a shell expansion this guard cannot "
            "resolve; run the push from a plain path."
        )
    # Split the push's arguments into flags and positional [remote] [refspec
    # ...]; a flag's separate value (`-o ci.skip`) is neither.
    flags, positional, args = [], [], words[i + 1:]
    k = 0
    while k < len(args):
        w = args[k]
        if w.startswith("-"):
            flags.append(w.split("=", 1)[0])
            k += 2 if w in PUSH_OPTS_WITH_VALUE else 1
        else:
            positional.append(w)
            k += 1
    if EVERY_BRANCH.intersection(flags):
        refuse_push("`--all` / `--mirror` push every branch, main included.")
    # A destination named as a token (`git push origin main`,
    # `git push origin HEAD:refs/heads/main`). Checking the tokens — not the raw
    # segment — keeps `main` inside an assignment value (`FOO="x main y" git
    # push origin feat`) from looking like a destination.
    if any(re.search(r"(?:^|:)\+?(?:HEAD:)?(?:refs/heads/)?main$", a) for a in positional):
        refuse_push("the command names main as its destination.")
    refspecs = positional[1:]
    if refspecs:
        if any(resolve_refspec(repo, r) == "main" for r in refspecs):
            refuse_push("the refspec resolves to main.")
        continue  # an explicit refspec sets its own destination
    # No refspec: Git picks the destination, and the branch's upstream decides
    # it. Only now does branch.<name>.merge matter.
    branch = git_in(repo, "rev-parse", "--abbrev-ref", "HEAD")
    merge = git_in(repo, "config", "--get", "branch.%s.merge" % branch) if branch else ""
    if branch == "main":
        refuse_push("the current branch is `main` and the push names no other destination.")
    if merge in ("main", "refs/heads/main"):
        refuse_push("the current branch's upstream is main and the push names no other destination.")

# 1 and 4 from the terminal: a redirect (`>`, not the append `>>`), `tee`
# (not `tee -a`), `dd of=`, or `cp`/`mv` onto the file. `cp`/`mv` are checked
# per segment so a source file that merely contains the path is not matched.
norm = cmd.replace("\\", "/")
END = r"(?![\w.-])"  # the file itself, not `schema.prisma.bak`
for target, msg in (
    (r"prisma/schema\.prisma", SCHEMA_MSG),
    (r"\.openhands/memory/MEMORY\.md", MEMORY_MSG),
):
    if (
        re.search(r"(?<!>)>(?!>)\|?\s*[\"']?[^\s\"'|;&]*" + target + END, norm)
        or re.search(r"\btee\b(?![^|;&]*\s(?:-a|--append)\b)[^|;&]*" + target + END, norm)
        or re.search(r"\bdd\b[^|;&]*\bof=\s*[\"']?[^\s\"']*" + target + END, norm)
    ):
        block(msg)
    for segment in re.split(r"[;&|\n]+", norm):
        words = [w.strip("\"'") for w in segment.split()]
        if words and words[0] in ("cp", "mv") and re.search(target + "$", words[-1]):
            block(msg)

sys.exit(0)
PY
