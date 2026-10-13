#!/bin/sh
# Container entrypoint for the API image.
#
# MIGRATE_ON_START=true applies pending Prisma migrations before the API starts.
# It exists for Azure, where the database is on a private network that CI cannot
# reach, so migrations run from inside the container instead. `migrate deploy`
# only applies committed migration files, never generates or resets anything,
# and takes an advisory lock, so a second starting container waits rather than
# racing. If it fails the container exits here and the API never starts against a
# half-migrated schema.
#
# Unset (docker compose on the VM) it is skipped, and releases keep running
# migrations by hand as the deploy runbook describes. The same holds for
# PERSISTENT_DIR below.
set -e

# PERSISTENT_DIR (Azure App Service): the api writes files to public/uploads,
# private/identity and private/attendance under its working directory. On the VM those are docker
# volumes. On App Service the only storage that survives a restart and reaches a
# sidecar container is the app's /home (Azure Files mounts reach the main
# container only), so both directories become links into $PERSISTENT_DIR. A
# directory that already holds files is never replaced: that would hide them.
if [ -n "${PERSISTENT_DIR:-}" ]; then
  for d in public/uploads private/identity private/attendance; do
    mkdir -p "$PERSISTENT_DIR/$d"
    if [ ! -L "$d" ]; then
      if [ -n "$(ls -A "$d" 2>/dev/null)" ]; then
        echo "[entrypoint] $d already holds files; refusing to replace it with a link to $PERSISTENT_DIR/$d" >&2
        exit 1
      fi
      rmdir "$d" 2>/dev/null || true
      ln -s "$PERSISTENT_DIR/$d" "$d"
    fi
  done
  chmod 700 "$PERSISTENT_DIR/private" "$PERSISTENT_DIR/private/identity" "$PERSISTENT_DIR/private/attendance" 2>/dev/null || true
  echo "[entrypoint] PERSISTENT_DIR=$PERSISTENT_DIR: public/uploads, private/identity and private/attendance live there"
fi

if [ "${MIGRATE_ON_START:-false}" = "true" ]; then
  echo "[entrypoint] MIGRATE_ON_START=true: prisma migrate deploy"
  # CHECKPOINT_DISABLE: no usage ping or update check to prisma.io on each start.
  CHECKPOINT_DISABLE=1 node_modules/.bin/prisma migrate deploy --config prisma/prisma.config.ts
fi

exec node dist/main.js
