# AGENTS.md — apps/api

Express 5 + Prisma 7 REST API. Read the root `AGENTS.md` first.

## Module layout (the standard)

```
src/modules/<name>/
  <name>.routes.ts      # Router; authenticate/authorize/validate; -> controller
  <name>.controller.ts  # thin; asyncHandler; ApiResponse.success/error/paginated
  <name>.service.ts     # business logic; the only layer that touches Prisma
  <name>.schema.ts      # Zod schemas; export types via z.infer
  index.ts              # export { <name>Routes }
  tests/                # vitest, Prisma mocked
```

Layering: **routes never call Prisma; controllers never embed business logic.**
Mount new modules in `src/app.ts`.

> **File naming: `<name>.<type>.ts`.** Every module file carries its type suffix
> (`finance.controller.ts`, `finance.service.ts`, `finance.schema.ts`,
> `finance.routes.ts`) — the `feature.type.ts` convention from the Angular style
> guide and NestJS. It keeps files greppable and unambiguous across ~110 modules
> (a folder of bare `controller.ts` / `service.ts` tabs is indistinguishable in
> editors and fuzzy-finders). All controller/service/schema/routes files now
> follow this; keep new files consistent.

## Reuse, don't reinvent

- Responses: `src/utils/response.ts` (`ApiResponse`).
  **`ApiResponse.error(message, code)` — message first.** Easy to get backwards
  and silent when you do: the three calls in `modules/chatbot/chatbot.controller.ts`
  had `code` holding an Indonesian sentence and `message` holding
  `CHATBOT_UNAVAILABLE`, which inverts their jobs — the code is the machine-readable
  half. Nothing failed, because no caller read it. Fixed 2026-09-04; if you add a
  branch that returns an error the widget or a client acts on, assert the `code`
  in a test.
- Errors/validation: `src/middleware/error.ts` — throw `Errors.notFound()`,
  `Errors.badRequest()`, etc.; wrap async handlers in `asyncHandler`; validate
  with `validate(schema)` / `validateQuery(schema)`.
- Auth/RBAC: `src/middleware/auth.ts` — `authorize(RoleCode.X, ...)`,
  `hasPermission('perm')`, `isAdmin`, `isSuperAdmin`, `isTeacherOrAbove`.
- Infra: `src/lib/{prisma,redis,jwt,logger,event-bus,dashboard-metrics}.ts`.
- **No push channel** (Socket.IO, WebSocket, SSE): the web polls. Adding one is
  a decision — `.claude/memory/decisions/realtime-polling.md`, enforced by
  `src/utils/push-channel.guard.test.ts`.
- **Outbound URLs: `config.publicSiteUrl` / `config.portalUrl`**, and for
  certificates `utils/verification-url.ts`. Never build one from
  `process.env.SOMETHING || 'https://…'` inline. There used to be an `APP_URL`
  doing that job; because the name says nothing about *which* of the two hosts
  it means, four call sites each guessed differently and all four shipped —
  `cipansor.app` (×2), `cipansor.com`, `localhost:3000`. Two of those are domains
  the yayasan does not own, and one was printed onto physical asset labels.
  Pick by audience: `publicSiteUrl` for anything an outsider scans or clicks,
  `portalUrl` only for links whose reader is already signed in.
- **A new env var must be added to the `environment:` block in
  `docker-compose.yml`, not just `.env`.** Compose enumerates by name; a value
  present only in `.env` never reaches the container, and the feature stays
  silently inert. Give it a default that degrades to *correct* rather than to
  localhost. Verify with `docker exec cipansor-api sh -c 'env | grep ^NAME='`.
  On Azure App Service the same applies to the app settings of each container
  (`docs/deploy-azure.md` → "Settings the CLI insists on").
- Cross-module side effects: emit via `eventBus` (typed `AppEvents`), don't reach
  into other modules' services.
- **Contracts: `@cipansor/shared`.** A user-facing endpoint's request/response
  DTO is a shared Zod type reused by the web client — reuse it, or add it to
  shared when missing (never redeclare per-app). A new endpoint that serves the
  UI ships with its web consumer in the same change (**golden rule #8**); pure
  backend-only endpoints (webhooks, cron, health, push, internal orchestrators)
  are exempt.

## Prisma 7 specifics

- The client connects through the **`@prisma/adapter-pg` driver adapter** in
  `src/lib/prisma.ts`; the connection URL lives in `prisma/prisma.config.ts`, not
  in `schema.prisma`. Standalone scripts use `prisma/client.ts`'s
  `createPrismaClient()`.
- `Decimal` is imported from `@prisma/client/runtime/client` (not `/runtime/library`).
- Import DB enums and `Prisma` namespace from `@prisma/client`.
- Always add the matching `include`/`select` for any relation/field you access on
  a query result, or TypeScript will (correctly) reject the access.

## Auth & roles

- `req.user` (`JwtPayload`) carries `roleCode`, `permissions[]`, `unitId`, and a
  deprecated `role` string. Gate routes on `RoleCode`/permissions.
- 2FA uses **otplib 13's functional API**: `generateSecret()`, `generateURI()`,
  `await verify({ token, secret })` → `{ valid }`.
- Privilege-escalation guards (e.g. unit admins cannot mint governance roles)
  live in `modules/auth/auth.service.ts`; keep them and cover with tests.

## Testing

- **Mandatory (golden rule #7):** every new/changed **service or controller**
  ships with vitest tests in the module's `tests/`, in the **same commit**. New
  business logic and every branch of an endpoint get a covering test; a bug fix
  gets a regression test that fails before the fix. Barrels, type-only files, and
  pure Zod `schema.ts` are exempt (they're exercised via the service/route).
- `vitest run`. Unit tests mock Prisma. **A module's tests go in its `tests/`**
  (`src/modules/<name>/tests/`) — the layout every module under `src/modules/`
  uses, so a folder of `service.ts` + `service.test.ts` pairs does not sprawl.
  **Jobs are not modules and are not covered by that rule:** a job is a single
  file in `src/jobs/` with no module folder to hold a `tests/` directory, so its
  test sits beside it as `<name>.job.test.ts` (all eleven do). The same holds for
  any other single-file helper outside `src/modules/` — `src/utils/<name>.test.ts`,
  `src/middleware/<name>.test.ts`. What is being retired is the *module* layout
  `apps/api/tests/unit/modules/<name>/` and a `*.test.ts` sitting beside a
  **module's** source (`src/modules/<name>/service.test.ts`); those move to
  `tests/` when their module is next touched. Don't add to them.
- Test setup: `tests/setup.ts`. Keep services pure enough to unit-test.
- Cover the RBAC/privilege-escalation guards (e.g. `auth.service.ts`) explicitly —
  both the allowed and the forbidden path.

## Build

- `pnpm build` uses `tsconfig.build.json` (lenient). `pnpm build:strict` uses the
  full strict config and is the real quality target. NOTE: `strictNullChecks:false`
  in the lenient config degrades Zod inference (makes all fields optional); prefer
  fixing toward the strict build over relaxing further.
