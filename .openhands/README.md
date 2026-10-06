# `.openhands/` — OpenHands setup and hooks for this repo

OpenHands reads this directory at the start of every conversation. It is the
OpenHands counterpart of `.claude/`, and it deliberately shares the checks
rather than copying them.

| File | When it runs | What it does |
|---|---|---|
| `setup.sh` | once, at the start of every conversation | installs deps, generates the Prisma client, builds `@cipansor/shared`, installs the Playwright Chromium, and installs Postgres + Redis (Docker if a daemon exists, else apt). Does **not** seed or start the stack — that is the `stack` skill's job. |
| `hooks.json` | registers the hooks below | `pre_tool_use` for `terminal` + `file_editor` |
| `hooks/guard.sh` | before a `terminal` or `file_editor` call | blocks the three mechanical mistakes: a wholesale rewrite of `prisma/schema.prisma`, a `git push` to `main`, and sensitive text written into a repository Markdown file |
| `hooks/format-before-push.sh` | before a `terminal` call | refuses a `git push` whose commits carry `.ts`/`.tsx` files Prettier would change |

## Why these three

The hooks are the OpenHands port of `.claude/hooks/guard.sh` and
`.claude/hooks/format-before-push.sh`; the reasoning for each is in
`.claude/README.md` and is not repeated here. The one difference is the tool
vocabulary: OpenHands calls the shell tool **`terminal`** (Claude: `Bash`) and
the file tool **`file_editor`** (Claude: `Write`/`Edit`/`MultiEdit`), and the
file tool's inputs are `path` / `command` / `file_text` / `new_str` instead of
`file_path` / `content` / `new_string`. `guard.sh` normalizes both vocabularies,
so the same script can be dropped into either tool's hook config.

`hooks/format-before-push.sh` is a thin adapter: the Prettier check itself is
still `.claude/hooks/format-before-push.sh` (one definition, shared). The
adapter rewrites the OpenHands `terminal` event into the `Bash` shape that
script expects and forwards its exit code.

## What is deliberately not ported

The Claude hooks that keep the *durable records* level — `pre-compact-sync.sh`,
`context-sync-warn.sh`, `stop-sync-records.sh`, `stop-sync-baseline.sh`,
`main-ci-watch.sh`, `session-bootstrap.sh` — are not ported. The first four
depend on Claude Code's `stop_hook_active` loop guard and its compaction event
(`PreCompact` has no OpenHands equivalent), and `session-bootstrap.sh` is
superseded by `setup.sh` here. A `stop` hook that fires every turn without those
guards nags and is ignored, which is worse than no hook; if this repo later wants
an OpenHands records reminder, it needs the equivalent of `stop_hook_active`
first. That is a decision to raise with the user, not to make quietly.

## Skills and memory

- **Skills** come from `.claude/skills/` through the symlink `.agents/skills ->
  ../.claude/skills`. OpenHands loads project skills from `.agents/skills/`
  (preferred), `.openhands/skills/`, `.openhands/microagents/` — **never**
  `.claude/skills/`; Claude Code is the reverse and no setting adds `.agents/`.
  The symlink is the one-source bridge; keep the real files in `.claude/skills/`.
- **Memory**: the full project memory is `.claude/memory/` (Claude auto-loads
  `INDEX.md` through `CLAUDE.md` imports). OpenHands instead auto-loads
  `memory/MEMORY.md` here, with a 6000-char budget truncated from the top — so it
  is a **thin pointer index** to `.claude/memory/`, not a copy. Machine-specific
  facts live in the user tier, `~/.openhands/memory/`, never in the repo.

## Changing a hook

Same rule as `.claude/`: standing permission from the user covers adding,
changing and deleting anything here, always on a branch and through a PR, never
straight to `main`. When you change a hook, update this file in the same PR.
OpenHands loads the hooks automatically the next time it works on the repo; use
`/skills` in the CLI to see what is active.
