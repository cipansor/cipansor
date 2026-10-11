# Load tests

k6 load tests for the Cipansor API, with a **relative** pass/fail policy: a run
is judged against a baseline recorded on the same target, never against a fixed
millisecond budget. A fixed budget would fail the moment the load profile, the
runner's machine or the target changed, and it would say nothing about whether
*this* build got slower than the last one.

The workflow is `.github/workflows/load-tests.yml`, run by hand (Actions → Load
Tests → Run workflow) and before each production release; it has no schedule.
It is not part of CI and does not gate a merge.

## What is here

| Path | What it is |
|---|---|
| `config.js` | The regression tolerances and the load profiles, in one place. The k6 thresholds and the runner's comparison both read it, so they cannot drift apart. |
| `run-load-tests.mjs` | The runner: runs k6, extracts the summary, compares it to the baseline, prints a report and sets the exit code. |
| `run-load-tests.test.mjs` | Unit tests for the runner (`node --test`). No k6 or network needed. |
| `scenarios/public-smoke.js` | Read-only, safe on any target including staging. Anonymous; an expected `401` counts as a pass. |
| `scenarios/authenticated-read.js` | Read-only; needs `LOAD_TEST_EMAIL` / `LOAD_TEST_PASSWORD`. Fails rather than falling back to an anonymous run — see below. |
| `baselines/<host>__<scenario>__<profile>.json` | The recorded baseline per target, scenario **and profile**. |

The profile is part of the baseline name: a `smoke` reference is a one-VU
measurement and comparing a ten-VU `load` run against it is meaningless, so the
runner refuses a profile it has no baseline for (exit `3` — no baseline
recorded; exit `4` is a baseline that exists but fails validation or matching).

## Running it

k6 is not vendored. Install it (or set `K6_BIN`):

```bash
# macOS
brew install k6
# Debian/Ubuntu (see https://grafana.com/docs/k6/latest/set-up/install-k6/)
sudo gpg -k && ... && sudo apt-get install k6
# or drop the binary at /tmp/k6 — the runner checks there last
```

Record a baseline the first time, then compare against it. A baseline for
staging is recorded **from a GitHub runner** (Actions → Load Tests → Run
workflow, tick *record_baseline*), because every later comparison runs there
and latency depends on where it is measured; the run uploads the file as the
`load-baseline` artifact, which is committed under `baselines/` through a PR.
There is no staging baseline in the repository yet: the earlier one was
recorded from another machine and timed `/health`, which on staging is the web
app's redirect to `/login`, not the API (the smoke now asks `/healthz` there).
By hand, for the local stack:

```bash
# 1. Record the baseline (do this once per target + scenario)
node tests/load/run-load-tests.mjs \
  --url https://staging.cipansor.or.id --scenario public-smoke --update-baseline

# 2. Compare a later run against it
node tests/load/run-load-tests.mjs \
  --url https://staging.cipansor.or.id --scenario public-smoke

# Against the local stack (docker compose + db:seed), with credentials. Record
# the authenticated-read baseline once, then compare:
LOAD_TEST_EMAIL=admin@example.com LOAD_TEST_PASSWORD=... \
  node tests/load/run-load-tests.mjs --url http://localhost:3001 \
    --scenario authenticated-read --update-baseline
LOAD_TEST_EMAIL=admin@example.com LOAD_TEST_PASSWORD=... \
  node tests/load/run-load-tests.mjs --url http://localhost:3001 --scenario authenticated-read
```

Flags: `--url`, `--scenario`, `--profile smoke|load`, `--baseline <path>`,
`--update-baseline`, `--allow-shared-target`, `--json`, `--report <path>`.

`--allow-shared-target` is only needed to run the heavy `load` profile against a
known shared host (`staging.cipansor.or.id`): it consumes the staging
request budget and disrupts other people on it, so the runner refuses by default.
The `smoke` profile never needs it.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Ran, no regression against the baseline. |
| `1` | Ran, one or more regressions found (p95/p99, error rate or checks rate). |
| `2` | Could not run — k6 missing, an unknown scenario/profile, a k6 failure, a run that produced no summary, or a **rate-limited** run. Nothing was compared. |
| `3` | No baseline recorded for this target, scenario and profile. Nothing was compared. |
| `4` | The recorded baseline does not match this run (different target, scenario or profile) or is unreadable. Nothing was compared. |

