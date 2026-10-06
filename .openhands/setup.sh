#!/usr/bin/env bash
# Cipansor IMS — OpenHands repository setup.
#
# OpenHands runs this file at the start of every conversation on this repo
# (docs.openhands.dev → Usage → Customization → Repository → "Setup Script"),
# so a fresh sandbox is ready to build, test and e2e without manual installs.
# It is idempotent: re-running on a warm sandbox is cheap.
#
# It deliberately does NOT seed the database or start the stack. Seeding
# TRUNCATEs every table (root AGENTS.md; apps/api/prisma/AGENTS.md), and
# bringing the stack up is the `stack` skill's job — do that when you need the
# app or a browser sweep running.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROOT="${OPENHANDS_PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$ROOT" || exit 1

log()  { printf '\n=== [cipansor setup] %s ===\n' "$*"; }
warn() { printf '!!! [cipansor setup] %s\n' "$*" >&2; }

# --- toolchain -------------------------------------------------------------
# pnpm 9.15.9 is pinned by package.json "packageManager"; corepack activates
# exactly that version. Node >= 20 (CI pins 22).
log "toolchain"
command -v node >/dev/null 2>&1 && echo "node $(node --version)" || warn "node not found (need >= 20)"
if ! command -v pnpm >/dev/null 2>&1; then
  command -v corepack >/dev/null 2>&1 && \
    { corepack enable pnpm >/dev/null 2>&1 || sudo -n corepack enable pnpm >/dev/null 2>&1; } || true
  hash -r
fi
if ! command -v pnpm >/dev/null 2>&1; then
  COREPACK_ENABLE_STRICT=0 corepack prepare pnpm@9.15.9 --activate >/dev/null 2>&1 || true
  hash -r
fi
if ! command -v pnpm >/dev/null 2>&1; then
  warn "pnpm unavailable — install Node >= 20 + corepack, then re-run. Skipping the rest."
  exit 0
fi
echo "pnpm $(pnpm --version)"

# --- node dependencies -----------------------------------------------------
log "pnpm install"
# --frozen-lockfile only. A failed frozen install used to fall back to a bare
# `pnpm install`, which can silently rewrite pnpm-lock.yaml; a routine session
# start must never leave unrelated dependency changes in the worktree. Warn
# instead and let the caller fix the lockfile on purpose.
if ! pnpm install --frozen-lockfile; then
  warn "pnpm install --frozen-lockfile failed — the lockfile is out of sync with package.json. Fix it on a branch (pnpm install, review pnpm-lock.yaml), then re-run; leaving the worktree untouched."
fi

log "build @cipansor/shared"
# Both apps consume dist/ at build time (packages/shared/AGENTS.md).
pnpm --filter @cipansor/shared build || warn "shared build failed"

log "prisma generate"
pnpm --filter api db:generate || warn "prisma generate failed"

# --- playwright browsers ---------------------------------------------------
# Install every engine the e2e projects use (apps/web/playwright.config.ts:
# chromium, firefox, webkit, mobile-chrome, mobile-safari) with their OS
# dependencies. Chromium alone is not enough — a full `pnpm --filter web
# test:e2e` launches Firefox and WebKit too, and fails without them. The image
# tag Playwright downloads must match `@playwright/test` in apps/web/package.json.
log "playwright browsers (chromium, firefox, webkit)"
pnpm --filter web exec playwright install --with-deps chromium firefox webkit \
  || pnpm --filter web exec playwright install chromium firefox webkit \
  || warn "playwright install failed — run it by hand before e2e"

# --- Postgres + Redis (e2e / stack) ---------------------------------------
# The gate's e2e step needs a real Postgres + Redis. With a Docker daemon that
# is `docker compose up -d db redis`; without one (managed/remote sandboxes) the
# packages are installed here and the `stack` skill starts a cluster.
log "Postgres + Redis"
if docker info >/dev/null 2>&1; then
  echo "docker daemon present — start the stack with: docker compose up -d db redis"
elif command -v psql >/dev/null 2>&1 && command -v redis-server >/dev/null 2>&1; then
  echo "postgres + redis already installed"
else
  export DEBIAN_FRONTEND=noninteractive
  if sudo -n true 2>/dev/null; then
    (sudo -n apt-get update -qq && sudo -n apt-get install -y -qq postgresql postgresql-client redis-server) \
      || warn "could not install postgres/redis — use the 'stack' skill's fallback by hand"
  else
    warn "no passwordless sudo — install postgres/redis manually (see the 'stack' skill)"
  fi
fi

# --- repo scripts ----------------------------------------------------------
# OpenHands runs a hook's `command` through a shell, so the hook scripts (and
# setup.sh itself) must be executable. They are committed that way; this only
# repairs a checkout that lost the bit.
chmod +x .openhands/hooks/*.sh .openhands/setup.sh 2>/dev/null || true

log "done — next: create apps/api/.env, bring the stack up, then seed (see the 'stack' skill)"
echo "  apps/api/.env is gitignored and recreated per sandbox; copy keys from .env.example"
