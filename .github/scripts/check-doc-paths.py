#!/usr/bin/env python3
"""Refuse a document that sends a reader to a code file that is not there.

The prose is written by hand and the tree moves under it. A refactor deletes
`utils/wib-day.ts` and updates the callers, but the sentence that says "the WIB
calendar lives in `utils/wib-day.ts`" survives, and the reader who follows it
finds nothing.

Nothing else catches this. `check_docs.py` compares numbers, routes, labels and
quoted messages — not whether a named file exists. And its job (`Tests`) is
skipped for a documentation-only change, so a PR that only edits prose never
runs it. That is why this runs in the `Security` job, which every change lands
in, and why it needs no install.

Scope is the prose that describes the codebase: the tracked `docs/*.md` and the
`AGENTS.md` files, plus the current-state project memory (`known-issues.md`,
`lessons/`). Chronological records are skipped, exactly as `check_docs.py`
skips them: a revision-history row or a progress log records what was true at
that commit, and rewriting it would be the mistake.

Usage:
  check-doc-paths.py --self-test     the cases below; CI runs it first
  check-doc-paths.py [path...]       default: the tracked doc set
Exit 1 and one line per finding when a path is missing, else exit 0.
"""
import os
import re
import subprocess
import sys

# The prose that makes a claim about the tree now.
DEFAULT_PATTERNS = [
    "docs/*.md",
    "AGENTS.md",
    "apps/*/AGENTS.md",
    "packages/*/AGENTS.md",
    ".claude/memory/known-issues.md",
    ".claude/memory/lessons/*.md",
]

# A path a reader could open, written in backticks. The `apps/` and `packages/`
# forms are repository-root relative; a bare `utils/x.ts` is the API module
# directory, which is how §8 of the technical document names it.
PATH_IN_BACKTICKS = re.compile(
    r"`(?P<span>[^`]+)`"
)
PATH = re.compile(
    r"\b(?P<path>(?:apps|packages)/[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*"
    r"|utils/[A-Za-z0-9_.-]+\.ts)(?::\d+)?"
)
CODE_SUFFIX = re.compile(r"\.(ts|tsx|js|jsx|mjs|cjs|py|sh|json|yml|yaml|css|prisma)$")

HISTORY_HEADING = re.compile(r"^#\s+Riwayat Revisi\s*$")
FENCE = re.compile(r"^\s*(```|~~~)")


def is_ignored(path: str, cwd: str = ".") -> bool:
    """A path the tree does not carry but the build produces (a coverage
    summary, a generated client) is not a stale reference — `git check-ignore`
    is the same list that keeps it out of the tree."""
    return (
        subprocess.run(
            ["git", "check-ignore", "-q", path], cwd=cwd, capture_output=True
        ).returncode
        == 0
    )


def candidates(raw: str) -> list[str]:
    """Where the named path could be. A bare `utils/…` is `apps/api/src/utils/…`."""
    out = [raw]
    if raw.startswith("utils/"):
        out.append(os.path.join("apps/api/src", raw))
    return out


def scan_text(name: str, text: str, exists=os.path.exists, ignored=None) -> list[str]:
    ignored = ignored if ignored is not None else is_ignored
    findings: list[str] = []
    in_history = False
    in_fence = False
    for n, line in enumerate(text.split("\n"), 1):
        if line.startswith("#"):
            in_history = bool(HISTORY_HEADING.match(line))
        if FENCE.match(line):
            in_fence = not in_fence
            continue
        if in_history or in_fence:
            continue
        for span in PATH_IN_BACKTICKS.finditer(line):
            for m in PATH.finditer(span.group("span")):
                raw = m.group("path")
                if not CODE_SUFFIX.search(raw):
                    continue
                if any(exists(c) for c in candidates(raw)):
                    continue
                if ignored(raw):
                    continue
                findings.append(f"{name}:{n}: {raw} — not in the repository")
    return findings


def tracked(patterns: list[str]) -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", *patterns], capture_output=True, text=True, check=True
    ).stdout.split()
    return sorted(out)


def self_test() -> int:
    # An existing path must pass; a deleted one must be caught; a chronological
    # record and a fenced block must be left alone; a gitignored path must pass.
    tree = {
        "apps/api/src/utils/wib.ts": True,
        "apps/api/src/app.ts": True,
        "apps/web/src/lib/host-split.ts": True,
        "apps/api/coverage/coverage-summary.json": True,
    }
    exists = lambda p: tree.get(p, False)  # noqa: E731
    ignored = {"apps/api/coverage/coverage-summary.json"}
    is_ignored_in_test = lambda p: p in ignored  # noqa: E731

    def scan(text: str) -> list[str]:
        return scan_text("t.md", text, exists=exists, ignored=is_ignored_in_test)

    must_flag = [
        "bulan penagihan WIB lewat `apps/api/src/utils/wib-day.ts`.",
        "the helper lives in `utils/wib-day.ts`.",
        "called from `apps/web/src/lib/gone.ts`, which no longer exists",
    ]
    must_pass = [
        "bulan penagihan WIB lewat `apps/api/src/utils/wib.ts`.",
        "called from `apps/api/src/app.ts`.",
        "generated into `apps/api/coverage/coverage-summary.json`",
        "# Riwayat Revisi\n| 1.4 | … | lewat `utils/wib-day.ts` | Agen |\n",
        "```\nlewat `apps/api/src/utils/wib-day.ts`\n```\n",
        "the module directory `apps/api/src/utils` holds it",
    ]
    bad = [t for t in must_flag if not scan(t)]
    bad += [t for t in must_pass if scan(t)]
    for t in bad:
        print(f"self-test: wrong verdict for {t!r}")
    return 1 if bad else 0


def main(argv: list[str]) -> int:
    if argv[:1] == ["--self-test"]:
        return self_test()
    files = argv or tracked(DEFAULT_PATTERNS)
    findings: list[str] = []
    for f in files:
        if not os.path.isfile(f):
            continue
        with open(f, encoding="utf-8", errors="replace") as fh:
            findings += scan_text(f, fh.read())
    for line in findings:
        print(line)
    return 1 if findings else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