The workflow fails the job on `1` **and** on `2`/`3`/`4`. A green load
test that never actually measured anything is worse than a red one.

A comparison run **requires a valid baseline**: it is checked before k6 starts,
so a missing, malformed or mismatched baseline cannot silently pass. Only
`--update-baseline` accepts an absent baseline, and it writes **only after a run
that completed** (k6 exit `0`, or `99` for crossed thresholds) with the metrics
the comparison needs. A failed run's partial summary never replaces the
reference.

`--report <path>` is written on **every** path, including a preflight failure
(exit `3`/`4`) and a k6 failure — the workflow uploads it, so a failure always
leaves a machine-readable record of what went wrong rather than an empty
artifact.

## The regression policy

Tolerances live in `config.js` (`REGRESSION`). They are deliberately loose:
staging is shared and one run is noisy, so they flag a real step change,
not run-to-run jitter.

- **p95** may grow by `1.5x` before it is a regression; **p99** by `1.75x`.
  Both sides compare against one rounded limit (`latencyLimit()`, rounded up),
  so a run exactly at the limit is a regression for k6 and the runner alike —
  never "thresholds crossed" from one and "no regression" from the other.
- **p99 is only compared once *both* runs have `p99MinSamples` (100) samples.**
  Below that, p99 *is* the single slowest request and swings run to run —
  measured 327 ms → 764 ms across two identical 48-request smoke runs — so it
  would flag regressions that never happened. p95 is checked at every size. The
  runner uses the same baseline-side test as `thresholdsFor()`, so a small
  baseline is skipped by both.
- **Error rate** is computed by the runner from the `expected_responses` /
  `unexpected_responses` counters, not from k6's `http_req_failed` (which
  counts the `401`s the anonymous scenario expects as failures). The ceiling is
  `1%`.
- **Checks rate** must stay above `0.99` (`rate>0.99`); exactly `0.99` fails,
  in both the k6 threshold and the runner's comparison.

Both the k6 thresholds and the runner's comparison read a single metric,
`expected_response_duration`, which each scenario fills only for responses it
expected. This is what keeps k6's own "thresholds crossed" verdict and the
runner's report from disagreeing.

### Rate limiting

The API mounts a global limiter of 100 requests/minute per IP
(`apps/api/src/middleware/rate-limit.ts`). A run that trips it measures the
limiter, not the app, so a `429` is counted separately (`rate_limited`) and the
runner **refuses to record or compare** a baseline from a throttled run: it
prints why and exits `2`. The `smoke` profile stays under the budget on purpose;
the `load` profile does not — point it only at a stack you own.

## Baselines

One JSON file per target, scenario and profile:
`baselines/<host-slug>__<scenario>__<profile>.json`.
`staging-cipansor-or-id__public-smoke__smoke.json` is the recorded staging
baseline. A baseline is a fact about one target on one day, so re-record it
(`--update-baseline`) when the target's capacity or the profile changes, and say
so in the PR. The runner checks the recorded `url`, `scenario` and `profile`
against the run before comparing (exit `4` if they differ).

## The authenticated scenario

`authenticated-read.js` needs `LOAD_TEST_EMAIL` / `LOAD_TEST_PASSWORD` for a
demo account on the target. On the Cipansor API a browser login is also gated by
Cloudflare Turnstile and 2FA; the scenario asks for a bearer client
(`X-Client: bearer`, see `docs/MOBILE_API.md`) so Turnstile — a browser gate —
is not in the way.

It measures **authenticated** reads, so every endpoint requires `200` and the run
fails — it never falls back to the anonymous path. With no credentials, or when
login returns `requiresTwoFactor` / `requiresTwoFactorSetup` /
`requiresPasswordChange` and yields no token, `setup()` throws: k6 writes no
summary and the runner exits `2`. Measuring anonymous `401`s and calling them
authenticated reads is exactly the false green this policy exists to prevent;
use `public-smoke.js` for the anonymous path. **It never fabricates a token.**
The workflow skips the authenticated job — and says so — when the
secrets are unset; that skip is not a pass.

## The load profile and shared targets

The `load` profile (ten VUs, staged) is only for a stack you own. Pointing it at
shared staging consumes the staging request budget and disrupts other users
on it, so the runner refuses a non-`smoke` profile against a known shared host
(`staging.cipansor.or.id`) unless you pass `--allow-shared-target`. A manual
workflow dispatch exposes the same switch as the `allow_shared_target` input,
off by default.
