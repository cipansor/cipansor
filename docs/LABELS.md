# Label taxonomy

Every issue and pull request carries at most one **type** and at most one
**priority**. Some also carry a **status** label while they are being worked
through the lifecycle. Labels are the machine-readable interface between the
OpenHands automations and the GitHub Actions guards, so the rules below are
enforced, not just conventions.

## Type — what kind of change is this

| Label           | Use for                                              |
| --------------- | ---------------------------------------------------- |
| `bug`           | Something that is broken                             |
| `enhancement`   | A new feature or a change in behaviour               |
| `documentation` | Documentation only                                   |
| `refactor`      | A change that neither fixes a bug nor adds a feature |
| `chore`         | Tooling, dependencies, housekeeping                  |
| `security`      | A vulnerability or a hardening change                |

## Priority — how urgent

Priority is **evidence-backed**, not a feeling: `Triase issue` weighs impact,
urgency and risk, and anything above `medium` must name the concrete evidence.
A higher label with no evidence is a defect the triage owner must correct.

| Label               | Use for                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `priority:critical` | Exactly one of: layanan mati total; kehilangan/korupsi data; kerentanan keamanan atau kebocoran data pribadi (UU PDP) yang aktif bisa dieksploitasi; pipeline rilis macet total. Naming the concrete victim (unit/peran) and the evidence is required. |
| `priority:high`     | Menghambat pekerjaan unit/peran sekarang; a regulatory/accreditation deadline this cycle; many users with no workaround; or a security weakness that cannot yet be exploited. Naming the blocker or the deadline is required.                          |
| `priority:medium`   | Normal; the default for triaged work — real, but not blocking and with a workaround.                                                                                                                                                                   |
| `priority:low`      | Nice to have, no urgency (cosmetic).                                                                                                                                                                                                                   |

The evidence rule, enforced in the triage owner's prompt:

- **Exactly one priority.** Above `medium` it must cite evidence — a route/file
  path, the number of affected users/units, a deadline, or a run id. Without
  evidence the label is at most `medium`.
- **When in doubt, pick the lower level** and write down why.
- **Never inflate `critical`.** It is for total outage, data loss, or an
  exploitable security/privacy problem, not for "important".
- **State whether the issue blocks other work**, and re-weigh the priority on
  every triage round.

## Status — where it is in the lifecycle

| Label          | Meaning                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `ready`        | Specified enough to implement; `Tiket jadi PR` picks it up on its daily run, and it stays open to a contributor too |
| `in-progress`  | Someone or an automation is actively working on it                                                                  |
| `blocked`      | Cannot proceed until a dependency is resolved; never beside `ready`                                                 |
| `stale`        | No activity for a long time; will close unless kept                                                                 |
| `question`     | Still needs discussion: a question, or a decision the maintainer has not made yet                                   |
| `duplicate`    | An issue already reported elsewhere; the original is linked                                                         |
| `duplicate-pr` | A pull request probably covered by another PR; a candidate a maintainer weighs, never auto-closed                   |
| `invalid`      | Not a valid report                                                                                                  |
| `wontfix`      | Deliberately not going to be done                                                                                   |
| `automation`   | Report or action from an automation; skip in manual triage                                                          |

## The rules

1. **Type and priority are shared between an issue and its pull request.** When
   a PR closes an issue, it must carry the same type label and the same priority
   label. `Issue label sync` sets them from the issue; the `Issue label
sync` workflow adds anything missing and **fails the check** when the type
   genuinely disagrees (a different type is a real conflict, not something to
   guess at). A PR that closes **more than one** issue must satisfy every one of
   them, and the check fails when the issues disagree among themselves. Changing
   a linked issue's labels re-runs the sync on every open PR that closes it,
   because an `issues` event fires no `pull_request` event. A **fork** PR's
   token cannot edit labels, so the sync fails (naming the labels) rather than
   passing with the PR mislabeled — a passing check on a mislabeled PR is what a
   merge gate would read.

2. **Status labels are not copied to a pull request.** `question`,
   `duplicate`, `invalid`, `wontfix`, `blocked`, `ready` and `in-progress`
   describe an issue's own lifecycle. A PR's lifecycle is its draft state and
   its reviews. The one exception is `duplicate-pr`, which exists _for_ a PR:
   the issue-lifecycle `duplicate` label must never sit on a PR, so a PR that
   looks like a duplicate is marked with `duplicate-pr`. It is a candidate for a
   maintainer, not a verdict — unlike a duplicate issue, it is never closed
   automatically (rule 4).

