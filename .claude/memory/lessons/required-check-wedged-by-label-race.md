# A required check that reads live state can wedge a PR forever

A required status check that reads something **at run time** — the labels of the
issue a PR closes, a field another workflow writes, a file another job
produces — is only correct at the instant it runs. If the workflow that owns the
check fires on **one** kind of event and the state it reads changes under
**another**, nothing re-runs the check when the state moves, and a PR that was
opened while the state was wrong keeps a red required check with no recovery:
no push (no `synchronize`), no description edit (no `edited`), nothing.

`PR template reminder` (#866) read the linked issue's `ready` label, and
`pr-description-checks.yml` fires only on **pull request** events. `label-guard`
strips a label a non-bot account applied, and the re-label runs minutes later.
Any PR opened in that window saw an issue without `ready`, failed the check, and
stayed red until it was closed — the description was correct the whole time.

What to do:

- **Re-publish the check on the state's own event.** `issue-label-sync.yml`
  already fires on `issues: [labeled, unlabeled, edited]`; have it re-run the
  guard against each affected PR's head and POST the result there (the
  `publish_pr_check` pattern). The gate stays hard; only its trigger widens.
- **Reproduce it faithfully.** The re-publish must pass the same env the
  pull-request run does (`BASE_REF`, `DEFAULT_BRANCH`), or the second result
  disagrees with the first for reasons unrelated to the state.
- **Watch for the shape, not just this gate.** Any check whose input is written
  by a different workflow (`label-guard`, the triage bridge, a label the owner
  applies by hand) has this race. The test is: "if only the input changes and
  nothing is pushed, what re-runs the check?" If the answer is "nothing", it can
  wedge.

Guard shape that catches it: drive the state-changing workflow's script with a
stub `gh`, make the linked issue's labels differ between the two calls, and
assert the check run is published on the PR head with the conclusion the new
state implies (see `github-label-guards.guard.test.ts`, the
`PR template reminder re-publish` block).
