# AGENTS.md — Cipansor IMS

Canonical guidance for AI agents and developers working in this repository. This
is the single source of truth; `CLAUDE.md` points here. Keep it in sync with
`README.md`.

## What this is

Cipansor is an Information Management System for Yayasan Pesantren Cipansor
(TK Qur'an, SD IT, SMP IT, SMA Qur'an + tahfidz). It is a **pnpm + Turborepo
monorepo**:

| Workspace | Stack | Purpose |
|-----------|-------|---------|
| `apps/api` | Express 5, Prisma 7 (PostgreSQL), Zod, Redis (ioredis), JWT | REST API + scheduled jobs |
| `apps/web` | Next.js 16 (App Router), React 19, React Query, Tailwind, Radix UI | Web client |
| `packages/shared` (`@cipansor/shared`) | TypeScript, Zod | Shared DTO types & schemas for both apps |

## Golden rules

1. **Never clobber `apps/api/prisma/schema.prisma`.** It is very large —
   ~10,000 lines, hundreds of models and enums. (Exact counts drift; don't
   hard-code them here.) It was once accidentally truncated to a stub, which
   broke the entire backend. Edit surgically; run `pnpm --filter api db:generate`
   after changes. A committed PreToolUse hook (`.claude/hooks/guard.sh`) blocks a
   full-file Write to this path.
2. **Prisma is the source of truth for DB enums and models.** Import DB enums
   (`RoleCode`, `VisitStatus`, `LeaveStatus`, …) from `@prisma/client`, not from
   `@cipansor/shared`. `@cipansor/shared` holds API/DTO contracts only. (Rule 3
   applies to the specific choice of role enum.)
3. **Use `RoleCode`, not the legacy `UserRole`.** `req.user.role` is a roleCode
   string. New auth checks use `RoleCode.*` / permissions; the legacy `UserRole`
   enum is deprecated and being removed.
4. **Validate at the edge with Zod, return via the response helper.** Routes →
   thin controller (`asyncHandler`, `ApiResponse`) → service (business logic +
   Prisma) → `schema.ts` (Zod). Routes never touch Prisma directly; controllers
   never embed business logic.
5. **Prove it locally before pushing.** Run the gate below; do not rely on CI to
   discover failures. CI is a backstop only. A change with **no code** in it
   (`*.md`, `docs/`, `.claude/` …, defined once in
   `.github/scripts/change-scope.sh`) skips Lint, Build, Tests, Security, E2E
   and the staging rebuild; skipped jobs report success. E2E also skips a
   **draft** PR until it is marked ready. **A file a test reads is code:** add
   it to the first branch of `is_code()` (a guard test enforces this for
   markdown). Staging deploys only after CI **and** E2E pass on `main`.
   **Format before pushing** (`pnpm format`): every `.ts`/`.tsx` is kept in
   Prettier's format, CI's Lint job fails otherwise, and for Claude a
   pre-push hook refuses the push and names the files and the fix command.
6. **Develop on the feature branch, commit with clear messages, never push to
   `main`.**
7. **Ship tests with the code — no behavior change merges untested.** Every
   new/changed API **service or controller** ships with vitest tests in the
   module's `tests/`; every new/changed **web route or user flow** ships with
   Playwright e2e coverage in `apps/web/e2e/`. A bug fix ships with a test that
   fails before the fix and passes after. Exempt: barrels (`index.ts`),
   type-only files, and pure Zod `schema.ts` (cover them through the
   service/route that uses them). "Done" means the code **and** its tests are in
   the same commit and the full local gate — including e2e — is green.