3. **`ready` is the implementation queue.** `Triase issue` applies it only when
   the issue has a clear goal and a concrete acceptance criterion; otherwise it
   applies `question` and lists what is missing. `Tiket jadi PR` runs on a daily
   cron, scans the `ready` queue oldest-first, and opens at most `DAILY_PR_MAX`
   (3) pull requests per run (owner decision 2026-11-11, replacing the
   `bot-implement` hand-off label). The cap is what keeps the bot from sweeping
   the whole backlog in one day, and the oldest-first order is what keeps a
   ticket from starving. An issue a person wants to keep for themselves stays
   out of the queue: leave `ready` off until they are done with it.

4. **A duplicate closes itself.** `Triase issue` applies `duplicate` to an issue and
   links the original; the same detection on a pull request applies
   `duplicate-pr`. The deterministic half of the detection is the `Duplicate
detect` workflow: when two **open** issues share a title once normalised
   (lowercased, whitespace collapsed, trailing punctuation dropped, long digit
   runs masked), it labels the newer one `duplicate` and links the earlier one —
   it never closes anything itself, and a title whose only same-titled sibling is
   closed is not a duplicate (a recurrence after a fix is a regression, not a
   repeat). It writes the link comment at most once and never removes a label
   itself; a removal of the label therefore has the last word — but only a
   removal by `cipansor-bot` (the account the triage owner and the maintainers
   drive) is permanent: the detector reads the issue's `unlabeled` events and
   will not re-apply a label that account removed. A removal by any other actor
   (a human, `github-actions[bot]`, another automation) is not that verdict, and
   the label is re-applied on the next sweep — the link comment is kept, so only
   the label comes back; ask `cipansor-bot` to remove it to cancel the detection
   for good. For
   an **issue**, the `Duplicate sweep` workflow warns once —
   recording a hash of the description — then closes it after seven days unless
   it is shown to be distinct: the description changed since the warning, or a
   person replied after the issue was flagged as a duplicate (from the
   detector's link comment when there is one, so a reply between the link and
   the label still counts) — or a maintainer removes the label. An automated comment, and
   any comment from a bot account, does not count as a reply. A warning that
   carries no description hash (an older one, or one edited by hand) cannot be
   checked for an edit, so the sweep leaves that item open for a maintainer
   rather than closing on a guess. A **pull request** is never closed
   automatically: which of two PRs is the more correct one (the rule below) is a
   maintainer's judgement, so `pr-duplicate.sh` only labels the candidate and a
   person decides.
   **Which of two is the duplicate:** the one kept is the **more correct** one
   (right against the current `main`, with the stronger test); only when both
   are equally correct is the **earlier** one kept. Being first is not enough
   on its own: #698 was kept over the earlier #696/#697 for its oracle test, and
   #708 over #748, which carried the same fix on a stale base (decided by the
   owner, 2026-10-10).

5. **A red pull request stays open.** The `PR lifecycle` workflow leaves a ready
   PR as it is when any required check is failing — the failing checks are
   already visible on the PR, so a draft revert would only hide work in
   progress. It reads the checks exhaustively — every page, every required
   check present — and, once every required check passes, dispatches `Gerbang tinjau PR`
   so the review gate runs the moment CI is green. The dispatch is the gate's
   **first** review only: once the gate has reviewed a PR, a later green head is
   not dispatched again — the author asks for another pass with a manual review
   request to `cipansor-bot`. A green draft PR gets an
   informational comment; it is never marked ready automatically.

6. **Approval needs more than green CI.** `Gerbang tinjau PR` approves a
   ready PR only when every check is green, no review thread is open, the labels
   match the linked issue, and it found no correctness problem in the diff. It
   never merges and never changes the draft state. Its verdict is a
   recommendation, not the last word — merge stays with the maintainer, so it is
   never written up as a final decision.

7. **A review proposes the fix, it does not only complain.** `Gerbang tinjau PR`
   saat mengembalikan PR memposting setiap masalah lokal dan mekanis
   problem as a GitHub `suggestion` block so the author can apply it in one
   click, and describe the proposed change in words for a problem too large for
   a block. A suggestion is never placed on a line the automation is not certain
   of. This is the same "suggest a change" affordance Copilot's review uses.

