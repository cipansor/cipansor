---
name: sync-records
description: Bring the durable records level with what actually happened this session — the repo's project memory (.claude/memory — progress, roadmap, known issues), the machine-local memory for what is sensitive or personal, AGENTS.md and the plans in docs/. Use before compacting, before ending a long session, or whenever asked to "sesuaikan memori/plan/file lainnya".
---

# Sync the durable records

Everything in the conversation is lost at compaction. Only files survive. This
skill is the checklist for moving what matters out of the transcript and into
them — and it is the answer to "sesuaikan memori, plan, dan file lainnya".

Run it **before** compacting, not after.

Two committed hooks ask for this pass so nobody has to remember to:
`hooks/pre-compact-sync.sh` pauses the first manual `/compact` of a session, and
`hooks/stop-sync-records.sh` asks once at the first resting point after the
session has produced commits. Both ask exactly once and then stand aside. If
this pass genuinely finds nothing worth writing, say that in one line — an
invented edit to satisfy a hook is worse than no edit, because the next reader
trusts it.

## OpenHands

This skill runs under OpenHands too (the folder is symlinked at `.agents/skills/`).
Two differences:

- The **machine-local memory is `~/.openhands/memory/`** (user tier) — the
  equivalent of `~/.claude/projects/<slug>/memory/`. It is not committed.
- There is **no stamp step and no `/compact` gate** on OpenHands: skip step 6
  below. OpenHands loads `<repo>/.openhands/memory/MEMORY.md` (a thin pointer
  index, budget 6000 chars, truncated from the top) plus the user-tier index;
  keep both indexes level with what the pass wrote.

The two committed OpenHands hooks do not ask for this pass (the user chose
2026-10-06 not to port the Claude records hooks) — run it from the signals below.

## What to write, and where

Two memories, and the line between them is `AGENTS.md` → "Where things live":
the repo's **`.claude/memory/`** (shared by every machine and agent, committed
through PRs, **nothing sensitive** — the repo is public until release) and the
**machine-local** auto memory under `~/.claude/projects/<repo slug>/memory/`
(this machine only; `MEMORY.md` is its index, of which only the first 200 lines
/ 25 KB load — keep one short line per entry).

| finding | goes to |
|---|---|
| how the codebase works, what a fix was | **nowhere** — the repo and git history already say it |
| what merged, what is on staging or in production, what waits on the user, what is in flight | `.claude/memory/progress.md` |
| what to do next, and in what order | `.claude/memory/roadmap.md` |
| a defect found, or fixed | `.claude/memory/known-issues.md` (delete a fixed entry — git keeps it) |
| a decision the yayasan or the user made, or a standard already researched | `.claude/memory/decisions/<subject>.md`, plus a line in `INDEX.md` and in the domain skill's "Keputusan yang mengikat" list when one exists (`tata-kelola-yayasan`, `naskah-dinas`) |
| how the domain works now — a flow, a rule, where its code lives | the domain skill (`panduan-peran`, `tata-kelola-yayasan`, `naskah-dinas`); a new domain gets a skill when it is needed a second time |
| a trap that cost time and will cost it again — a tool that lies, a test that measured the wrong thing | `.claude/memory/lessons/<subject>.md` — generic, no machine paths; the machine-specific half stays local |
| a convention every change must follow | `AGENTS.md` (or the per-area one) |
| why a Claude hook works the way it does | `.claude/README.md` |
| a fact about the user, or how they want the work done | machine-local memory, type `user` / `feedback` (a rule for every agent goes to `AGENTS.md` instead) |
| **anything sensitive** — credentials and their status, keys, cloud resource names, IPs, host paths, a weakness still open in production, incident details, personal data | machine-local memory, never the repo |
| anything specific to this machine — ports, containers, local paths, CLIs | machine-local memory |

`guard.sh` refuses the mechanical half of "sensitive" when you write a repo
Markdown file, and the Security CI job refuses it on every PR; meaning is not
something a pattern can see, so ask of every note bound for the repo: *could an
attacker use this?* Moving a machine-local memory into `.claude/memory/` needs
the user's approval, file by file, until the repository is private.

## The pass

1. **Re-read what the session actually changed.** `git log --oneline` since the
   session began, plus any production or deploy action taken. Findings that
   never reached a file are the ones at risk.
2. **Correct before you add.** A memory that has become *wrong* is worse than a
   memory that is missing, because it is trusted. Ask of every file you touched
   this session: is anything in it now false? This is the step most often
   skipped, and the one that has mattered most here — a credentials note went
   stale within thirty minutes of being written, because the session itself
   changed the password it described.
3. **Update in place, don't duplicate.** Look for the existing file that already
   covers the ground; a second file on the same subject splits the truth.
4. **Update the indexes** — the machine-local `MEMORY.md`, and
   `.claude/memory/INDEX.md` when a repo memory file is added or removed. One
   line per memory, hook only, never content. If a
   memory's headline changed, its index line changed too.
5. **The repo's records are code.** `.claude/memory/`, the plans in `docs/`
   and the guides go on a branch and through a PR like anything else; never
   commit them straight to `main`. The machine-local memory is written in place.
6. **Stamp it, so the pass counts.** Last step, always:

   ```
   python3 "$CLAUDE_PROJECT_DIR/.claude/hooks/sync_stamp.py"
   ```

   This is what tells `pre-compact-sync.sh` the records are level. Without it a
   pass the user asked for directly did nothing to quiet the next `/compact` —
   which was backwards, and was fixed on 2026-09-05. The stamp measures *work*
   (git HEAD + working tree), not elapsed time, so it stays valid until
   something new actually happens.

   It also records this session's id (`CLAUDE_CODE_SESSION_ID`), and that is
   the ONLY thing that releases a held auto-compaction. When
   `context-sync-warn.sh` says the context is nearing or past the window, this
   pass is what it is asking for: run it at the nearest stopping point, before
   carrying on with the task.

   Skip it only when the pass found nothing AND wrote nothing.

7. **Say what you did**, briefly, so the user can disagree before the transcript
   is gone. Then tell them plainly that `/compact` will now go straight
   through — that sentence is the notification they were promised.

## What earns a memory

Write it down when a future session would otherwise **repeat the work or repeat
the mistake**: a trap that cost real time, a standard already researched with
its source, a decision and its reason, a measurement that contradicts an
assumption. Convert relative dates to absolute.

Do **not** write down what the repo already records, or what only mattered
inside this conversation.

## Signals it is worth a pass

- a PR merged or a deploy performed
- a measurement that contradicted a memory or a doc
- the user made a decision, or gave feedback on how to work
- a trap that cost more than a few minutes to diagnose
- anything learned about production that is not in the code
