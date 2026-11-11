# deploy-script-idempotence-traps

> A fleet-deploy script that edits a prompt around fixed markers, and the two
> ways an idempotent transform silently corrupts its input: a slice taken with
> a stale length, and a base that is already the output. Both shipped, and 23
> of 24 live automation prompts lost their tail before anyone noticed.

## The slice that used the wrong length

`new_prompt` split a prompt at `TAIL_MARK`, inserted a `BODY_BLOCK` after the
footer paragraph, then re-appended the old tail with `prompt[len(head):]`.
`head` had **already grown** by the length of `BODY_BLOCK`, so the slice
started past the old tail and dropped it. Every automation without a
replacement tail (17 of 24) was truncated on the next deploy. Capture the tail
*before* mutating the head:

```python
tail_start = prompt.find(TAIL_MARK)
orig_tail = prompt[tail_start:] if tail_start >= 0 else ""
head = prompt[:tail_start] if tail_start >= 0 else prompt
```

The test that catches it asserts the tail's **last line** survives
(`out.endsWith(...)`), not that a marker is present — presence passes on the
truncated output too.

## Idempotent is not repairable

The transform is idempotent: run it again on its own output and it is a no-op
(the marker is already there). That is exactly why it could not repair what it
had broken — the second run re-derives the same truncated head. The repair needs
a different base. `ORIGINALS=<json>` feeds the untruncated prompt, so the run
rebuilds from the original instead of the corrupted live copy. **A repair path
is not the same code as the deploy path, even when the transform is the same
function.**

## A pattern written from memory misses the live text (2026-11-10)

Three traps, all found by deploying and then reading the live prompt back —
every one of them passed the unit tests.

**A substitution keyed on remembered wording never fires.** The strip that
retires a label looked for `` `bug-hunter`, `bot-implement` ``; the live SDLC 19
tail reads `` priority:critical/high/medium/low, `bug-hunter`, dan
`bot-implement` ``. The transform reported "changed" (other edits applied), the
tests passed (they fed it the remembered wording), and the label would have been
recreated on the next run. Copy the key from the live prompt, and make the test
use that exact sentence — a pattern is only as good as the text it was taken
from.

**A global replace also rewrites the text the script authors.** The strip ran
over the assembled result, so it also cut the guidance sentence the script
itself emits — ``JANGAN memakai label `bug-hunter` `` became ``JANGAN memakai
label ;``. Scope a strip to the text that came from the live prompt (`head` and
`orig_tail`), before assembling; never to the finished prompt.

**Insert-once means a live block is never upgraded.** `BODY_BLOCK` is inserted
only when its marker is absent, so the live prompt keeps the copy it already
has. The new `blocked` rule reached the `ready` bullet (in the managed tail,
which is replaced whole) but not the exclusion list inside the body block, which
still told the agent to withdraw only `question`/`needs-info`/
`pending-maintainer`. A block that is not replaced wholesale needs a text
substitution for each edit — the idiom already used for the identity bullet
(`OLD_IDENTITY_LINE` → `NEW_IDENTITY_LINE`).

The check that catches all three is the same: **dry run with `ONLY=<name>`,
deploy, then read the live prompt back and assert on the property, not on the
transform's own report.** Re-running the deploy without `DEPLOY=1` must say
`already current`; when it does not, the transform is not yet idempotent and the
live copy still differs from the intended one.

## The pattern that was too short to match, again (2026-11-11)

The same class of miss, one round later, and it had shipped to all 19 live
prompts.

`LEGACY_LABEL_TEXTS` replaced the label-ownership bullet by keying on
`` `bot-implement` adalah keputusan maintainer — jangan pernah memasangnya. ``
The live bullet names **three** labels and ends at the same period:
`` `bot-implement`, `rilis-disetujui`, `rilis-ditolak` adalah keputusan
maintainer — jangan pernah memasangnya. `` The key was a suffix of the live
sentence, not the sentence, so `str.replace` found nothing and all three labels
survived. **A key must be copied whole from the live text, including the
enumeration that precedes it** — a partial key that "looks like it matches"
matches nothing, and the transform still reports other edits, so the run looks
successful.

Worse, the surviving text was not merely stale prose: several tails still
*told the agent to apply* a deleted label (SDLC 05 `needs-info`, SDLC 09/20
`pending-maintainer`, SDLC 12 `bot-implement`). `POST /issues/<n>/labels`
**creates** a label that does not exist, so the next run would have resurrected
a label the taxonomy deliberately deleted. Check what the text instructs, not
just whether it is current: **stale prose is a no-op; stale instructions are
live behaviour.**

## Removing a step, not repairing it (2026-11-11)

Retiring an automation does not remove its step from a prompt the automation was
already folded into. `Estimasi usaha` (SDLC 02) was retired on 2026-11-09 and
its step moved into `TAILS["SDLC 15"]`; when the owner then dropped the step
entirely, editing `TAILS` changed only what a *rebuilt* prompt would say. The
live SDLC 15 prompt kept the step, because a managed tail is only re-attached
when the prompt is rebuilt, and `new_prompt` treats an intact prompt as
`already current`.

A deletion therefore needs the same treatment as an edit: a
`DROPPED_STEP_TEXTS` substitution applied to the live `head` and `orig_tail`,
with the test asserting on the live text rather than on the script's constant.
**When you delete a step, ask which already-deployed prompts still carry it.**

## Where the originals came from

The pre-deploy prompts were not in the repo (only `deploy-sdlc-agents.py` is).
They survived because every deploy uploads a tarball, and `GET
/{automation}/tarball` returns whatever `tarball_path` currently points at.
Pointing an automation at its old upload, reading `prompt.txt`, then restoring
the pointer recovers the original. Do this only when the live prompt is
suspect, and always restore in a `finally`.

## Verification that measures the property

The post-deploy check compares each live prompt against its original: the
original's tail's second line must be present, and `BODY ISSUE/PR` must appear
exactly once. The seven automations with an intentional replacement tail fail
the first check by design, so they are verified against `TAILS` instead — a
verification that would have passed on the truncated prompts (marker present)
is the trap in
[guard-tests-that-measure-the-wrong-thing](./guard-tests-that-measure-the-wrong-thing.md).
