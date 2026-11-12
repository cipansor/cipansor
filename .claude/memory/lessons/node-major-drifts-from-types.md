# node-major-drifts-from-types

> The runtime was Node 22 while both apps declared `@types/node` 26: `build:strict`
> then proves the code type-checks against a Node the deployment never runs.
> Pinning the runtime in five places (#787) is only half the job — **Node 25
> removed Corepack from the distribution**, so every `corepack enable` in a
> Dockerfile silently became a broken build the moment the image moved to 26.

**Since #787 (2026-11-11)** the runtime is **Node 26** (Active LTS 2026-10-28,
supported to 2029-04-30), chosen by maintainer decision K34 to match the
`@types/node` 26 already in use rather than downgrade the types. One major, one
value, in five declarations:

| Declaration | Where |
|---|---|
| `@types/node` (the anchor) | `apps/api/package.json`, `apps/web/package.json` |
| `NODE_VERSION` | every workflow in `.github/workflows/` |
| `FROM node:<major>` | `apps/api/Dockerfile`, `apps/web/Dockerfile` |
| `engines.node` | root `package.json` |
| `26` | `.nvmrc` |

`apps/api/src/utils/node-runtime-version.guard.test.ts` binds all five to one
major and fails on any drift. A host-side simulation cannot catch the next
mistake here, so the guard reads the files instead.

## Corepack left the Node distribution in Node 25

Measured against the official release tarballs (the file list, not a changelog):

```bash
curl -sL https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.gz | tar -tz | grep -c corepack   # 60
curl -sL https://nodejs.org/dist/v25.0.0/node-v25.0.0-linux-x64.tar.gz  | tar -tz | grep -c corepack   #  0
curl -sL https://nodejs.org/dist/v26.13.0/node-v26.13.0-linux-x64.tar.gz | tar -tz | grep -c corepack  #  0
```

So `RUN corepack enable` on `node:26-alpine` dies with `corepack: not found`.
Both Dockerfiles install it from npm first — `npm install -g corepack@0.36.0`
(its `engines` covers Node `>=26.0.0`) — before `corepack enable`, which writes
the `pnpm` shim into the image's global prefix, already on `PATH`. The guard
test refuses a Dockerfile that calls `corepack` on a major `>= 25` without that
install. `.openhands/setup.sh`, `README.md` and `docs/ARCHITECTURE.md` carry the
same fix for a local toolchain.

## `engines.node` is a contract pnpm only reads on request

`pnpm install` **ignores** `engines` by default — the install succeeds and says
nothing. It is enforced only with `--config.engine-strict=true` (then
`ERR_PNPM_UNSUPPORTED_ENGINE`). The `engines` field is therefore documentation
and a guard-test anchor, not a gate on its own.
