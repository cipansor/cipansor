# E2E "Install Playwright" reds on a runner DNS flake, not on your change

Measured 2026-11-11 on `docs/792-absensi-pegawai-docs` (PR #1046), ubuntu-26.04
runners.

## What it looks like

The E2E workflow fails in the step **Install Playwright (Chromium)**
(`pnpm --filter web exec playwright install --with-deps chromium`), in about
11 minutes, with:

```
W: Failed to fetch … Temporary failure resolving 'security.ubuntu.com'
E: Failed to fetch https://security.ubuntu.com/ubuntu/pool/…/fonts-*.deb  Temporary failure resolving …
E: Unable to fetch some archives
Failed to install browsers
Error: Installation process exited with code: 100
```

`apt-get` on the runner cannot resolve `archive.ubuntu.com` /
`security.ubuntu.com` / `azure.archive.ubuntu.com`, so the font packages
`--with-deps` installs never download and the browser install aborts. **No test
ran.** The log is a wall of apt warnings; the tell is "Temporary failure
resolving", which is the network, never the diff.

## Why it is not your change

- The failure is in *installing* the browser, before any app code is built.
- The same branch passed E2E an hour earlier (13:42 same day), and unrelated
  branches (`chore/label-taxonomy-overhaul`) failed with the identical message
  in the same window — it is repo-wide, time-bound, and runner-side.
- A docs-only change cannot reach the Playwright install step.

## What to do

- **Do not hunt a regression.** Confirm the message is "Temporary failure
  resolving" in `Install Playwright`, check that other branches failed in the
  same window, then **re-run** the job (`gh run rerun <run-id> --failed`).
- A re-run can fail the same way while the outage lasts. If three re-runs in a
  row hit it, stop spending minutes and say so in the PR — the change is
  unrelated and the job is infrastructure. Do not merge around a real red; this
  one is recognisable and explainable.
- `docs/DEPLOYMENT.md` is classified as **code** by
  `.github/scripts/change-scope.sh` (a guard test reads its numbers), so a PR
  that edits it does **not** skip E2E — which is why a docs PR can carry this
  red.
