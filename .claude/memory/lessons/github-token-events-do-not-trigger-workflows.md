# github-token-events-do-not-trigger-workflows

> A workflow that writes with the automatic `GITHUB_TOKEN` (`${{ github.token }}`,
> `secrets.GITHUB_TOKEN`) starts **no** workflow run for the events it creates.
> A second workflow triggered on that event is dead code in production, and a
> guard test that only reads the trigger config stays green over it.

Hit 2026-11-11 on #838. The defect: `label-guard.sh` removes a protected label a
person applied and applies nothing in its place, so an issue can end with no type
or no priority. The obvious fix (option B in the issue) was to make the triage
bridge react to `unlabeled`. But `label-guard.yml` removes the label with
`GH_TOKEN: ${{ github.token }}` — the automatic token — and GitHub's anti-recursion
rule says an event created with that token does not start a new workflow run.

**How it was confirmed without a live experiment:** sampled the repository's
recent workflow runs and grouped them by actor. Of ~100 runs, **zero** had actor
`github-actions[bot]`, though `label-guard`, `basmalah` and `issue-label-sync` all
write through the automatic token. A workflow run whose actor is the bot would
prove the chain works; its total absence, across every workflow that listens on
`labeled`/`unlabeled`, proves it does not.

**The fix that works:** call the second thing in the **same run**. `label-guard.yml`
now runs the guard, then (gated on the guard's own `revoked` output) calls
`issue-triage-bridge.sh --relabel <n>` as a following step. The guard stays
deterministic and single-purpose; the bridge stays the one dispatcher.

## The reusable checks

- **Who wrote the event?** Before wiring a trigger between two automations, read
  the token the *writer* uses. `github.token` / `secrets.GITHUB_TOKEN` = no chain;
  a PAT or a GitHub App installation token = the chain fires. The OpenHands
  automations use `cipansor-bot` (a PAT), which is why their `labeled` events do
  trigger — do not generalise from them to an Actions-written event.
- **A config guard is not a behaviour guard.** `expect(wf).toMatch(/types:\s*\[labeled, unlabeled\]/)`
  passes while the feature never runs. Assert the mechanism that carries the
  effect (here: the same-run call and its gate), or the guard defends the dead
  code — see [guard-tests-that-measure-the-wrong-thing](./guard-tests-that-measure-the-wrong-thing.md).
- **Prefer the same run over a second trigger.** If two steps are in the same
  job, no event has to propagate at all. Reach for a cross-workflow trigger only
  when the producer is a separate run you do not control.
