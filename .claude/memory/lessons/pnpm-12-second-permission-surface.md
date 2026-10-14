# pnpm-12-second-permission-surface

> `allowBuilds` reads as the whole supply-chain answer on pnpm 12; it governs only install scripts. A dependency's **agent skills** are a second, separate permission surface — and "awaiting approval" forever is not a decision.

pnpm 10 made dependency **build scripts** opt-in; pnpm 11 renamed the key to
`allowBuilds` (a name→boolean map). pnpm 12 adds a surface beside it: a
dependency that ships `skills/<name>/SKILL.md` has it linked into the project's
agent-skill directory (`.claude/skills`, and `.agents/skills` is a symlink to
it) — **after approval**, not at install. `allowBuilds` does not govern it.

`pnpm install` prints `Agent skills awaiting approval: <pkg>` and
`pnpm permissions list` shows it under `Awaiting approval`. Leaving it there is
the same half-covered shape `onlyBuiltDependencies` had: the file *looks* like
it decides everything while one surface has no decision at all — and on a repo
that is public until release it drops third-party content into the tree every
agent reads.

## Where the decision lives

A `permissions` map in `pnpm-workspace.yaml`, next to `allowBuilds`:

```yaml
permissions:
  '@tanstack/react-table':
    skills: false   # true grants, false denies
```

`pnpm permissions list` then reports `Denied: … skills` and no symlink is
created. (First seen 2026-10-13, PR #815: `@tanstack/react-table@9.2.8`, a
direct `apps/web` dependency, ships three skills. pnpm offers carriers of
**direct** dependencies for approval; a carrier that is only transitive does
not surface this way — verify with `find node_modules -name SKILL.md`.)

## The guard, and its two halves

`apps/api/src/utils/pnpm-supply-chain.guard.test.ts`:

- **Static** — `permissions` must exist and every entry's `skills` must be a
  boolean. Catches a missing or malformed decision.
- **Dynamic** — run `pnpm permissions list` (via `npm_execpath`, CWD = repo
  root) and fail if the output matches `Awaiting approval`. This is the half
  that catches a **new** carrier: no static read of the config can know a
  dependency started shipping skills. It reads the config (no install, no
  network) so it runs with no `node_modules`; when pnpm is not resolvable
  (a bare `vitest run`, where `npm_execpath` is node) it falls back to the
  static check rather than passing silently.

## Not this trap

- `allowSkills` is pnpm's **internal** resolved-state key
  (`node_modules/.pnpm-workspace-state-v1.json`), not a workspace setting —
  writing it into `pnpm-workspace.yaml` is ignored with a warning.
- `permissions: { "*": { skills: false } }` is not a wildcard; `*` is a
  literal package name.