8. **Ship features wired end-to-end — no orphaned API, no mocked UI.** A change
   is not done until both sides are connected:
   - **New/changed API endpoint that serves a user-facing capability** ships in
     the same change with its web consumer — a React Query hook in
     `apps/web/src/hooks/*` plus the page/component that uses it — not a
     stubbed endpoint waiting for a UI.
   - **New/changed web feature that needs data** is backed by a real endpoint;
     never hardcode mock/placeholder data (see `apps/web/AGENTS.md`). If the
     endpoint is missing, add it to the relevant API module in the same change.
   - **Contracts live once, in `@cipansor/shared`.** Reuse the existing DTO/Zod
     type there; only when it genuinely doesn't exist do you add a new one to
     shared (never redeclare it or fall back to `any` in either app). Backend
     validates with it at the edge; the web imports the same type.
   - **Exempt** (backend-only by nature, no UI required): webhooks and
     third-party callbacks, cron/scheduler jobs, health/readiness probes,
     internal integration-orchestrator calls, and PWA/push endpoints; and on the
     web side, purely presentational/static pages with no data needs. When you
     take an exemption, it should be obvious why from the code — otherwise wire
     the other side.
9. **Two open PRs that touch the same ground: merge them together in a worktree
   and run the gate before you merge the second one.** Each PR's CI only ever
   sees its own base, so a pair that is individually green can still redden
   `main`. Measured on 2026-09-21: #504 (removed the System Secrets module) and
   #505 (decommissioned Perguruan Tinggi/Litbang) were both fully green, and
   merging them together failed 3 of 2,346 API tests — #505's guard pinned the
   very files #504 deleted. `git worktree add --detach <dir> origin/main`, merge
   both heads into it, run the gate there; it costs one gate run and it is the
   only thing that catches this class.
10. **Every UI change ships before/after screenshots**, one pair per affected
    surface, taken from the real components — "before" rendered from `main`,
    not remembered. Put them where the reviewer sees them (the PR body, or a
    shared page linked from it). The `screenshot-roles` skill has the rigs
    (`before-after.md`). Walking each screen for its screenshot is also what
    finds the defects a diff hides.
11. **Say "done" only when someone can click it — and say how far it went.**
    Every report of a UI change gives the **menu path** to reach it (e.g.
    *Perencanaan & Kinerja → Perjanjian Kinerja → Tambah*) and its state:
    **on a branch**, **merged to `main`**, **on staging**, or **in
    production**. A page on an unmerged branch is not "built" to the person
    looking for it in the app.
12. **A decision that is the user's: research first, then offer choices.**
    Before asking, look up how the matter is settled in practice —
    regulation, the pesantren's and schools' own practice, established
    standards — and cite the sources. Question the premise too: include
    "not needed at all" or "let the system do it" when that is a real
    option. Then give the user a multiple-choice question, recommended
    option first with the reason, never an open question and never a
    decision taken on their behalf (Claude: the `AskUserQuestion` window).
    Research already recorded in `.claude/memory/decisions/` is not
    repeated. The user asked for this twice (2026-09-27).

## Commands

```bash
pnpm install                          # bootstrap workspace
pnpm --filter api db:generate         # generate Prisma client (after schema edits)
pnpm --filter @cipansor/shared build  # build shared package (consumed by both apps)

# Local stack (Postgres + Redis) for running/testing end-to-end
docker compose up -d db redis         # the db and redis services of docker-compose.yml
pnpm --filter api db:push             # apply schema to the dev DB
ALLOW_DESTRUCTIVE_SEED=1 E2E_FIXED_2FA=1 pnpm --filter api db:seed  # WIPES every table, then demo data

pnpm dev                              # turbo: run api + web in watch mode

# Quality gate — ALL must pass locally before committing/pushing
pnpm --filter api build               # tsc (build config)
pnpm --filter api build:strict        # tsc (full strict — the real target)
pnpm --filter api test                # vitest (API)
pnpm --filter web build               # next build
pnpm --filter web test                # vitest (web)
pnpm --filter web test:e2e            # Playwright e2e (needs the local stack up)
pnpm format                           # prettier --write every .ts/.tsx (not .md); CI fails on `pnpm format:check`
pnpm lint                             # eslint (api + web)
```

## Architecture standard (API module)

The module layout, file naming (`<name>.routes.ts`, `<name>.controller.ts`,
`<name>.service.ts`, `<name>.schema.ts`, `index.ts`, `tests/`) and the shared
primitives to reuse are in [`apps/api/AGENTS.md`](apps/api/AGENTS.md) — one
home, because a second copy here said `routes.ts` for years while every module
used `<name>.routes.ts`. The rules that hold across the codebase:

