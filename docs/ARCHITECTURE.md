# Architecture

System overview for the Cipansor IMS monorepo. This is the "map"; the
authoritative, area-specific conventions live in the `AGENTS.md` files
(root + per package) and the known gaps live in
[`known-issues.md`](../.claude/memory/known-issues.md).

## Monorepo layout

```
apps/
  api/        Express 5 + Prisma 7 REST API (+ cron jobs)
  web/        Next.js 16 (App Router) + React Query frontend
packages/
  shared/     Framework-agnostic DTOs / Zod schemas shared by both apps
```

Tooling: **pnpm** workspaces + **Turborepo**. Package manager is pinned
(`packageManager: pnpm@9.0.0`); use `corepack` rather than a global pnpm.

## Backend (`apps/api`)

Express 5 with a layered, per-feature module structure. The standard — and the
reuseable cross-cutting pieces — are documented in
[`apps/api/AGENTS.md`](../apps/api/AGENTS.md):

```
src/modules/<name>/
  <name>.routes.ts      # Router: authenticate/authorize/validate -> controller
  <name>.controller.ts  # thin; asyncHandler; returns via ApiResponse
  <name>.service.ts     # business logic; the ONLY layer that touches Prisma
  <name>.schema.ts      # Zod schemas (types via z.infer)
  index.ts              # export { <name>Routes }
  tests/                # vitest, Prisma mocked
```

Layering rule: **routes never call Prisma; controllers never embed business
logic.** It is the rule, not yet the state: measured on 2026-09-25, 22 of the 93
modules follow the layout fully, 12 call Prisma from a route or controller, and
23 import another module directly (see `.claude/memory/known-issues.md`).
Modules are mounted in `src/app.ts` under `/api`; the move to `/api/v1`, with
modules grouped by domain context, is phase 4 of the audit plan in
`.claude/memory/roadmap.md`.

Cross-cutting foundations (reuse, don't reinvent):

- **Responses** — `src/utils/response.ts` (`ApiResponse.success/error/paginated`).
- **Errors / validation** — `src/middleware/error.ts` (`Errors.*`, `asyncHandler`,
  `validate`/`validateQuery`); centralized Prisma/Zod/JWT error mapping.
- **Auth / RBAC** — `src/middleware/auth.ts` (`authorize(RoleCode.X)`,
  `hasPermission`, `isAdmin`, …). `req.user` carries `roleCode`, `permissions[]`,
  `unitId`. Gate on `RoleCode`/permissions — not the deprecated `role` string.
- **Infra** — `src/lib/{prisma,redis,jwt,logger,event-bus,dashboard-metrics}.ts`.
- **Cross-module side effects** — emit typed events on `eventBus` (`AppEvents`);
  don't reach into other modules' services. `notification:send` drives the
  notifications module. Nothing is pushed to browsers: the web polls through
  React Query (`.claude/memory/decisions/realtime-polling.md`).
- **Scheduled work** — `src/jobs/` (node-cron): snapshots, summaries, cleanup,
  auto-billing, SPP reminders, identity and transcript purges. The jobs run
  **inside the API process with no lock**, so the design assumes **one API
  instance**: a second instance would run each job twice (SPP reminders sent
  twice). A lock (`pg_try_advisory_lock`) or a separate worker must come before
  any scale-out. `SCHEDULER_ENABLED=false` switches them off (staging).

### Data layer (Prisma 7)

- The runtime client connects through the **`@prisma/adapter-pg` driver adapter**
  (`src/lib/prisma.ts`); the connection URL lives in `prisma/prisma.config.ts`,
  **not** in `schema.prisma`. Standalone scripts use `prisma/client.ts`'s
  `createPrismaClient()`.
- Edit `prisma/schema.prisma`, then `pnpm --filter api db:generate`. **Never**
  hand-clobber the schema (it was once truncated to a stub — see
  [`apps/api/prisma/AGENTS.md`](../apps/api/prisma/AGENTS.md)).
- Import DB enums and the `Prisma` namespace from `@prisma/client`; use
  `RoleCode` (not the legacy `UserRole`). `Decimal` comes from
  `@prisma/client/runtime/client`.

## Frontend (`apps/web`)

Next.js 16 App Router (RSC + client components). Conventions in
[`apps/web/AGENTS.md`](../apps/web/AGENTS.md):

- **Data layer** — a single Axios client in `src/lib/api.ts` whose `baseURL`
  already includes `/api` (`NEXT_PUBLIC_API_URL`, e.g.
  `http://localhost:3001/api` in dev). Hooks therefore call paths **without** an
  `/api` prefix (`api.get('/risk/123')`). In production the variable is **empty**,
  which makes the base relative (`/api`) so one image serves both hosts with the
  API same-origin on each — hence `??` rather than `||` at every read of it, since
  `||` would fold the empty string into the localhost fallback. Wrap calls in React Query hooks under
  `src/hooks/*`; surface errors via `src/lib/api-error.ts`.
- **Auth** — the API issues the session as `HttpOnly; Secure; SameSite=Lax`
  cookies (`cipansor_at`/`cipansor_rt`), plus a readable `cipansor_csrf` for
  double-submit CSRF and an HttpOnly `cipansor_principal` holding only
  `{id, role, roleCode}` for routing. `middleware.ts` reads
  `cipansor_principal` locally before page JS runs — no API round trip, so a
  page load and every `<Link>` prefetch cost no rate-limit slot. Unsafe requests
  echo `cipansor_csrf` in `x-csrf-token`. The Axios response interceptor
  refreshes on 401 then redirects to `/login`. No token is ever in
  `localStorage` or a script-written cookie, and a request authenticated by a
  session cookie never receives a token in a JSON body (`X-Client: bearer` is
  honoured only for cookie-less clients — the mobile app).
- **Routing/menus** — gate by role/permission (`config/navigation.ts`,
  `components/auth/protected-route.tsx`).

## Roles & access model

Access is enforced in **three places**, and they must agree:

1. **`middleware.ts`** — `publicPrefixes` decides what an anonymous visitor may
   read; `roleRouteAccess` (`src/lib/rbac.ts`) decides which prefixes a role may
   open. Both are also mirrored into `host-split.ts` (`PUBLIC_PATH_PREFIXES`),
   and a guard test fails if the two lists diverge.
2. **`src/config/navigation.ts`** — what a role is _shown_. A page must appear in
   some role's menu (or be a sub-page/action page, or be listed in
   `NO_MENU_BY_DESIGN` with a reason).
