---
name: stack
description: Bring up the Cipansor local stack (PostgreSQL + seeded database + API on :3001 + web on :3000) so e2e tests and the per-role screenshot sweep can run. Use when asked to "start the stack", "run the app locally", or before running e2e / screenshot-roles.
---

# Local stack

## Preferred: Docker

If a Docker daemon is available, `docker-compose.yml` defines `db`, `api`, and
`web`. Bring up the database, apply the schema, seed, then run the apps:

```bash
docker compose up -d db
pnpm --filter api db:generate
pnpm --filter api db:push
pnpm --filter api db:seed
pnpm --filter api dev &   # API on :3001
pnpm --filter web dev &   # web on :3000
```

## Fallback: no Docker daemon (managed/remote sessions)

Install and run PostgreSQL directly, then point the API at it. This is the path
that works in the web/remote sandboxes where the Docker socket is absent.

```bash
apt-get install -y postgresql          # version follows the distro (Debian 13 → 17)
PGBIN="$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)"
pg_ctlcluster "$(basename "$(dirname "$PGBIN")")" main start   # or run the cluster as an unprivileged owner; see below
su postgres -c "psql -c \"ALTER USER postgres PASSWORD 'postgres';\""
su postgres -c "createdb cipansor"

# apps/api/.env (gitignored) — password must be IN the URL; Prisma ignores PGPASSWORD:
#   DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/cipansor?schema=public"
pnpm --filter api db:generate
pnpm --filter api db:push
ALLOW_DESTRUCTIVE_SEED=1 E2E_FIXED_2FA=1 pnpm --filter api db:seed   # wipes, then one DEMO_ACCOUNT per RoleCode; admins get the fixed TOTP secret

# Build once, then run the built output (more stable than dev under a browser sweep):
pnpm --filter @cipansor/shared build
pnpm --filter api build && pnpm --filter web build
node apps/api/dist/main.js &                        # :3001
( cd apps/web && node_modules/.bin/next start -p 3000 ) &
```

`scripts/dev-stack.sh` hardcodes `/usr/lib/postgresql/16/bin` and fails on an
image without 16 — prefer discovering the version dir as above. When
`su postgres` is unavailable, run the cluster as an unprivileged owner
instead, with two things the old recipe got wrong:

- **Create the socket directory first.** `pg_ctl -k` aborts if the directory
  does not exist; `scripts/dev-stack.sh` makes `/tmp/pgsock` and chowns it to
  the database user before starting, and this path must do the same.
- **Never `--auth=trust`.** A trust cluster on `127.0.0.1` lets any process on
  the box in as `postgres` and alter the database (CWE-306). Set the superuser
  password at `initdb` and authenticate every connection.

```bash
sudo useradd -m pgrunner 2>/dev/null || true
sudo install -d -o pgrunner -g pgrunner /tmp/pgsock
# 0600: a `printf >` under the default 022 umask is world-readable, so another
# local user could copy the password before it is deleted (CWE-732).
( umask 077; printf '%s\n' "${PGPASSWORD:?set PGPASSWORD first}" > /tmp/pgpass.txt )
sudo chown pgrunner /tmp/pgpass.txt
sudo -u pgrunner "$PGBIN/initdb" -D /tmp/pgdata -U postgres -A scram-sha-256 --pwfile=/tmp/pgpass.txt
sudo rm -f /tmp/pgpass.txt
sudo -u pgrunner "$PGBIN/pg_ctl" -D /tmp/pgdata -o "-k /tmp/pgsock -p 5432 -c listen_addresses=127.0.0.1" -l /tmp/pg.log start

# Wait for the listener before touching the database (pg_isready needs no auth):
until sudo -u pgrunner "$PGBIN/pg_isready" -h 127.0.0.1 -p 5432 -U postgres >/dev/null 2>&1; do sleep 1; done
sudo -u pgrunner env PGPASSWORD="$PGPASSWORD" "$PGBIN/createdb" -h 127.0.0.1 -U postgres cipansor
```

Use the same `PGPASSWORD` in the `DATABASE_URL` above; do not commit it if the
box is shared.

On an OpenHands sandbox (no Docker daemon, no preinstalled Postgres), run
`.openhands/setup.sh` first: it installs Postgres and Redis, so only the cluster
start + seed steps below are left. Redis is optional there too.

## Gotchas

- **`bash scripts/dev-up.sh` (one command, Postgres without Docker) builds the web with `NODE_ENV=development`** leaked from
  `apps/api/.env`, and `next build` then fails prerendering (`/_global-error`, `/project`, "Each child in a list…"). Build the web
  yourself: `cd apps/web && env -u NODE_ENV NEXT_PUBLIC_API_URL=http://localhost:3001 pnpm build`, and start it with
  `env -u NODE_ENV PORT=3000 pnpm start`. The script also skips the build when `.next/BUILD_ID` exists, even a half-built one:
  `rm -rf apps/web/.next` first. (2026-09-29)

- **Admin accounts always need 2FA** — `DEMO_MODE` (which waived it) was removed
  2026-09-23. Seed with `E2E_FIXED_2FA=1` so every admin is pre-enrolled with the
  fixed TOTP secret the e2e helper and the screenshot sweep answer; without it,
  admin roles are forced through 2FA *setup* and never return a session.
- **`ALLOW_DESTRUCTIVE_SEED=1`** is required: the seed TRUNCATEs every table
  first and refuses to run without it. Never set it against production.
- Demo credentials: every account is `<...>@cipansor.or.id` / `Cipansor123!`
  (see `packages/shared/src/types/demo-accounts.ts`). The local part carries the
  realm — `yayasan.ketua@`, `smpit.guru@` — since the old `@demo.` domain is gone.
  Do not invent `qa-*` accounts.
- **A full e2e run needs `JWT_EXPIRES_IN=7d` and `JWT_REFRESH_EXPIRES_IN=30d`**
  on the API, as `e2e-tests.yml` sets them. The global setup signs each role in
  once; with the 15-minute default, every test that starts after the first 15
  minutes lands on `/login`, and the run reports a block of unrelated specs as
  failed. Targeted runs shorter than that pass either way, which hides it.
- Redis is optional; the API logs a connection error and runs degraded without it.
- Health check: `curl -sf http://localhost:3001/health` and `http://localhost:3000/login`.
