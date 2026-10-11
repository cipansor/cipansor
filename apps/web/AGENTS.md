# AGENTS.md — apps/web

Next.js 16 (App Router) + React 19 client. Read the root `AGENTS.md` first.

## Conventions

- **App Router** under `src/app/**`. Prefer Server Components; mark Client
  Components with `"use client"` only when they need interactivity/hooks.
- **Data layer:** the Axios instance in `src/lib/api.ts` (errors via
  `src/lib/api-error.ts`), wrapped by **React Query** hooks in `src/hooks/*`.
  `src/lib/api-client.ts` is a back-compat re-export; import from `lib/api`.
  The response interceptor toasts every non-401 error. A best-effort or
  parallel call whose failure the page handles itself (a role dashboard's
  optional widgets) passes `skipErrorToast: true` in the axios config, or it
  spams "missing permission" / "route not found" at the user.
- **No mock/placeholder data in pages.** If an endpoint is missing, add it to the
  API rather than hardcoding. (Pages still carrying mock data are listed in
  `.claude/memory/known-issues.md`.) This is the web half of **golden rule #8** (ship
  features wired end-to-end): a page needing data is backed by a real endpoint in
  the same change.
- **Types come from `@cipansor/shared`.** Don't redeclare DTOs or use `any` for
  API payloads. Reuse the shared contract; only add a new one to `@cipansor/shared`
  when it truly doesn't exist yet (golden rule #8).
- **Roles:** route protection (`middleware.ts`), navigation (`src/config/navigation.ts`),
  and the auth store (`src/stores/auth.ts`) must reflect real backend `RoleCode`
  + permissions. (Aligning the legacy `UserRole` usage here is tracked in
  `.claude/memory/known-issues.md`.)
- **UI:** Tailwind + Radix primitives in `src/components/ui/*`; compose, don't
  fork. Charts via the shared chart components.

## App shell & navigation

Three defect classes came from this area in one week; each now has a guard test
in `src/lib/rbac.test.ts`. Run `pnpm --filter web test` after touching a page,
a route or `src/config/navigation.ts`.

- **Every authenticated page renders its own shell.** Wrap the return in
  `<MainLayout>` (from `@/components/layout`) — sidebar, header, and
  `ProtectedRoute`. Pages self-wrap **except** under `/parent`, `/marketing`,
  `/e-office` and `/reception`, which own a `layout.tsx` supplying it for the
  whole subtree. When auditing, check for an ancestor `layout.tsx` before
  concluding a page is shell-less; grepping only `page.tsx` for `MainLayout`
  wrongly flags all 14 `/parent/*` pages. 50 pages once rendered as a bare
  `<div>` with no nav and no logout.
- **NEVER wrap a page listed in `middleware.ts`'s `publicPrefixes`**
  (`/profil`, `/program-unggulan`, `/unit`, `/berita`, `/wakaf-infaq`,
  `/kontak`, `/verifikasi`). `MainLayout` implies `ProtectedRoute`, so this
  bounces anonymous visitors to the staff login — the regression that got the
  Google Ad Grants application rejected once already. The guard test parses
  `publicPrefixes` out of `middleware.ts` rather than duplicating the list.
- **A public page belongs to TWO lists.** `publicPrefixes` in `middleware.ts`
  decides what may be *read* without a session; `PUBLIC_PATH_PREFIXES` in
  `src/lib/host-split.ts` decides which *host* serves it —
  `cipansor.or.id` or `portal.cipansor.or.id`. Miss the second and the page is
  reachable only from the portal, behind a login; miss the first and the apex
  serves it and then bounces the visitor. `host-split.test.ts` compares the two
  and fails if they diverge, so adding to one is enough to be told about the
  other. Background in [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).
