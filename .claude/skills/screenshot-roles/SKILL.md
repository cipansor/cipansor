---
name: screenshot-roles
description: Screenshots of the web app. (1) The per-role visual QA sweep — log in as every seeded demo account, open each menu item its role should see, assert the page opens (no crash, no 404, no bounce), and screenshot it. (2) Before/after screenshots of a UI change, rendered from the real components (see before-after.md). Use when asked to "screenshot roles", "visual QA the menus", verify no role hits a broken page, or when a UI change needs its before/after pair.
---

# Per-role screenshot sweep

> **The sweep script below (`screenshot-roles.ts`) is broken since the session moved to HttpOnly cookies** (found 2026-09-29): it
> logs in without `X-Client: bearer`, gets no token in the body and fails "Unexpected login response" for every role. Use
> **`scripts/screenshot-flow.ts`** (this folder) instead: `atlas` = the same per-account sweep (nested menu items included, one
> pass per demo account) and `flow` = a business process step by step from a JSON file, with `see` assertions and API `setup`.
> It logs in through `apps/web/e2e/helpers/auth-api.ts`, which the e2e suite keeps current. Usage, the JSON format and the
> workflow that embeds the pictures in the application documents: `.claude/skills/dokumen-aplikasi-cipansor/references/tangkapan-layar.md`.

> For **before/after screenshots of a UI change** (required by `AGENTS.md` for
> every UI change), read [`before-after.md`](before-after.md) in this folder —
> three ways to render the real components, and the traps in each.

`apps/web/scripts/screenshot-roles.ts` drives a real browser through every
`DEMO_ACCOUNTS` login and every page in that role's navigation, writing
`<outDir>/<role>/*.png` plus `<outDir>/report.json` and a failure summary. It
exits non-zero if any page fails.

## Prerequisites

1. The local stack must be up and seeded with **`E2E_FIXED_2FA=1`** (see the
   `stack` skill) — admins are then pre-enrolled with the fixed TOTP secret the
   script answers; otherwise admin roles are stuck in 2FA setup and cannot log in.
2. A Chromium binary. The pinned Playwright build is often absent in sandboxes;
   point at the preinstalled one instead of running `playwright install`.

## Run

```bash
cd apps/web
export PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome  # adjust to the present build
../api/node_modules/.bin/tsx scripts/screenshot-roles.ts .qa-screens            # all roles
../api/node_modules/.bin/tsx scripts/screenshot-roles.ts .qa-screens super-admin # one role (substring filter)
```

`.qa-screens/` is gitignored — screenshots are a QA artifact, never committed.

## Triaging report.json

- **console-crash** (`is not a function`, `Cannot read … of undefined`): a real
  page bug — a component fed the wrong data shape. Fix it. The API wraps every
  response as `{success, data}`; a hook must return `response.data.data`, not the
  envelope, or the page crashes consuming it as the payload.
- **bounced to /unauthorized**: the role's nav offers a route its middleware
  denies (a menu-vs-RBAC mismatch). Decide per route whether to grant access or
  hide the menu item; some denials are correct and are an accepted baseline.
- **404 / navigation failed**: a linked page that was never built — cross-check
  against the dead-link backlog in `apps/web/src/lib/dead-links.test.ts`.
