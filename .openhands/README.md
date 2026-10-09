# `.openhands/` — OpenHands setup and hooks for this repo

OpenHands reads this directory when it works on the repository. It is the
OpenHands counterpart of `.claude/`, and it shares the checks rather than
copying them: one guard, one Prettier check, one project memory.

| File | When it runs | What it does |
|---|---|---|
| `setup.sh` | at the start of every conversation | installs deps (`pnpm install --frozen-lockfile` only), generates the Prisma client, builds `@cipansor/shared`, installs the Playwright engines the e2e projects use (Chromium, Firefox, WebKit), and installs Postgres + Redis (Docker if a daemon exists, else apt). Does **not** seed or start the stack — that is the `stack` skill's job. |
| `hooks.json` | registers the hooks below | `pre_tool_use` for `terminal` + `file_editor` |
| `../.claude/hooks/guard.sh` | before a `terminal` or `file_editor` call | the guard both agents share: refuses a wholesale rewrite of `prisma/schema.prisma`, a `git push` that would land on `main`, sensitive text in a repository Markdown file, and a write to `memory/MEMORY.md` (below) |
| `hooks/format-before-push.sh` | before a `terminal` call | refuses a `git push` whose commits carry `.ts`/`.tsx` files Prettier would change |
| `memory/MEMORY.md` | loaded into every conversation when Persistent Agent Memory is on | a pointer to `.claude/memory/`, not a memory |

## One guard for both agents

`.claude/hooks/guard.sh` reads both tool vocabularies — Claude's `Bash` /
`Write` / `Edit` / `MultiEdit` with `file_path` / `content` / `new_string`,
OpenHands' `terminal` / `file_editor` with `path` / `command` / `file_text` /
`new_str`, and the working directory as `cwd` or `working_dir` — so
`hooks.json` runs the same file Claude runs. The first version of this
directory carried a port of it instead; two copies of a push check drift, and
the copy had already diverged. Its cases, in both vocabularies, are
`apps/api/src/utils/agent-guard.guard.test.ts`; why each check exists is in
`.claude/README.md`.

`hooks/format-before-push.sh` is a thin adapter for the same reason: the
Prettier check is `.claude/hooks/format-before-push.sh`. The adapter rewrites
the `terminal` event into the `Bash` shape that script expects, carries the
event's working directory across as `cwd` (the check resolves `cd` / `git -C`
against it), and forwards the exit code.

Hooks run through `bash` from `$OPENHANDS_PROJECT_DIR`, so they need no
executable bit. Like every OpenHands hook, they **fail open**: a hook that
errors or times out lets the call through (exit 2 is the only refusal). CI and
the `main` ruleset are the backstop.

## Memory: a pointer to `.claude/memory/`

The project memory is `.claude/memory/` — one home, shared by every agent
(`AGENTS.md` → "Where things live"). With **Persistent Agent Memory** on
(OpenHands → Settings → Agent Context; off by default), OpenHands injects
`.openhands/memory/MEMORY.md` into each conversation (6000 characters, cut from
the top) and tells the agent to fold what it learned into that file and a daily
log. Here:

- `memory/MEMORY.md` is a short committed pointer: read `.claude/memory/INDEX.md`,
  write findings to the matching `.claude/memory/` file through the
  `sync-records` skill.
- The guard refuses a write to it and names where the finding goes instead —
  that is what keeps OpenHands updating `.claude/memory/`.
- Daily logs (`memory/YYYY-MM-DD.md`) are sandbox scratch; `.gitignore` keeps
  them out of the public repository.
- The user tier, `~/.openhands/memory/`, is OpenHands' machine-local memory —
  the place for anything sensitive or specific to a sandbox.

Rejected (2026-10-09): a symlink from `MEMORY.md` to `.claude/memory/INDEX.md`
(the index is over twice the 6000-character budget, so its top — the State
table — would be cut, and OpenHands' habit of folding facts into the index
breaks its one-line-per-file rule), and committing OpenHands' own index and
daily logs (a second home for the same knowledge).

## Skills

Skills come from `.claude/skills/` through the symlink `.agents/skills ->
../.claude/skills`. OpenHands loads project skills from `.agents/skills/`
(preferred), `.openhands/skills/`, `.openhands/microagents/` — never
`.claude/skills/`; Claude Code is the reverse. Keep the real files in
`.claude/skills/`.

## What is deliberately not ported

The Claude hooks that keep the records level — `pre-compact-sync.sh`,
`context-sync-warn.sh`, `stop-sync-records.sh`, `stop-sync-baseline.sh`,
`main-ci-watch.sh` — depend on Claude Code's `stop_hook_active` loop guard and
its compaction event, which OpenHands lacks; `session-bootstrap.sh` is
superseded by `setup.sh`. The user chose (2026-10-06) not to build an OpenHands
records reminder.

## Changing a hook

Same rule as `.claude/`: standing permission covers adding, changing and
deleting anything here, always on a branch and through a PR, never straight to
`main`. Change the guard in `.claude/hooks/guard.sh`, add its case to
`agent-guard.guard.test.ts`, and update this file in the same PR.