- **The nav contract runs both ways.** `src/config/navigation.ts` decides what a
  role is *shown*; `src/lib/rbac.ts` (`roleRouteAccess`, consumed by
  `middleware.ts`) decides what it may *open*. Add a nav item → add its prefix
  to `roleRouteAccess`. And a new page must appear in some role's menu, be a
  sub-page of a hub that does, be an action page (`new|create|edit|generate|
  bulk|check-in`), or be listed in `NO_MENU_BY_DESIGN` **with a reason** — 34
  top-level pages once shipped reachable only by typing the URL.
- **Sidebar scrolling:** the nav `ScrollArea` needs `min-h-0`. A flex child
  defaults to `min-height: auto` and refuses to shrink below its content, so the
  area grew to the full menu height and nothing could scroll.

## State & providers

- React Query provider: `src/components/providers/query-provider.tsx`.
- Freshness: React Query polling (`refetchInterval`) — there is no push
  channel (`.claude/memory/decisions/realtime-polling.md`).
- Auth state: `src/stores/auth.ts`.

## Blob preview URLs

Previewing a picked file means `URL.createObjectURL` → `<img src>`. Two traps,
both hit while fixing CodeQL `js/xss-through-dom` in PR #545 (the first only in
that PR's own first commit); `src/hooks/use-file-previews.ts` and
`src/lib/files.ts` are the shared answer.

- **Never re-encode the URL.** A blob URL embeds the page origin. On an IPv6 host
  the serialized host is bracketed, so `encodeURI` rewrites
  `blob:http://[::1]:3000/abc` to `blob:http://%5B::1%5D:3000/abc` — a string the
  browser never registered, and the image silently fails to resolve.
  `objectUrlForFile` returns the value untouched; the `blob:` prefix guard is
  what satisfies CodeQL's `js/xss-through-dom` (its `PrefixStringSanitizer`
  recognizes the guard), not an escaping call.
- **Never create the URL inside a state updater.** React Strict Mode
  double-invokes updaters, so `setItems((prev) => [...prev, { url: createObjectURL(f) }])`
  registers two blobs per file and only the surviving one is ever revoked — the
  other leaks for the document's lifetime. Build the list once in the event
  handler, then `setItems`.

A blob URL pins its file's bytes until revoked, so whoever creates it must
release it (`releaseObjectUrl`) on remove **and** on unmount; `useFilePreviews`
owns both routes. `next.config.ts` sets `reactStrictMode: true`, and Strict Mode
double-invokes updaters only in development (`pnpm dev`), never in a production
build — so the leak shows in dev and in a `<StrictMode>` unit test, and not on
the deployed site. The StrictMode unit test is what pins it.

## Testing

- **Mandatory (golden rule #7):** every new/changed **route/page or user flow**
  ships with Playwright e2e coverage in the **same commit**. A page is not "done"
  until a spec drives its real flow. A bug fix ships with a regression spec.
- **E2E:** Playwright in `e2e/` (`pnpm test:e2e`). Reuse the Page Object Model in
  `e2e/page-objects`, fixtures (`e2e/fixtures/{auth,api}.fixture.ts`), and helpers.
  Run against the real seeded stack (Postgres+Redis up, API seeded) — `webServer`
  starts `pnpm dev`. Cover each route's nav, CRUD, every button/field (valid +
  invalid), and RBAC per role. Prefer real API calls over `page.route` mocks.
  Radix triggers animate — on Firefox/WebKit under CI load, `click({ force: true })`
  once the element is visible avoids the flaky "element not stable" gate.
- **Unit/component tests:** `pnpm --filter web test` runs vitest with three
  projects (`apps/web/vitest.config.ts`): `unit` (jsdom + React Testing Library,
  `src/**`), `e2e-utils` and `scripts`. Shared hooks, utilities and components
  get unit tests there; a user flow still gets Playwright.

## PWA (the mobile app)

The mobile app is this web app shipped as an installable PWA — there is no
separate mobile codebase. Pieces: `public/manifest.json` + `public/icons/*`,
`public/sw.js` (service worker), `public/offline.html`, and
`components/pwa/{service-worker-register,install-prompt}.tsx` mounted in the root
layout. Rules: never cache `/api/**` in the service worker (auth/session must
stay fresh); the SW registers in production only **and never under browser
automation** (`navigator.webdriver`) — a navigation-intercepting SW trips a
known WebKit+Playwright engine bug, so `ServiceWorkerRegister` skips it to keep
e2e deterministic across engines (real users are unaffected); keep the manifest
icons in sync if you regenerate them. See `docs/MOBILE_API.md` for the
parent-app API contract.