3. **The API** — `authenticate` + `authorize(RoleCode.X)` / `hasPermission(...)`
   per route. This is the authority; the client-side checks are UX, not security.

The canonical role list is the `RoleCode` enum in `schema.prisma` (53 codes),
and one demo account per role — 65 in all, several roles having more than one
persona — is seeded for local login from
`packages/shared/src/types/demo-accounts.ts` — the single list consumed by both
the API seed and the login page.

## Shared (`packages/shared`)

Single source of truth for DTOs and Zod schemas consumed by both apps. No
app-specific imports; export through the barrel. See
[`packages/shared/AGENTS.md`](../packages/shared/AGENTS.md). Note `z.infer`
(output; defaulted fields required) vs `z.input` (defaulted fields optional)
when typing request bodies.

## Request lifecycle (typical authenticated call)

```
web hook (React Query)
  -> lib/api.ts (Axios; HttpOnly session cookie + x-csrf-token; baseURL .../api)
  -> Express route (authenticate -> authorize/hasPermission -> validate)
  -> controller (asyncHandler)
  -> service (business logic; Prisma via adapter)
  -> ApiResponse envelope { success, data, meta? }
  -> (side effects) eventBus -> notifications / dashboard cache invalidation
```

## Testing & the green gate

Run the full gate locally before pushing (CI re-runs it as a backstop):

```
pnpm --filter @cipansor/shared build
pnpm --filter api db:generate
pnpm --filter api build        # tsc, lenient build config
pnpm --filter api build:strict # tsc, full strict — the real type gate
pnpm --filter api test         # vitest, Prisma mocked
pnpm --filter web build
pnpm --filter web test
pnpm --filter web test:e2e     # Playwright; needs the seeded stack
pnpm format
pnpm lint
```

`pnpm build` uses the lenient `tsconfig.build.json` (`strictNullChecks: false`,
which also degrades Zod inference); `build:strict` is the target to fix toward,
not to relax.

- API unit tests mock Prisma; the opt-in DB integration suite runs with
  `RUN_DB_TESTS=1` against a real Postgres.
- Playwright e2e uses a Page Object Model + fixtures under `apps/web/e2e`;
  authenticated flows seed the session (admin 2FA via a fixed seed secret,
  `E2E_FIXED_2FA=1`). Mock-based specs seed auth with `addInitScript` so the
  store is hydrated before first paint (avoids logout-redirect races).

## Deployment

### Two hosts, one build

| host                    | serves                                                                           |
| ----------------------- | -------------------------------------------------------------------------------- |
| `cipansor.or.id`        | landing, `/profil`, `/unit`, `/berita`, `/wakaf-infaq`, `/kontak`, `/verifikasi` |
| `portal.cipansor.or.id` | `/login` and everything behind it                                                |

The split is enforced in `apps/web/src/lib/host-split.ts`, called from
`middleware.ts` **before** the auth checks — so an anonymous visitor opening a
bookmarked `cipansor.or.id/dashboard` meets the login screen _on the portal_, with
`?redirect=` intact, rather than one on the apex that holds no session.

It lives in the codebase rather than in nginx because the route table is here; a
copy of it in a config file is the copy that drifts. Unknown hosts are left alone,
so `pnpm dev` on localhost keeps single-host behaviour.

**Why it exists:** whether a page is public is decided by `publicPrefixes`, a
hand-maintained list. A page added under a prefix nobody remembers to list bounces
a prospective parent to the staff login screen. A marketing host with no
application on it makes "public" the default there.

**Why there are no per-unit subdomains:** sessions do not cross hosts — the
session is an `HttpOnly` cookie scoped to the portal host (no `domain=`), and
`auth-storage` (the cached *user*, not a credential) is host-only too.
`SECONDARY_ROLES` deliberately gives one person roles in two units, so per-unit
hosts would have forced them to sign in twice. Public unit pages are paths:
`/unit/[slug]`.

Production and staging run on **Azure App Service** as sidecar containers
(details in [`deploy-azure.md`](deploy-azure.md)): an **nginx** main container
(`deploy/azure/nginx/nginx.conf`, one catch-all `server` block for every
hostname) receives all traffic and routes `/api`, `/uploads` and `/healthz` to
the api container and everything else to web. The root `nginx.conf` and
`docker-compose.yml` are the earlier single-host deployment.

`/verifikasi` stays on the apex permanently — those URLs are printed on paper.

### Images

Each app has a multi-stage `Dockerfile` (`apps/api`, `apps/web`):

- **api** — fresh `pnpm install --prod` closure + compiled `dist` + the generated
  Prisma client; non-root; `node dist/main.js`.
- **web** — Next.js **standalone** output (`server.js`); non-root.

Both trust a build-time proxy CA passed as a BuildKit secret (`id=proxyca`) when
building behind a TLS-terminating egress proxy, and bake nothing proxy-specific
into the image. The build context is kept tiny via `.dockerignore`.