- **Layering:** routes → thin controller → service (the only layer that touches
  Prisma) → Zod schema. Measured 2026-09-25, 22 of 93 modules follow it fully
  and 12 call Prisma from a route or controller (`known-issues.md`); new and
  touched code follows it.
- **Modules talk through the typed `eventBus`** (`src/lib/event-bus.ts`, add the
  event to `AppEvents`) or through another module's `index.ts` — never by
  importing its service file.
- **One concept, one module.** Before adding a module, a model or a page, look
  for the existing one (`.claude/memory/decisions/istilah-dan-penamaan.md` has
  the target names). Five modules over the tahfidz tables and five places for
  report cards are what this rule exists to stop.

## Naming and API conventions

Decided 2026-07-21 and 2026-09-25 — the reasons, the glossary and the target
name of every module are in
[`decisions/istilah-dan-penamaan.md`](.claude/memory/decisions/istilah-dan-penamaan.md).

- **Language.** URL paths, API paths and identifiers are **English** for general
  concepts; **pesantren and regulatory terms are never translated** (`tahfidz`,
  `takhosus`, `muhadhoroh`, `spmb`, `emis`, `dapodik`); **every label a person
  reads is Indonesian**. Learners are *santri* on every portal screen (decided
  2026-09-27); *murid* / *peserta didik* only in formats the state defines
  (rapor, SPMB, Dapodik/EMIS exports); the code says `student`.
- **Names say what the thing is**, never its history: no `-enhancement`,
  `-v2`, `new-`, `unified-`. A module is named after its content
  (`practicum` holding Amaliyah Tadris is the example not to repeat).
- **Resources:** plural, kebab-case nouns (`/permits`, `/report-cards`).
  Partial update is `PATCH /{id}`; a state change is `POST /{id}/{verb}`
  (`/permits/{id}/approve`); an aggregate is `GET …/summary`; the caller's own
  data is under `/me`. Register static routes before parameter routes —
  `apps/api/src/utils/route-shadowing.guard.test.ts` fails otherwise.
- **The web calls only routes the API serves.** Every call goes through a hook
  in `apps/web/src/hooks/*` with a path the router answers; a string typed on
  one side and imagined on the other is how 212 calls came to point at nothing
  (measured 2026-09-25). `apps/api/src/utils/web-api-contract.guard.test.ts`
  checks every call against the real router and fails on a new broken one; its
  baseline of the old ones only shrinks.
- **Versions:** the API moves under `/api/v1` (phase 4 of the audit plan in
  `roadmap.md`); a breaking change after the first external client ships gets
  a new major version, never an in-place break.
- **Renames** move the table with the model (a migration, replayed on a copy of
  production first) and give every changed **web** path a permanent 308. Paths
  printed on paper (`/public/verify-card`, `/verifikasi`) never change.

## Web standard

- Data layer: Axios instance in `src/lib/api.ts` (+ `lib/api-error.ts`), consumed
  through React Query hooks in `src/hooks/*` — not from pages, not from the
  legacy `src/services/*` or the `lib/api-client.ts` alias (both are being
  removed). **No mock/placeholder data in pages** — wire to the API.
- Share request/response types from `@cipansor/shared`; don't redefine `any`.
- Route protection / nav visibility must reflect real `RoleCode` + permissions.
- **Language:** the portal is **Indonesian only**. The public site
  (`cipansor.or.id`) is **Indonesian, English and Arabic** on every page,
  switchable, Arabic right-to-left; `config/i18n-coverage.test.ts` fails when a
  string exists in one language only.
- New pages: `…/new` for create, `…/[id]/edit` for edit.

## Per-area guides

See nested `AGENTS.md` files: `apps/api/AGENTS.md`, `apps/web/AGENTS.md`,
`packages/shared/AGENTS.md`, `apps/api/prisma/AGENTS.md`. The nearest one to the
file you are changing applies on top of this one.

## Where things live

