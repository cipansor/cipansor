# Project memory — OpenHands index

Short on purpose: OpenHands loads this file every conversation with a **6000-char
budget, truncated from the top**, so a long index loses its head. Keep one line
per entry and put detail in the daily logs.

The full project memory is Claude's and lives in **`.claude/memory/`** — read
`INDEX.md` there for where the work stands; open a file when its line matches the
task. Nothing sensitive in either folder (the repo is public until release).

## What OpenHands reads in this repo

- **`.openhands/setup.sh`** — runs at the start of every conversation; installs
  deps, generates Prisma, builds `@cipansor/shared`, Playwright Chromium, and
  Postgres+Redis. It does not seed or start the stack (that is the `stack` skill).
- **`.openhands/hooks.json`** — `pre_tool_use` guards via `.openhands/hooks/`:
  block a wholesale `prisma/schema.prisma` rewrite, a `git push` to `main`,
  sensitive text into a repo `.md`, and an unformatted push. Reasons and the
  tool-name mapping are in `.openhands/README.md`.
- **`.agents/skills -> ../.claude/skills`** — a symlink. OpenHands loads project
  skills from `.agents/skills/`, **never** `.claude/skills/`; Claude Code is the
  reverse (hard-coded to `.claude/skills/`, no setting adds `.agents/`). The
  symlink is the one-source bridge; keep the real files in `.claude/skills/`.
- **`AGENTS.md`** (root + the nested per-area files) — always-on repo rules.

## Traps that cost time

- **The two tools disagree on skill and memory paths.** OpenHands: skills
  `.agents/skills/`, memory `.openhands/memory/`. Claude: skills `.claude/skills/`,
  memory `.claude/memory/` (via `CLAUDE.md` imports). Do not "move" a folder to
  the other tool's path — symlink it.
- **OpenHands truncates memory from the top**, so the index must stay under
  6000 chars or the earliest entries silently vanish.
- **Machine-specific facts do not belong here.** They live in the user-tier
  memory (`~/.openhands/memory/`) — versions, host paths, this box's setup.
