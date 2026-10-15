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

Priority is **evidence-backed**, not a feeling: `Pelabel issue` weighs impact,
urgency and risk, and anything above `medium` must name the concrete evidence.
A higher label with no evidence is a defect the triage owner must correct.

| Label               | Use for                                                                                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `priority:critical` | Exactly one of: layanan mati total; kehilangan/korupsi data; kerentanan keamanan atau kebocoran data pribadi (UU PDP) yang aktif bisa dieksploitasi; pipeline rilis macet total. Naming the concrete victim (unit/peran) and the evidence is required. |
| `priority:high`     | Menghambat pekerjaan unit/peran sekarang; a regulatory/accreditation deadline this cycle; many users with no workaround; or a security weakness that cannot yet be exploited. Naming the blocker or the deadline is required.                        |
| `priority:medium`   | Normal; the default for triaged work — real, but not blocking and with a workaround.                                                                                                                                                                |
| `priority:low`      | Nice to have, no urgency (cosmetic).                                                                                                                                                                                                                |

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

| Label                | Meaning                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ready`              | Specified enough to implement; open to a contributor or the bot                                                                    |
| `bot-implement`      | Serahkan issue ini ke `Tiket jadi PR` — bot mengerjakannya. Pakai sebagai ganti (atau bersama) `ready` bila pekerjaannya milik bot |
| `pending-maintainer` | Waiting for a maintainer to decide whether to proceed; `ready` starts implementation                                               |
| `needs-info`         | Waiting on the reporter for a missing detail                                                                                       |
| `in-progress`        | Someone or an automation is actively working on it                                                                                 |
| `blocked`            | Cannot proceed until a dependency is resolved                                                                                      |
| `stale`              | No activity for a long time; will close unless kept                                                                                |
| `question`           | A question, not a change request                                                                                                   |
| `duplicate`          | An issue already reported elsewhere; the original is linked                                                                        |
| `duplicate-pr`       | A pull request already covered by another PR or issue; closed like a duplicate after the warning                                   |
| `invalid`            | Not a valid report                                                                                                                 |
| `wontfix`            | Deliberately not going to be done                                                                                                  |
| `bug-hunter`         | Provenance: found by the Bug hunter automation                                                                                     |
| `automation-health`  | Fleet-health report from the watchdog; needs a maintainer                                                                          |
| `automation`         | Report or action from an automation; skip in manual triage                                                                         |

## The rules

1. **Type and priority are shared between an issue and its pull request.** When
   a PR closes an issue, it must carry the same type label and the same priority
   label. `Pelabel PR` sets them from the issue; the `Issue label
