#!/usr/bin/env bash
# Bring the full local stack up for e2e: Postgres + Redis + seeded DB + API + web.
# Idempotent and safe to re-run after a container recycle.
set -uo pipefail
ROOT=/home/user/cipansor
cd "$ROOT"

bash scripts/dev-stack.sh >/tmp/devstack.log 2>&1
# The same server dev-stack.sh found (see there).
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}

# .env (gitignored; recreated on fresh containers)
if [ ! -f apps/api/.env ]; then
cat > apps/api/.env <<'EOF'
NODE_ENV=development
PORT=3001
DATABASE_URL="postgresql://postgres@127.0.0.1:5432/cipansor?schema=public"
SHADOW_DATABASE_URL="postgresql://postgres@127.0.0.1:5432/cipansor_shadow?schema=public"
REDIS_URL="redis://127.0.0.1:6379"
JWT_SECRET="local-test-secret-key-for-verification-only"
# Production default is 15m; local dev/e2e pins 7d so cached e2e sessions
# (reused across runs by global-setup) don't expire mid-iteration.
JWT_EXPIRES_IN=7d
JWT_REFRESH_EXPIRES_IN=30d
CORS_ORIGIN=http://localhost:3000
LOG_LEVEL=error
EOF
fi

set -a; . apps/api/.env; set +a
export E2E_FIXED_2FA=1 TWO_FACTOR_RATE_LIMIT_MAX=100000 LOG_LEVEL=error

USERS=$(su pgrunner -c "$PGBIN/psql -h 127.0.0.1 -U postgres -d cipansor -tc 'SELECT count(*) FROM users;'" 2>/dev/null | tr -d ' ')
if ! [ "${USERS:-0}" -gt 0 ] 2>/dev/null; then
  echo "Seeding DB..."
  (cd apps/api && pnpm db:generate && pnpm db:push && E2E_FIXED_2FA=1 ALLOW_DESTRUCTIVE_SEED=1 pnpm db:seed) >/tmp/seed.log 2>&1 \
    && echo "seeded" || { echo "SEED FAILED"; tail -5 /tmp/seed.log; }
else
  (cd apps/api && pnpm db:generate >/tmp/gen.log 2>&1) || true
  echo "DB already has $USERS users"
fi

# Build web if missing
if [ ! -f apps/web/.next/BUILD_ID ]; then
  echo "Building web..."
  (cd apps/web && NEXT_PUBLIC_API_URL=http://localhost:3001 pnpm build) >/tmp/webbuild.log 2>&1 \
    && echo "web built" || { echo "WEB BUILD FAILED"; tail -8 /tmp/webbuild.log; }
fi

# Start API if not up
if ! curl -s -m 3 http://127.0.0.1:3001/health >/dev/null 2>&1; then
  (cd apps/api && nohup pnpm exec tsx src/main.ts >/tmp/api.log 2>&1 &)
  for i in $(seq 1 30); do curl -s -m 3 http://127.0.0.1:3001/health >/dev/null 2>&1 && break; sleep 2; done
fi
curl -s -m 3 http://127.0.0.1:3001/health >/dev/null 2>&1 && echo "API UP" || echo "API DOWN"

# Start web (prod) if not up
if ! curl -s -m 5 -o /dev/null http://127.0.0.1:3000/login 2>/dev/null; then
  (cd apps/web && nohup env PORT=3000 pnpm start >/tmp/web.log 2>&1 &)
  for i in $(seq 1 40); do curl -s -m 5 -o /dev/null http://127.0.0.1:3000/login 2>/dev/null && break; sleep 2; done
fi
curl -s -m 5 -o /dev/null http://127.0.0.1:3000/login 2>/dev/null && echo "WEB UP" || echo "WEB DOWN"
