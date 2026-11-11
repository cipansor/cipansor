# handoff-stops-one-step-short

> An automation that opens a **draft** PR and stops. Nothing un-drafts it, the
> review gate only waits on non-draft PRs, and the issue keeps the label that
> put it in the queue. Work is delivered and then sits until a human notices.
> Issue #857 / PR #878: 19 days as a draft, two more days in the queue.

## What happened

`Tiket jadi PR` (SDLC 06) was rewritten on 2026-11-11 to read the `ready` queue
on a daily cron instead of triggering on a `bot-implement` label. The rewrite
kept "open a draft PR" and dropped the two steps that move the work forward:

- nothing marked the issue `in-progress` or revoked `ready`, so the issue stayed
  in the queue the automation reads every morning;
- nothing marked the PR ready for review, and `pr-lifecycle` only signals on a
  **non-draft** PR, so the review gate never picked it up.

The run ended with a green PR and a comment saying the work was delivered. From
the outside it looked finished. It was not.

## Why the old trigger hid it

`bot-implement` was a _one-shot_ signal: the maintainer applied it, the
automation consumed it, and the next run had nothing left to pick up. `ready`
is a _state_, not an event. Any automation that reads a stateful queue must
move the item out of the queue as its own step, or the next run re-picks work
that is already in review — the same trap as a consumer that never acknowledges
its message. A queue with no acknowledgement is a queue that only grows.

## The rule

For every hand-off, ask what the **next** run sees. An automation that opens a
PR must, in the same run:

1. move the issue out of the queue (`ready` → `in-progress`), and
2. put the PR where the next stage looks for it (`ready_for_review`).

Leaving the item where it was is not neutral — it is a duplicate-work bug
waiting for the next cron tick. Keep the draft only as the deliberate escape
hatch for work that is genuinely unfinished, and say so in the prompt, so the
automation cannot "finish" by doing nothing.

## The guard that catches it

Assert the prompt contains both steps, and that the draft path is conditional:

```ts
expect(prompt).toMatch(/CABUT `ready`/);
expect(prompt).toContain("ready_for_review");
expect(prompt).toMatch(/BIARKAN draf/);
```

A prompt that only mentions "open a draft PR" passes every other test in the
suite — the failure is an absence, and an absence is invisible unless a test
names it. This is the same shape as
[guard-tests-that-measure-the-wrong-thing](./guard-tests-that-measure-the-wrong-thing.md):
the suite measured the step that was written, not the step that was missing.
