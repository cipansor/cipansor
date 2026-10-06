# `.claude/` — why the hooks and skills work the way they do

`AGENTS.md` → "Where things live" has the rules for changing anything here
(standing permission, through a PR, prove a file unused before deleting it) and
the skills index. This file lists the hooks and holds the reasoning behind each: the failure it answers, what was
measured, and the rails that keep it from wedging a session. It was moved out
of `AGENTS.md` on 2026-09-24 because every agent (OpenHands, Jules, Copilot)
loads that file whole, and this history matters only to whoever edits a hook.

When you change a hook, update its paragraph here in the same PR.

| Hook | What it does |
|---|---|
| `hooks/guard.sh` | PreToolUse — blocks a full-file Write to `schema.prisma`, a push that would land on `main` (named or implicit), and a Write/Edit of a repo Markdown file that `check-sensitive.py` flags |
| `hooks/format-before-push.sh` | PreToolUse — refuses a `git push` whose commits carry `.ts`/`.tsx` files Prettier would change, and prints the command that fixes them |
| `hooks/session-bootstrap.sh` | SessionStart — installs deps, generates the Prisma client, builds shared |
| `hooks/pre-compact-sync.sh` | PreCompact — pauses a manual `/compact` when there is new work the durable records do not yet reflect; *holds* an auto-compaction until this session has run `sync-records` |
| `hooks/context-sync-warn.sh` | PostToolUse + UserPromptSubmit — tells the model, before the auto-compaction window, to run `sync-records` (the only channel that reaches it) |
| `hooks/main-ci-watch.sh` | SessionStart + UserPromptSubmit + PostToolUse — reports once when a workflow on `main` fails (CI, E2E, CodeQL, Deploy staging/production), and once when it recovers |
| `hooks/sync_stamp.py` | shared by the hooks above and the `sync-records` skill: one definition of "the records are level", plus the context-size reading |
| `hooks/stop-sync-baseline.sh` | SessionStart — records the HEAD sha the session started from, so the Stop hook has something to compare against |
| `hooks/stop-sync-records.sh` | Stop — asks for a `sync-records` pass once, at the first resting point after the session has produced commits |

**Why sensitive text is refused at the write** (added 2026-09-25). Project
memory moved into the repository (`.claude/memory/`), and the repository is
public until release, so what an agent writes down as it works is published.
An audit of the machine-local memory that day found that 37 of 85 notes
touched infrastructure, open weaknesses, credentials or incidents. The rule
("Where things live" in `AGENTS.md`) is advisory; `guard.sh` makes its
mechanical half binding for Claude by running `.github/scripts/check-sensitive.py`
on the text of every Write/Edit to a Markdown file inside the repository, and
the Security CI job runs the same script on every PR for the agents no hook
reaches. It checks the *new* text only, so an edit elsewhere in a file with an
old finding is not blocked. Placeholders pass on purpose — `user:pass@host`, a
key cut short, `1.2.3.4`, the RFC 5737 ranges — because every example in the
docs is written that way. `<app>.azurewebsites.net` passes too: the app names
are in the deploy workflows, and both apps admit only Cloudflare's ranges.

**Why the compaction hook exists.** Compaction discards the transcript, and only
files survive it. Findings were reaching `memory/`, the plan and the ROADMAP
only because the user remembered to ask, every single time. The hook asks
instead: it exits 2, which hands control back for a `sync-records` pass, and
lets the retry through — so it can nag but can never wedge a session.
`/compact skip-sync` bypasses it deliberately.

**What "level" means is work, not time** (corrected 2026-09-05). The stamp used
to expire after thirty minutes, which asked for a second pass over a session
that had produced nothing new. `sync_stamp.py` now compares git HEAD plus the
working tree, so `/compact` is quiet until something actually changes; a
six-hour ceiling remains for findings that never touch git. The
`sync-records` skill writes the stamp itself as its last step — before that, a
pass the user ran directly did nothing to quiet the next `/compact`, which was
backwards.

**Auto-compaction is held, and the warning comes from a different hook**
(rebuilt 2026-09-23). The first design assumed auto worked like manual: block
once, the model reads the message, runs the pass, the retry goes through. It
never did. For an *automatic* compaction Claude Code writes the block reason to
its debug log only — the model never sees it — and because the hook wrote the
stamp while blocking, the retry one tool call later went through. Measured in a
session transcript: nine auto-compactions, zero passes caused by the hook.

