# Project memory — a pointer, not a memory

This repository keeps one project memory: **`.claude/memory/`**. Read its index,
`.claude/memory/INDEX.md`, before starting, and open a file when its line
matches the task.

**Do not write here.** With "Persistent Agent Memory" on, OpenHands is told to
fold what it learned into this file; in this repository the guard refuses that
(`.claude/hooks/guard.sh`, decided 2026-10-09). Instead:

- a finding about the work → the matching file in `.claude/memory/`
  (`progress.md`, `roadmap.md`, `known-issues.md`, `decisions/`, `lessons/`) and
  its line in `INDEX.md`, as the `sync-records` skill says, on a branch and
  through a PR;
- anything sensitive, personal or specific to this sandbox → the user tier,
  `~/.openhands/memory/`, never the repository (it is public until release);
- working notes → today's daily log in this folder (`YYYY-MM-DD.md`), which git
  ignores.

What goes where, and why: `AGENTS.md` → "Where things live".