Every agent (Claude, OpenHands, Jules, Copilot) loads this file; Claude also
loads `.claude/memory/INDEX.md`. Each kind of knowledge has exactly one home —
two copies drift, and a stale one actively misleads.

| Kind | Home | Changes |
|---|---|---|
| Rules every change follows: architecture, build/test/deploy, style, guardrails | this file + the nested `AGENTS.md` | rarely, by PR |
| Procedures and domain knowledge, loaded when relevant ([index](#skills)) | `.claude/skills/<name>/SKILL.md` | when a standard or a rule changes, by PR |
| Enforcement | CI and the `main` ruleset (every agent); `.claude/hooks/` (Claude only) | rarely, by PR |
| Project memory: progress, backlog, known issues (`.claude/memory/*.md`); decisions not yet in a skill (`decisions/`); traps that cost time (`lessons/`) — indexed in `INDEX.md` | `.claude/memory/` | as work happens, by PR |
| Documentation for people: architecture, deployment, setup, user manuals | `docs/` | with the code it describes |
| Anything **sensitive**, personal, or specific to one machine | the machine-local memory (`~/.claude/projects/…/memory/`), never the repo | — |

**Sensitive** means what an attacker could use: credentials and their status,
keys, tokens, connection strings, cloud resource names and ids (vault, storage,
database server), IP addresses, host paths, a weakness still open in
production, incident details, personal data. The repository is **public until
release** and git history keeps everything. `.github/scripts/check-sensitive.py`
rejects the mechanical cases — Claude's `guard.sh` before the write, the
Security CI job on every PR — and the judgement cases are on whoever writes the
note. Until the repository is private, moving a machine-local memory into
`.claude/memory/` needs the user's approval, file by file; once it is private,
the two are merged.

**Lifecycle.** Add a skill when the same procedure or domain knowledge is needed
a second time; a hook when a written rule was broken anyway; a memory when a
future session would otherwise repeat the work or the mistake. Update in place
— one subject, one file. Delete what guards a flow that no longer exists, after
proving it unused (grep for callers, check `.claude/settings.json`), and say why
in the PR body, because what is gone is invisible on screen. The `sync-records`
skill is the pass that moves findings out of a session and into the right home.

Standing permission from the user (2026-07-24, widened 2026-09-05) covers
adding, changing and deleting anything in `.claude/`, `AGENTS.md`, `CLAUDE.md`
and the per-area guides — always on a branch and through a PR, never straight
to `main`.

### Skills

Claude loads a skill by its description; any other agent opens the file when
its "use when" matches the task.

| Skill | Use when |
|---|---|
| [`gate`](.claude/skills/gate/SKILL.md) | before every push: the full local quality gate |
| [`stack`](.claude/skills/stack/SKILL.md) | the app must run locally: Postgres + Redis + API + web |
| [`screenshot-roles`](.claude/skills/screenshot-roles/SKILL.md) | before/after screenshots, per-role visual QA |
| [`sync-records`](.claude/skills/sync-records/SKILL.md) | end of a work session or before compaction: update memory, roadmap, guides |
| [`panduan-peran`](.claude/skills/panduan-peran/SKILL.md) | who a role is, the menu it sees (printed from code), the menu path a report gives, "can role X do Y", user manuals for staff |
| [`tata-kelola-yayasan`](.claude/skills/tata-kelola-yayasan/SKILL.md) | yayasan organs, the RPJP → Renstra → RKA chain and its ratification, PK and atasan penilai |
| [`naskah-dinas`](.claude/skills/naskah-dinas/SKILL.md) | E-Office letters, TTE keys and identity, the signed PDF, verification by upload, revocation |
| [`dokumen-aplikasi-cipansor`](.claude/skills/dokumen-aplikasi-cipansor/SKILL.md) | technical document (arc42 + C4) or user manual (Diátaxis, per role) for this app — handover, grant/donor/auditor pack, staff training |

The Claude Code hooks, what each one enforces, and why each works the way it
does are in [`.claude/README.md`](./.claude/README.md). Read it before touching
a hook: most of these designs replaced an earlier one that looked right and did
nothing.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": false` in the root `turbo.json` or `turbo.jsonc` to opt out; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
