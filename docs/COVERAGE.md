# Coverage floor

`apps/api/coverage/coverage-summary.json` is compared against
`.github/coverage-baseline.json` by `.github/scripts/coverage-gate.mjs`. A pull
request whose coverage dropped more than `tolerance_pct` below the floor fails
the `Tests` job.

The floor is a **ratchet**: raise it as coverage improves, never lower it to
make a red PR pass. To raise it after adding tests:

```sh
pnpm --filter api test:coverage
# read the four numbers it prints, then edit .github/coverage-baseline.json
```

The bootstrap PR that first introduced the floor set `COVERAGE_GATE=off` on the
`Check coverage floor` step for that one run; it is removed now that the floor
is committed.

## Finding the next gap

`Pemindai celah uji` runs weekly: it ranks untested services/controllers
and web flows by risk and opens **one** issue for the highest-risk gap. It does
not write tests — the issue goes through the normal pipeline (`Pelabel issue` applies
`ready`, `Tiket jadi PR` implements it and links the PR with `Fixes #<n>`).
