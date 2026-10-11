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

| Label               | Use for                                             |
| ------------------- | --------------------------------------------------- |
| `priority:critical` | An outage, data loss, or an active security problem |
| `priority:high`     | Important; schedule for the current cycle           |
| `priority:medium`   | Normal; the default for triaged work                |
| `priority:low`      | Nice to have, no urgency                            |

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

5. **A red pull request stays open.** The `PR lifecycle` workflow leaves a ready
   PR as it is when any required check is failing — the failing checks are
   already visible on the PR, so a draft revert would only hide work in
   progress. It reads the checks exhaustively — every page, every required
   check present — and, once every required check passes, dispatches `Gerbang tinjau PR`
   so the review gate runs the moment CI is green. A green draft PR gets an
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
(`issue-label-sync.yml`, `pr-lifecycle.yml`, `duplicate-sweep.yml`), not
automations: they must fire every time and cost no tokens.

## The self-comment loop guard

An automation posts through the same GitHub account as the person who triggered
it (`user.type: User`, same `login`), so a trigger on `issue_comment.created`
cannot tell the automation's own comment from a reporter's. Issue #680 showed
the consequence: `Penjernih issue` re-armed itself and posted eleven comments in 27
minutes, each a full LLM run.

The only marker is the AI-disclosure footer every automated comment carries:

```
This comment was created by an AI agent (OpenHands) on behalf of the repository maintainers.
```

Every automation whose trigger is `issue_comment.created` **must** add this
negative filter, or it will loop:

```
!icontains(comment.body, 'This comment was created by an AI agent')
```

The automations live outside this repository, so the guard is enforced where
they are deployed: each comment trigger is validated against a sample automated
comment before it is enabled, and every automated comment ends with the footer
above.

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
- The **PR template** requires `Fixes #<n>` to a `ready` issue, copies the
  issue's acceptance criteria as checkboxes, and asks for a **before and after**
  visual on any change under `apps/web`. `Pelabel PR` mirrors the linked issue's
  type and priority onto the PR.

These are kept honest by the `pr-description-checks` workflow: the `template`
job **fails the check** while the description is incomplete, the linked issue is
not `ready`/`bot-implement`, or the prose reads as English, and passes once it is
complete (the `visual` job stays advisory). The `## HUMAN` note is required only
on a risky PR: one labelled `security`, or touching the schema, migrations and
data scripts, the production data scripts, or auth/RBAC (`RISKY_PATHS` in
`.github/scripts/pr-template-guard.sh`; #760). See `docs/IDEAS.md` § 6.