sync` workflow adds anything missing and **fails the check** when the type
   genuinely disagrees (a different type is a real conflict, not something to
   guess at). A PR that closes **more than one** issue must satisfy every one of
   them, and the check fails when the issues disagree among themselves. Changing
   a linked issue's labels re-runs the sync on every open PR that closes it,
   because an `issues` event fires no `pull_request` event. A **fork** PR's
   token cannot edit labels, so the sync fails (naming the labels) rather than
   passing with the PR mislabeled — a passing check on a mislabeled PR is what a
   merge gate would read.

2. **Status labels are not copied to a pull request.** `question`, `needs-info`,
   `duplicate`, `invalid`, `wontfix`, `blocked`, `ready` and `in-progress`
   describe an issue's own lifecycle. A PR's lifecycle is its draft state and
   its reviews. The one exception is `duplicate-pr`, which exists _for_ a PR:
   the issue-lifecycle `duplicate` label must never sit on a PR, so a duplicate
   pull request is marked with `duplicate-pr` and swept the same way as a
   duplicate issue (rule 4).

3. **Two labels gate implementation, and only one of them hands the work to
   the bot.** `ready` means an issue is well-specified and open to anyone —
   `Pelabel issue` applies it only when the issue has a clear goal
   and a concrete acceptance criterion, otherwise it applies `needs-info` and
   lists what is missing. `bot-implement` is the narrower signal that the
   maintainer wants `Tiket jadi PR` to implement it. `Tiket jadi PR` triggers
   on `bot-implement`, never on `ready`: if it triggered on `ready` the bot
   would take over the whole backlog and leave nothing for human contributors.
   Apply `bot-implement` to hand one issue to the bot; leave it off to leave the
   issue for a person.

4. **A duplicate closes itself.** `Pelabel issue` applies `duplicate` to an issue and
   links the original; the same detection on a pull request applies
   `duplicate-pr`. The `Duplicate sweep` workflow warns each once — recording a
   hash of the description — then closes it after seven days unless it is shown
   to be distinct: the description changed since the warning, or a person
   replied — or a maintainer removes the label. An automated comment, and any
   comment from a bot account, does not count as a reply. A duplicate PR is
   closed without merging. A warning that carries no description hash (an older
   one, or one edited by hand) cannot be checked for an edit, so the sweep
   leaves that item open for a maintainer rather than closing on a guess.
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
   never merges and never changes the draft state.

7. **A review proposes the fix, it does not only complain.** `Peninjau arsitektur`,
   `Peninjau kode`, dan `Gerbang tinjau PR` saat mengembalikan PR, memposting setiap masalah lokal dan mekanis
   problem as a GitHub `suggestion` block so the author can apply it in one
   click, and describe the proposed change in words for a problem too large for
   a block. A suggestion is never placed on a line the automation is not certain
   of. This is the same "suggest a change" affordance Copilot's review uses.

8. **`ready` is a strong claim, and it is exclusive.** `Pelabel issue` applies
   `ready` only when it is **very sure**: the goal is clear, the acceptance
   criterion is concrete and observable, and **no question is left open**. While
   anything still has to be discussed, decided, or criticized — a design choice,
   an unknown scope, a premise that may not hold — it is not `ready` yet; apply
   `needs-info` (or `question`, for a question rather than a change) and name
   what is missing. `ready` must never sit beside `question`, `needs-info`, or
   `pending-maintainer`: two labels that contradict each other make the
   machine-readable state ambiguous (#814 carried `ready` and `question`
   together). The automations are told to criticize hard and ask probing
   questions until they are sure, precisely so `ready` is not applied early.
   `label-guard.sh` enforces the exclusivity: it removes `ready` whenever it
   still coexists with an exclusion once the event's own label is accounted for,
   so a person adding a second exclusion beside an existing `ready` does not
   leave the issue contradictory.

9. **Issues: comment first, description when `ready`.** While an issue is not
   yet `ready`, the triage, the estimate, the acceptance criteria and the open
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
    applying a type or priority label, or a not-yet-`ready` issue gaining
    activity (an edited description or a new comment) newer than its last
    triage, dispatches the triage owner — deterministically, from
    `.github/scripts/issue-triage-bridge.sh`, and idempotently (a marker comment
    per type+priority state, and one per activity timestamp). This is why
    nothing needs to fire on `issues.edited`: the bridge polls and the label
    event is the hook.

12. **Only `cipansor-bot` labels.** Every label in the taxonomy above is the
    bot's to apply. A protected label added by any other account is removed by
    the `Label guard` workflow and the account is told once. The protected set is
    every label that exists in the repository minus the human-decision labels
    (`rilis-disetujui`, `rilis-ditolak`, `bot-implement`), read at run time — a
    new label is protected the moment it is created. A GitHub App (`*[bot]`) is
    exempt, because the Actions workflows label through `github-actions[bot]`.
    **On an issue, the type label its form applies at open is also exempt:**
    `bug_report.yml` sets `bug` and `feature_request.yml` sets `enhancement` the
    moment the issue is created, and a type label is the reporter's declared
    intent — the triage owner sets the correct type on top, revoking the wrong
    one. On a **pull request** there is no such form, so a type label stays
    protected there: a manually applied `bug` on a PR that closes an
    `enhancement` issue would otherwise fail the type sync (`issue-label-sync`)
    and redden the PR. A person states what they want and the bot records it;
    this is what keeps the automations and the guards reading the same state.

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

| Automation          | Trigger                                        | Labels it sets                                                     |
| ------------------- | ---------------------------------------------- | ------------------------------------------------------------------ |
| `Pelabel issue`     | issue opened                                   | tipe, prioritas, `ready` / `needs-info` / `question` / `duplicate` |
| `Tiket jadi PR`     | issue labelled `bot-implement`                 | tidak ada — ia membuka PR                                          |
| `Penjernih issue`   | comment on a `needs-info` issue                | `needs-info` ↔ `ready`, `duplicate`, `invalid`                     |
| `Pelabel PR`        | PR opened                                      | tipe dan prioritas issue tertaut, atau `duplicate-pr`              |
| `Gerbang tinjau PR` | PR ready for review, or CI-green dispatch      | tidak ada — ia meninjau atau menyetujui                            |
| `Pemburu bug`       | daily cron                                     | membuka issue `bug`, satu prioritas, `bug-hunter`, `bot-implement` |
| `Pemindai standar`  | weekly cron                                    | membuka issue dengan tipe, prioritas, `pending-maintainer`         |
| `Penjaga issue`     | daily cron                                     | `stale`, dan menutup issue menganggur `not planned`                |
| `Diskusi`           | comment on `pending-maintainer` / `needs-info` | `ready`, `wontfix`, `needs-info`                                   |
| `Pengawas armada`   | daily cron                                     | `automation-health` pada laporannya                                |

The deterministic consequences are GitHub Actions workflows
(`issue-label-sync.yml`, `pr-lifecycle.yml`, `duplicate-sweep.yml`,
`gate-watch.yml`, `label-guard.yml`, `basmalah.yml`, `acknowledge.yml`,
`issue-triage-bridge.yml`), not automations: they must fire every time and cost
no tokens. `label-guard.yml` enforces rule 12, `basmalah.yml` rule 13,
`acknowledge.yml` rule 14, and `issue-triage-bridge.yml` rule 11.

## The self-comment loop guard

An automation posts through the same GitHub account as the person who triggered
it (`user.type: User`, same `login`), so a trigger on `issue_comment.created`
cannot tell the automation's own comment from a reporter's. Issue #680 showed
the consequence: `Penjernih issue` re-armed itself and posted eleven comments in 27
minutes, each a full LLM run.

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
not turned away — the automations absorb it: `Triase bug` triages it, `Estimasi usaha`
sizes it or lists the questions that would unblock it, dan `Pelabel issue` applies
`needs-info` with the exact missing detail rather than `ready`. A security
vulnerability is routed to a private advisory (`SECURITY.md`), never a public
issue.

The issue forms (`.github/ISSUE_TEMPLATE/`) and the pull-request template exist
to produce the labels above, not prose to read and forget:

- The **bug** form requires a reproduction and an acceptance criterion; the
  **feature request** form requires a motivation and a criterion. What these
  fields contain is what `Pelabel issue` reads to decide `ready` versus `needs-info`.
- A `bug` issue may still arrive thin — a reporter often cannot say _why_. That
  is expected: `Reproduksi bug` investigates, adds the cause and, for a UI defect,
  reproduces it and attaches a screenshot to the issue by editing its body. It
  does not send the issue to `needs-info` for being incomplete.
- The **PR template** requires `Fixes #<n>` for every issue the PR resolves
  (each an open `ready` issue, never a PR; `Refs #<n>` for a partial step), copies the
  issue's acceptance criteria as checkboxes, and asks for a **before and after**
  visual on any change under `apps/web`. `Pelabel PR` mirrors the linked issue's
  type and priority onto the PR.

These are kept honest by the `pr-description-checks` workflow: the `template`
job **fails the check** while the description is incomplete, no issue is
linked, a linked number is not an open `ready`/`bot-implement` issue, the PR
does not target the default branch (where alone `Fixes` closes anything), or the
prose reads as English, and passes once it is complete (the `visual` job stays
advisory). There is no "no linked issue" way out (#772). Dependabot alone
skips the job, keyed on the PR's author; a skipped job counts as passing, so
making the check required on `main` (decided 2026-10-11, #772) does not hold
Dependabot back. The `## HUMAN` note is required only
on a risky PR: one labelled `security`, or touching the schema, migrations and
data scripts, the production data scripts, or auth/RBAC (`RISKY_PATHS` in
`.github/scripts/pr-template-guard.sh`; #760). See `docs/IDEAS.md` § 6.
