# AGENTS.md — packages/shared (`@cipansor/shared`)

Shared TypeScript types and Zod schemas consumed by **both** `apps/api` and
`apps/web`. Read the root `AGENTS.md` first.

## Purpose & boundaries

- This package is the **single source of truth for API/DTO contracts** (request
  and response shapes) and reusable Zod schemas.
- It is **not** the source of truth for database enums/models — those come from
  `@prisma/client`. Do not duplicate Prisma enums here for server-side DB
  operations. If a DTO needs an enum that mirrors a DB enum, keep the values in
  exact sync (mismatches caused real bugs — see `.claude/memory/known-issues.md`,
  reception module).
- **No app-specific imports.** No Express, no Prisma, no Next, no React. Pure
  types + Zod only, so both runtimes can consume it.

## Structure

```
src/
  index.ts            # barrel — every public type/schema is re-exported here
  types/*.ts          # domain DTO interfaces (auth, finance, assessment, ...)
  schemas/*.ts        # Zod schemas (+ inferred types via z.infer)
  roles.ts            # how role codes are GROUPED (admin, teacher-level, staff, ...);
                      #   the RoleCode enum itself is Prisma's
  public-site.ts      # the public site's verifiable facts, also read by the chatbot
  password-policy.ts  # the password rules a form can check as you type
```

Rules:
- Add new public types/schemas to `src/index.ts` so consumers import from
  `@cipansor/shared` (not deep paths).
- Keep names aligned with the API contract the controllers actually return.
- Build with `pnpm --filter @cipansor/shared build` (emits `dist/`) before the
  apps consume changes; the apps alias to `src` in tests but use `dist` at build.

## When changing a contract

Changing a shared type ripples into both apps. After editing:
1. `pnpm --filter @cipansor/shared build`
2. Re-run `apps/api` and `apps/web` builds/tests to catch breakage on both sides.