What reaches the model is `additionalContext` from PostToolUse and
UserPromptSubmit (tested live with a probe hook). So `context-sync-warn.sh`
reads the current context size from the transcript (`usage` of the last
main-chain reply) and warns twice per round: at `autoCompactWindow` − 75k
("run `sync-records` now") and at − 60k ("compaction is due and held").
The first warning was at − 120k until 2026-09-29; the user found it too far
ahead (compaction really fires at 567k–579k of a 600k window, so − 120k came
about 90k early). − 75k leaves 40–55k for a pass that measures 15–30k, and
the hold covers the rest.
`pre-compact-sync.sh` holds the auto-compaction in that band without writing
any stamp; only a `sync-records` pass by *this* session since the round began
releases it (`sync_stamp.py` run from the skill records
`CLAUDE_CODE_SESSION_ID`). A "round" runs from the last SessionStart, which
`stop-sync-baseline.sh` records.

Safety rails: nothing is held unless `autoCompactWindow` is set at or below
800k (unset = the model's own window = never held); a compaction far below the
window — a smaller model, a reactive retry — is never held; and the hold lets
go at window + 150k (at most 900k), so the worst case is a late compaction
without a pass, never a session stranded at the context wall.
`CLAUDE_SKIP_CONTEXT_SYNC=1` silences the warning.

**Why `main` is watched too** (added 2026-09-24, the user's proposal). A
failing PR is visible — it has checks, and a session can subscribe to it. After
the merge nobody was looking, and that is where the expensive failures hide:
#504 and #505 were green alone and red together, `audit:deps` can turn `main`
red with a newly published CVE and no diff at all, and Deploy staging only runs
after the merge. `main-ci-watch.sh` looks at the latest *completed* run of each
workflow on `main` (`cancelled` is ignored — concurrency cancels runs on
purpose) and tells the model once per failing run, and once when it goes green
again. `gh run list` costs about a second, so tool calls read a cache and a
stale cache (over three minutes) is refreshed by a detached background process;
only SessionStart waits for a fresh answer (8 s cap), so a new session knows at
once that `main` is red. Without `gh` or a network it stays silent.
`CLAUDE_SKIP_MAIN_CI_WATCH=1` turns it off. It is a backstop, not a
replacement: after merging, still follow the merge commit's runs to the end
before releasing it.

**Why there is a `Stop` hook too.** The compaction hook only guards the
compaction door. A session that finishes without ever being compacted never
passes through it — and those are exactly the sessions that leave findings in
the transcript alone. `stop-sync-records.sh` closes that gap.

It is deliberately hard to trigger, because `Stop` fires at the end of *every*
turn and a reminder that appears every turn teaches everyone to ignore hook
messages. It stays quiet unless all five hold: not already continuing from its
own block (`stop_hook_active` — this is what makes a loop impossible), not yet
asked this session, at least one commit since the session began, no pending
changes to tracked files (a resting point, not mid-edit), and no durable record
touched since the session began. One reminder per session, then never again.
`CLAUDE_SKIP_STOP_SYNC=1` turns it off.

Both `Stop` and `PreCompact` fail open on everything else — unreadable input, an
unreadable git tree, an unwritable stamp directory. A hook that breaks a session
is worse than a hook that misses a reminder.

**Why pushes are format-checked** (added 2026-09-24, the user's rule: "format
before push; if it is not formatted, send it back to be formatted first").
The repo had a `pnpm format` script and nobody ran it: 686 of ~1,890
`.ts`/`.tsx` files had drifted from Prettier, so it was normalised in one
commit (listed in `.git-blame-ignore-revs`) and CI's Lint job now runs
`pnpm format:check`. That check comes minutes after a push, so
`format-before-push.sh` answers first. It finds the repo the push runs in the
way a shell would (`NAME=value` assignments, `cd`, `git -C`), checks only the
`.ts`/`.tsx` files changed between the merge-base with `origin/main` and
`HEAD`, and exits 2 with the list and the exact `--write` command. Prettier
comes from `node_modules` when node is on PATH, else from Docker at the version
pinned in `package.json` (an exact pin is required, or the hook could disagree
with CI). With neither, or on any error, the push is allowed: CI still checks.
The user considered, and chose against, a CI bot that commits formatting back
to the branch: commits pushed with `GITHUB_TOKEN` do not trigger CI, and a bot
pushing into branches that agents are pushing to makes their next push fail.
`CLAUDE_SKIP_FORMAT_CHECK=1` turns the hook off.
