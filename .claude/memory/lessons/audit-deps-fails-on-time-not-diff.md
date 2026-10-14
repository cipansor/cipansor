# audit-deps-fails-on-time-not-diff

> The Security job asks npm's live advisory endpoint, so it can go red on a PR that changed nothing — and since #460 it can go green without checking anything.

`pnpm run audit:deps` (`scripts/audit-deps.mjs`, run by the **Security** CI job)
posts the installed tree to **npm's** bulk advisory endpoint
(`registry.npmjs.org/-/npm/v1/security/advisories/bulk`, overridable with
`NPM_REGISTRY_URL`) — not GitHub's. Its answer is a function of the **date**,
not of the diff: a newly published advisory reddens every open PR at once, and
`main` too the next time anything runs there.

## When it goes red

1. Run `pnpm run audit:deps` locally. It prints the package, the vulnerable
   range and the advisory URL.
2. If it prints only `Bulk advisory endpoint returned 503` (no package, no
   range), the endpoint failed — run it again before pinning anything.
3. The fix is almost always a pin in the **root** `pnpm-workspace.yaml` →
   `overrides` (a curated list of exactly these pins; the package is
   usually transitive). Then `pnpm install` — commit the lockfile, CI installs
   `--frozen-lockfile` — and re-run until it reports 0 advisories. Run the full
   gate afterwards: an override can pull in a transitive major.

Example (2026-09-02): `fast-uri >=4.1.2` → `>=4.1.3` and `qs ^6.15.2` →
`^6.16.0`. Two lines.

## When no fixed version exists

A pin cannot clear an advisory with no patched release (`first_patched_version:
null` in `gh api /advisories/<GHSA>`). First found 2026-10-03: `braces <=3.0.3`
(GHSA-vfj7-8cjw-p6xm), updated on the 2nd, red on every PR; 3.0.3 was the
newest release.

- `pnpm why <pkg> -r` — is any path a `dependencies` one? If yes, there is no
  waiver: replace or patch what pulls it in.
- Dev-only: an entry in `ACCEPTED_RISKS` (`scripts/audit-deps.mjs`) — exact
  name, version and advisory URL, an `until` date about a month out, and a
  note on why the risk does not reach a running system. The script recomputes
  production reachability from the lockfile on every run, so a new runtime
  path fails whatever the date, and so does the date passing. Each waiver is a
  `::warning::` on the run. When it reds again on the date: look for a
  release, then either pin it and delete the entry, or renew with a reason.

## When it goes green — read the annotation

Since #460 the script times out each request after 30 s
(`AUDIT_TIMEOUT_MS`), retries with backoff (`AUDIT_MAX_ATTEMPTS`), and splits
the failures that used to share one exit code:

| state | exit |
|---|---|
| a finding at or above the threshold | **1** — even if part of the run never answered |
| endpoint exhausted, no finding | **0** + `::warning title=Dependency audit incomplete::N of M packages were NOT audited` |
| our own bug (a 4xx that is not 429, unreadable lockfile) | **2** |

So a green Security box does not mean the tree was checked. On 2026-09-04 the
endpoint answered nothing at all: `3 of 3 request chunks (1169 of 1169
packages) were NOT audited`, exit 0, with the line `Audited 1169 packages — 0
advisories` printed above it. Read the annotation, not that line. Set
`AUDIT_FAIL_ON_UNREACHABLE=1` when a release must not ship on an unverified
tree.

## Is it npm, or our network?

```bash
curl -sS -o /dev/null -w "root: %{http_code} %{time_total}s\n" https://registry.npmjs.org/
curl -sS -o /dev/null -w "bulk: %{http_code} %{time_total}s\n" --max-time 45 \
  -X POST -H "content-type: application/json" -d '{"fflate":["0.8.3"]}' \
  https://registry.npmjs.org/-/npm/v1/security/advisories/bulk
```

Root answering in milliseconds while the bulk POST times out means npm, not
our egress — don't go checking DNS or proxies. To prove a pin while the
endpoint is down: version arithmetic against the advisory's range, the
lockfile no longer holding the old version, and GitHub's own scan
(`gh api repos/<org>/<repo>/dependabot/alerts?state=open`).

## Two traps in the scripts around it

- `pnpm run audit:deps | tail -20; st=$?` captures `tail`'s status, not
  pnpm's. Capture first: `out=$(cmd 2>&1); st=$?`.
- Not the same failure as [github-actions-minutes-exhausted](./github-actions-minutes-exhausted.md):
  that one dies in ~2 s with zero steps. This one runs its steps and fails at
  *Audit dependencies*.