8. **`ready` is a strong claim, and it is exclusive.** `Triase issue` applies
   `ready` only when it is **very sure**: the goal is clear, the acceptance
   criterion is concrete and observable, and **no question is left open**. While
   anything still has to be discussed, decided, or criticized — a design choice,
   an unknown scope, a premise that may not hold — it is not `ready` yet; apply
   `question` (which covers both "still being discussed" and "a question, not a
   change") and name what is missing. `ready` must never sit beside `question` or
   `blocked`: two labels that contradict each other make
   the machine-readable state ambiguous (#814 carried `ready` and `question`
   together). `blocked` is the same contradiction — an issue that cannot proceed
   until a dependency resolves is not one a contributor can pick up, which is
   what `ready` promises. The withdrawal is always `ready`, never `blocked`:
   `blocked` carries the harder information and `stale-sweep.sh` exempts it from
   closing (owner decision, 2026-11-10). The automations are told to criticize hard and ask probing
   questions until they are sure, precisely so `ready` is not applied early.
   `label-guard.sh` enforces the exclusivity: it removes `ready` whenever it
   still coexists with an exclusion once the event's own label is accounted for,
   so a person adding a second exclusion beside an existing `ready` does not
   leave the issue contradictory.

9. **Issues: comment first, description when `ready`.** While an issue is not
   yet `ready`, the triage, the acceptance criteria and the open
   questions are written as **comments** — the working conversation. The issue
   **body** is updated only when the bot applies `ready`: then the final summary
   is written into the description under a stable marker (for example
   `<!-- sdlc:triase -->`) and updated in place, so a reader sees the settled
   state in one place. A pull request is different — its review verdict and QA
   result are written into the PR **body** under a marker (for example
   `<!-- sdlc:gerbang -->`), because the PR is already the settled artifact.

10. **A pull request description edit is not answered automatically.** There is
    no trigger on `pull_request.edited`. The review gate already reads the PR
    description, the linked issue, the whole diff and every comment when it runs
    on `ready_for_review` (or on the CI-green dispatch), so an edit needs no
    separate automation — and a trigger would fight `basmalah.yml`, which PATCHes
    the body as `github-actions[bot]`. For issues, an edit is caught by the
    **triage bridge** below rather than by a trigger on `issues.edited`.

11. **The triage bridge re-triages after another automation responds.** A bot
    applying a type or priority label, `label-guard` revoking a label a person
    applied and leaving the issue with no type or no priority (#838 — the guard
    calls the bridge's `--relabel` mode in the same run, because its own removal
    is made with the automatic `GITHUB_TOKEN` and GitHub starts no workflow for
    an event that token creates), or a not-yet-`ready` issue gaining
    activity (an edited description or a new comment) newer than its last
    triage, dispatches the triage owner — deterministically, from
    `.github/scripts/issue-triage-bridge.sh`, and idempotently (a checkpoint in
    the automation KV store per type+priority state, and one per activity
    timestamp). This is why
    nothing needs to fire on `issues.edited`: the bridge polls and the label
    event is the hook.

12. **Only `cipansor-bot` labels.** Every label in the taxonomy above is the
    bot's to apply. A protected label added by any other account is removed by
    the `Label guard` workflow and the account is told once. The protected set is
    every label that exists in the repository, read at run time — a
    new label is protected the moment it is created. There is no human-decision
    exception left: `bot-implement` was removed on 2026-11-11, and release
    approval is a `vX.Y.Z` tag, not a label. A GitHub App (`*[bot]`) is
    exempt, because the Actions workflows label through `github-actions[bot]`.
    **On an issue, the type label its form applies at open is also exempt:**
    each form sets its own type (`bug_report.yml` sets `bug`, `enhancement.yml`
    sets `enhancement`, and so on) the
    moment the issue is created, and a type label is the reporter's declared
    intent — the triage owner sets the correct type on top, revoking the wrong
    one. On a **pull request** there is no such form, so a type label stays
    protected there: a manually applied `bug` on a PR that closes an
    `enhancement` issue would otherwise fail the type sync (`issue-label-sync`)
    and redden the PR. A person states what they want and the bot records it;
    this is what keeps the automations and the guards reading the same state.
    Because the guard only *removes*, a revocation that leaves the issue with no
    type or no priority is not the end of the story: the guard's workflow calls
    the triage bridge's `--relabel` mode in the same run and dispatches the triage
    owner to relabel the issue (#838). It cannot do so through a GitHub event —
    the removal is made with the automatic `GITHUB_TOKEN`, and GitHub starts no
    workflow run for an event that token creates.
    **A removal is not a way to overrule the bot.** A label that `cipansor-bot`
    applied last, then removed by a person, is put back by the same workflow: the
    `unlabeled` trigger sends the event to the guard's restore half, which reads
    the issue's own event timeline and restores the label only when the last
    `labeled` event's actor is the bot. This covers the type labels too — a
    form-applied `bug` the bot later set is restored like any other, which is the
    case #838 reports (the guard checks the label exists in the repository, not
    whether the standard path would protect it). It never restores a label the bot
    or a GitHub App removed (that removal is deliberate — the fleet withdrawing a
    contradictory `ready`, `stale-sweep`, `issue-label-sync` correcting), never
    when the timeline cannot be read (a failed read is never "safe to restore"),
    and never when the label is `ready` and the issue now carries `question` or
    `blocked` (that would recreate the exclusivity conflict rule 8 forbids). One
    notice per issue says the label is back and to ask `@cipansor-bot` for a
    change.

13. **Every main description opens with the basmalah.** Each issue and pull
    request body starts with «بِسْمِ اللَّهِ الرَّحْمَنِ الرَّحِيمِ»
    (`Bismillaahirrohmaanirrohiim` where Arabic cannot be typed), then a blank
    line. The pull-request template carries it in the body; the issue forms show
    it as a visible prompt (a form's `markdown` block is preview only and never
    lands in the body), so for issues the `Basmalah` workflow is what puts it
    there — it prepends the line to a description that lacks it (idempotent — it
    never stacks), and the automations are told to open their own bodies with it.

14. **An automation acknowledges before it works.** The fleet reacts `👀` on the
    issue, pull request, or comment it is about to handle — a comment trigger
    through the `Acknowledge` workflow, the rest from their own prompts — so a
    person can see the automation is working before the answer lands.

## Which automation owns which label

| Automation            | Trigger                                   | Labels it sets                                                                                               |
| --------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Triase issue`        | issue opened; balasan pada issue `question` (via jembatan triase) | tipe, prioritas, `ready` / `question` / `duplicate`; balasan pelapor → `ready` / `duplicate` / `invalid`; balasan maintainer → `ready` / `wontfix` |
| `Tiket jadi PR`       | daily cron 08:00 WIB, `ready` queue oldest-first | tidak ada — ia membuka PR                                                                                    |
| `Issue label sync`    | PR opened / issue relabeled               | tipe dan prioritas issue tertaut (deterministik, `issue-label-sync.yml`)                                     |
| `issue-claim.sh`      | PR opened / issue relabeled               | `ready` ↔ `in-progress` pada issue tertaut (deterministik, `issue-claim.yml`)                                |
| `duplicate-detect.sh` | issue opened / jadwal harian              | `duplicate` (deterministik, `duplicate-detect.yml`) bila dua issue terbuka berjudul sama setelah dinormalkan |
| `pr-duplicate.sh`     | jadwal harian                             | `duplicate-pr` (kandidat, tidak menutup) bila dua PR terbuka menutup issue yang sama                         |
| `stale-sweep.sh`      | jadwal harian                             | `stale` pada issue menganggur, lalu menutupnya `not planned` (deterministik, `stale-sweep.yml`)              |
| `Gerbang tinjau PR`   | PR ready for review, or CI-green dispatch | tidak ada — ia meninjau (termasuk QA) atau menyetujui                                                         |
| `Pemburu bug`         | daily cron                                | membuka issue `bug`, satu prioritas (tanpa label provenans)                                                  |
| `Pemindai standar`    | weekly cron                               | membuka issue dengan tipe, prioritas, `question`                                                             |

The deterministic consequences are GitHub Actions workflows
(`issue-label-sync.yml`, `issue-claim.yml`, `pr-lifecycle.yml`,
`main-failure-bridge.yml`, `duplicate-detect.yml`,
`duplicate-sweep.yml`,
`stale-sweep.yml`, `docs-drift.yml`, `label-guard.yml`,
`basmalah.yml`,
`acknowledge.yml`, `issue-triage-bridge.yml`), not automations: they must fire every time and cost
no tokens. `label-guard.yml` enforces rule 12, `basmalah.yml` rule 13,
`acknowledge.yml` rule 14, and `issue-triage-bridge.yml` rule 11.

## The self-comment loop guard

An automation posts through the same GitHub account as the person who triggered
it (`user.type: User`, same `login`), so a trigger on `issue_comment.created`
cannot tell the automation's own comment from a reporter's. Issue #680 showed
the consequence: `Penjernih issue` re-armed itself and posted eleven comments in 27
minutes, each a full LLM run. (That automation was retired on 2026-11-12 —
option (a) of #1056 — but the guard it motivated still governs every comment
trigger.)

The marker is the comment's **author**. Every automated comment is posted as
`cipansor-bot` (the fleet's account, `user.type: User`) or as a GitHub App
(`github-actions[bot]`, `openhands-ai[bot]`, `user.type: Bot`, login ending in
`[bot]`). No comment carries an AI-disclosure footer — the account name already
tells a reader the comment is automated, so the footer was dropped on
2026-10-14.

Every automation whose trigger is `issue_comment.created` **must** add this
negative filter, or it will loop:

```
comment.user.login != 'cipansor-bot' && comment.user.type != 'Bot'
```

The filter must key on the author, never on body text: a footer match is
fragile (an edited or reworded comment evades it) and it makes the account's own
name redundant. The automations live outside this repository, so the guard is
enforced where they are deployed: each comment trigger is validated against a
sample automated comment before it is enabled.

## Templates feed these labels

Blank issues are **enabled**: the forms cover a defect and a change request, not
a question, an operational incident, or anything the forms do not fit, and
forcing those into a `bug` form produces a wrong label. An unstructured issue is
not turned away — the automation absorbs it: `Triase issue` triages it, or
lists the questions that would unblock it, then applies `question` with the
exact missing detail rather than `ready`. A security
vulnerability is routed to a private advisory (`SECURITY.md`), never a public
issue.

The issue forms (`.github/ISSUE_TEMPLATE/`) and the pull-request template exist
to produce the labels above, not prose to read and forget:

- The **bug** form requires only what happened and what was expected; the other
  forms (**feature request**, **documentation**, **refactor**, **chore**,
  **security**) require the motivation and the desired behaviour. Each form sets
  its own type label, so a reporter picks the type by picking the form.
  Everything else (reproduction steps, acceptance criteria) is optional — a thin
  report still gets triaged, and `Triase issue` fills what it can before deciding
  `ready` versus `question`.
- A `bug` issue may still arrive thin — a reporter often cannot say _why_. That
  is expected: `Reproduksi bug` investigates, adds the cause and, for a UI defect,
  reproduces it and attaches a screenshot to the issue by editing its body. It
  does not send the issue to `question` for being incomplete.
- The **PR template** has the sections `Mengapa`, `Yang diubah`, `Issue
tertaut`, `Kriteria penerimaan`, `Cara menguji`, `Bukti`, `Risiko` and
  `Catatan` (no `HUMAN`/`AGENT` split and no `Type` checklist since 2026-11-09,
  #965: the type comes from the issue's label). It requires `Fixes #<n>` for
  every issue the PR resolves (each an open issue carrying `ready` or
  `in-progress` — `issue-claim.yml` swaps the first for the second the moment
  the PR opens — never a PR; `Refs #<n>` for a partial step), copies the
  issue's acceptance criteria as checkboxes, and asks for a **before and
  after** visual on any change under `apps/web`. `Issue label sync` mirrors the
  linked issue's type and priority onto the PR.

These are kept honest by the `pr-description-checks` workflow: the `template`
job **fails the check** while the description is incomplete, no issue is
linked, a linked number is not an open `ready`/`in-progress` issue, the PR
does not target the default branch (where alone `Fixes` closes anything), or the
prose reads as English, and passes once it is complete (the `visual` job stays
advisory). There is no "no linked issue" way out (#772). Dependabot alone
skips the job, keyed on the PR's author; a skipped job counts as passing, so
making the check required on `main` (decided 2026-10-11, #772) does not hold
Dependabot back. A `## Risiko` statement (what can break and how
to undo it, at least 20 characters) is required only on a risky PR: one
labelled `security`, or touching the schema, migrations and data scripts, the
production data scripts, or auth/RBAC (`RISKY_PATHS` in
`.github/scripts/pr-template-guard.sh`; #965, replacing the `## HUMAN` note of
#760). The headings were renamed to Indonesian on 2026-11-10 (#982); the guard
matches either the Indonesian name or the old English one, so a body written
before the rename still passes. Fenced code counts as section content, so a
`## Cara menguji` that is only a block of commands is complete; it is left out
of the language check. See `docs/IDEAS.md` § 6.
