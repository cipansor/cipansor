# branch-switch-stale-artifacts

> Switching branches (or `git stash`) leaves the generated Prisma client and the built `@cipansor/shared` stale, and the failures that follow look exactly like bugs in your code.

Two generated artifacts live outside git and do not follow a checkout: the
Prisma client (under `node_modules/.pnpm/@prisma+client@*`) and the compiled
`packages/shared/dist`. When a branch adds schema models or shared exports:

- a stale Prisma client makes **enums import as `undefined`**, so
  `status !== SomeEnum.PENDING` is always true and the code takes a branch you
  did not expect (`Cannot read properties of undefined` in tests that should
  pass);
- a stale `shared` makes `tsc` report `has no exported member 'X'` for exports
  that plainly exist.

**`git stash` is a branch switch too.** Before/after screenshots mean stash →
render → pop, and a build run while stashed compiles `shared` from the *other*
state. The "after" render then died with `Cannot read properties of undefined
(reading 'HAND_DELIVERY')` — a new enum missing from `dist`, reading exactly
like a bug in the new code.

**After any checkout or `stash pop`, before trusting a failure:**

```
pnpm --filter @cipansor/shared build
pnpm --filter api db:generate
```

And note the ordering trap: `vitest` can pass while `tsc` fails — tests resolve
`shared` through the source alias, the typecheck through the stale `dist` — so
a green test run is not evidence the artifacts are current.

## Build files owned by another user

Running the toolchain in a container without `-u $(id -u):$(id -g)` writes
root-owned files into the bind-mounted tree, and the next run as yourself dies
on them — `TS5033: Could not write file … EACCES` in `packages/shared/dist`, or
`EACCES` on `apps/web/next-env.d.ts` **after** `✓ Compiled successfully`, which
reads like a type error until the last line. Run containers as your own user,
or chown the paths back from a container.

## Two invocation traps

- `node node_modules/.bin/tsc` runs the **shell wrapper**, not the compiler
  (`SyntaxError: missing ) after argument list`). Since the TypeScript 7 alias
  migration the compiler paths changed: the `typescript` name now points at the
  compatibility package `@typescript/typescript6`, whose only bin is `tsc6`
  (there is no `node_modules/typescript/bin/tsc` any more). The TS 7 compiler
  lives at `node_modules/@typescript/native/bin/tsc`; the TS 6 API compiler at
  `node_modules/typescript/bin/tsc6`. Invoke either with `node <path>`.
- Piping a long build into `| tail -N` leaves a background output file empty
  until the build ends — that is not "still on step 1". Redirect to a log file
  and tail the file.

See [git-three-dot-diff-hides-stale-base](./git-three-dot-diff-hides-stale-base.md)
for the other way a branch lies about its state.