**The PWA belongs to the portal only.** `pwaEnabledForHost` in
`lib/host-split.ts` gates the manifest, the Apple web-app tags, the
`beforeinstallprompt` script and the install banner; `indexableHost` gates the
robots meta the same way. Two rules that are easy to get wrong:

- **Polarity.** Write it as "off on the public site", never "on for the portal".
  `isPublicSiteHost` is false for localhost, so the inverted form silently
  removes the PWA from `pnpm dev` and nobody can test the install flow.
- **`ServiceWorkerRegister` still mounts where the PWA is off**, and there it
  *unregisters*. A worker outlives the page that registered it, so merely not
  registering leaves every earlier visitor behind a stale one forever.

**One build serves two hosts, so everything in the root layout's `<head>` ships
on both.** Anything host-specific must be built in an async `generateMetadata()`
reading `headers()`, not declared as a static `metadata` export.

## Responsive layout

**`document.scrollWidth` does not reveal overflow in this app.** The app shell's
`main.flex-1.overflow-auto` is a scroll container, so an over-wide toolbar
scrolls *inside* `<main>` and the document width stays correct while content
slides sideways under a stationary header. To find real breakage, walk each
overflowing element's ancestors: a **local** scroller (the
`div.relative.w-full.overflow-x-auto` around a table) is the correct pattern; a
scroller that is `<main>`/`<body>` means the whole content area drags.

- **Page headers** use
  `flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between` with a
  `flex flex-wrap gap-2` action row. This is a no-op at ≥640px by construction —
  the `sm:` variants restore exactly the properties they replace.
- **`truncate` needs `min-w-0` on _every_ flex ancestor**, not just the first. A
  flex item defaults to `min-width: auto`, which resolves to its content's
  min-content width, so one nested row without it keeps a card 227px too wide
  while the `<span>` wears a `truncate` class that never fires.
- **Never `justify-center` a flex row that can overflow.** It spills past both
  edges and browsers cannot scroll to a negative offset, so the *first* item
  becomes unreachable. `TabsList` uses `justify-start` for this reason.
- **A grid with no explicit mobile column can be widened by its own content.**
  `grid gap-6 md:grid-cols-2` leaves the implicit column at `auto`, which is
  floored by the item's min-content — and `1fr` is no fix, because `1fr` means
  `minmax(auto, 1fr)`. On `/e-office` the container measured 310px while
  `grid-template-columns` computed to 577px, hanging each card 227px off a 390px
  screen. Write `grid-cols-[minmax(0,1fr)]` for the mobile column when the
  content contains anything `nowrap` (which every `truncate` does). Tailwind's
  `grid-cols-N` utilities already expand to `repeat(N, minmax(0, 1fr))`, so only
  the *implicit* column needs saying. ~588 grids in this app share the shape;
  it only bites where content cannot shrink, so fix the measured ones rather
  than sweeping.
- **`min-w-0` and `minmax(0,1fr)` solve different halves.** `min-w-0` down the
  flex chain lets text ellipsize once the column is capped; it cannot cap the
  column. Applying it to the card alone took `/e-office` from 577px to 510px —
  better, still broken. Measure after each, do not assume one implies the other.

## Build

- `pnpm build` runs `next build`. `next.config.ts` does NOT ignore type/lint
  errors — keep the build type-clean. Security headers are configured there;
  don't remove them.
- No error-monitoring service is connected. A caught UI error goes through
  `captureError` in `src/lib/report-error.ts` and nowhere else, so the one
  that is chosen (the release plan points at Azure Application Insights) is
  wired in one place. Sentry was removed on 2026-09-28: no environment had
  ever run it.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
