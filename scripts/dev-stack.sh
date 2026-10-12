#!/usr/bin/env bash
# Bring up a local Postgres + Redis stack for tests/e2e WITHOUT Docker.
# Idempotent: safe to re-run. Postgres binaries refuse to run as root, so the
# cluster is owned by an unprivileged 'pgrunner' user.
set -euo pipefail

# The newest server installed: the version follows the image's distro (Debian
# 13 ships 17, not 16), so it is found, not assumed. PGBIN overrides it.
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}
if [ ! -x "$PGBIN/initdb" ]; then
  echo "dev-stack: no PostgreSQL server under /usr/lib/postgresql/*/bin; install one or set PGBIN" >&2
  exit 1
fi
PGDATA=/tmp/pgdata
PGSOCK=/tmp/pgsock
PGPORT=5432
REDIS_PORT=6379

id pgrunner >/dev/null 2>&1 || useradd -m pgrunner

mkdir -p "$PGSOCK"
chown -R pgrunner:pgrunner "$PGSOCK"

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  rm -rf "$PGDATA"; mkdir -p "$PGDATA"; chown -R pgrunner:pgrunner "$PGDATA"
  su pgrunner -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust" >/tmp/initdb.log 2>&1
fi

if ! su pgrunner -c "$PGBIN/pg_isready -h 127.0.0.1 -p $PGPORT" >/dev/null 2>&1; then
  chown -R pgrunner:pgrunner "$PGDATA"
  su pgrunner -c "$PGBIN/pg_ctl -D $PGDATA -o '-p $PGPORT -k $PGSOCK -c listen_addresses=127.0.0.1' -l /tmp/pg.log start"
  sleep 3
fi

su pgrunner -c "$PGBIN/psql -h 127.0.0.1 -p $PGPORT -U postgres -tc \"SELECT 1 FROM pg_database WHERE datname='cipansor'\" | grep -q 1" \
  || su pgrunner -c "$PGBIN/psql -h 127.0.0.1 -p $PGPORT -U postgres -c 'CREATE DATABASE cipansor;'"
su pgrunner -c "$PGBIN/psql -h 127.0.0.1 -p $PGPORT -U postgres -tc \"SELECT 1 FROM pg_database WHERE datname='cipansor_shadow'\" | grep -q 1" \
  || su pgrunner -c "$PGBIN/psql -h 127.0.0.1 -p $PGPORT -U postgres -c 'CREATE DATABASE cipansor_shadow;'"

redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1 || redis-server --daemonize yes --port "$REDIS_PORT" --dir /tmp
sleep 1
echo "Postgres: $(su pgrunner -c "$PGBIN/pg_isready -h 127.0.0.1 -p $PGPORT")"
echo "Redis: $(redis-cli -p $REDIS_PORT ping)"
