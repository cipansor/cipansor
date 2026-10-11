# Deployment Guide - Cipansor

Panduan deployment sistem Cipansor untuk production.

> **Azure App Service:** the move off the single VM (sidecar apps, private
> PostgreSQL, releases from GitHub Actions) is described in
> [`deploy-azure.md`](./deploy-azure.md). This guide covers the VM until the cutover.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Docker Deployment](#docker-deployment)
- [Manual Deployment](#manual-deployment)
- [Database Migration](#database-migration)
- [Monitoring & Logging](#monitoring--logging)
- [Security Checklist](#security-checklist)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements

- **Node.js**: v22 (semua image memakai `node:22-alpine`)
- **PostgreSQL**: v14 atau lebih baru
- **pnpm**: 9.15.9 (dipaku lewat `packageManager` di `package.json`; CI memakai `--frozen-lockfile`)
- **Docker** (opsional): v24 atau lebih baru
- **RAM**: Minimum 2GB, recommended 4GB
- **Disk**: Minimum 20GB

### Domain & SSL

- Domain yang sudah terkonfigurasi (contoh: cipansor.or.id)
- SSL certificate (bisa menggunakan Let's Encrypt)

---

## Environment Setup

### 1. Clone Repository

```bash
git clone https://github.com/ypcipansor/cipansor.git
cd cipansor
```

### 2. Setup Environment Variables

```bash
cp .env.example .env
```

Edit `.env` dan sesuaikan:

```env
# Database
DATABASE_URL="postgresql://user:password@host:5432/cipansor"

# JWT - WAJIB DIGANTI UNTUK PRODUCTION!
JWT_SECRET="your-production-secret-minimum-32-characters-long"
JWT_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="30d"

# Server
PORT=3001
NODE_ENV=production

# Frontend
# EMPTY on purpose in production. An empty value makes the API base relative
# ("/api"), so the bundle talks to whichever origin served the page and one
# image serves both hosts, each reaching the API same-origin. This line used to
# read https://api.cipansor.or.id — a host that has never existed, so anyone
# following this guide built a web image that could not reach the API at all.
NEXT_PUBLIC_API_URL=""
# Where the SERVER reaches the API. The verifikasi page is a server component
# rendered inside the web container, where a relative URL resolves against
# nothing. Under compose this is the service name.
API_INTERNAL_URL="http://api:3001"

# CORS
# Both public hosts plus the portal. Same-origin requests do not need these, but
# the apex's public pages call the API on whichever origin the bundle names.
CORS_ORIGIN="https://cipansor.or.id,https://www.cipansor.or.id,https://portal.cipansor.or.id"

# Logging
LOG_LEVEL=info
```

### 3. Install Dependencies

```bash
pnpm install
```

---

## Docker Deployment

### Recommended Method (Docker Compose)

```bash
# Build dan jalankan semua services
docker compose up -d

# Lihat logs
docker compose logs -f

# Stop services
docker compose down
```

### Environment Variables untuk Docker

Buat file `.env` di root directory:

```env
# Database
DB_USER=cipansor_user
DB_PASSWORD=strong_password_here
DB_PORT=5432

# JWT
JWT_SECRET=your-super-secret-production-key-min-32-chars

# API
API_PORT=3001
LOG_LEVEL=info
CORS_ORIGIN=https://cipansor.or.id,https://www.cipansor.or.id,https://portal.cipansor.or.id

# Web
WEB_PORT=3000
# Empty = relative base; see the note in the Environment Setup section above.
NEXT_PUBLIC_API_URL=
API_INTERNAL_URL=http://api:3001

# Redis
REDIS_PORT=6379

# Asisten AI publik (opsional — biarkan kosong jika belum dipakai)
CHATBOT_PROVIDER=openai-compatible
CHATBOT_API_BASE_URL=https://<resource>.services.ai.azure.com/openai/v1
CHATBOT_API_KEY=...
CHATBOT_MODEL=DeepSeek-V4-Flash
```

> **Penting:** service `api` di `docker-compose.yml` menyebut variabel
> lingkungannya satu per satu. Variabel yang ada di `.env` tetapi **tidak**
> terdaftar di blok `environment:` service itu tidak akan sampai ke dalam
> container. Saat menambah variabel baru, ubah kedua berkas tersebut.
>
> Khusus chatbot, kelalaian ini tidak menimbulkan error: tanpa provider,
> `GET /chatbot/public/status` menjawab `available: false`, endpoint chat
> membalas 503, dan widget tidak dirender — persis seperti deployment yang
> memang sengaja tidak memakai asisten.

### Database Migration dengan Docker

```bash
# Masuk ke container API
docker compose exec api sh

# Jalankan migration
npx prisma migrate deploy
```

> **Jangan menjalankan seed ke produksi.** `prisma/seed.ts` men-`TRUNCATE`
> hampir seluruh tabel sebelum mengisi data contoh, dan kini menolak berjalan
> tanpa `ALLOW_DESTRUCTIVE_SEED=1` — variabel yang hanya boleh diset untuk basis
> data pengembangan, CI, atau staging.

---

## Manual Deployment

### API Deployment

```bash
cd apps/api

# Generate Prisma Client
pnpm db:generate

# Build
pnpm build

# Run production
NODE_ENV=production node dist/main.js
```

### Web Deployment

```bash
cd apps/web

# Build
pnpm build

# Run production
pnpm start
```

### Process Manager (PM2)

Untuk menjaga aplikasi tetap running:

```bash
# Install PM2
npm install -g pm2

# Start API
pm2 start apps/api/dist/main.js --name "cipansor-api"

# Start Web
pm2 start apps/web/.next/standalone/server.js --name "cipansor-web"

# Save configuration
pm2 save

# Setup startup script
pm2 startup
```

---

## Database Migration

### Irreversible migrations — backup is a hard prerequisite

Some migrations `DROP TABLE` and cannot be undone by re-running anything: the
`0_init` baseline never re-runs on an existing database, so a dropped table is
gone. **Take and verify a full backup before `prisma migrate deploy`** whenever a
pending migration drops tables, and confirm the dump is complete and restorable
before proceeding — rollback is restore-from-backup only.

As of this writing that applies to
`20260915120000_decommission_higher_ed_litbang`, which permanently removes the
higher-education (Perguruan Tinggi) and Litbang/R&D tables **and deletes every
row owned by a `PERGURUAN_TINGGI` unit** (its classes, students, teachers, staff,
departments, budgets, letters, assets, attendance, invoices, …). The unit is
removed outright rather than re-typed; the blast radius reaches 232 dependent
tables (233 including `units`), at a maximum depth of 3 — reproduced from the
post-drop FK catalog, seeded with the `SET NULL` children the migration purges by
row (the NULL-means-global tables, including `alumni_events` and
`account_codes`, plus the catalog-matched unique-per-unit tables), in the
migration header. `users` and `user_role_assignments` are not in
the deleted set: they survive detached with `unit_id = NULL`.
Back up, then deploy:

```bash
# 1. Backup — REQUIRED before the decommission migration
pg_dump -U postgres -Fc cipansor > cipansor_$(date +%Y%m%d_%H%M).dump

# 2. Verify the dump is readable and non-empty before trusting it
pg_restore --list cipansor_$(date +%Y%m%d_%H%M).dump | head
# (or, for a plain .sql dump: `wc -l` + grep for the tables you expect)

# 3. Only then apply
cd apps/api && npx prisma migrate deploy
```

This gate is an operator decision, not an automated one: no CI/CD or `Makefile`
deploy target runs `prisma migrate deploy` (the `CI` workflow has no deploy
stage; `Makefile deploy` uses `prisma db push`, and the API image starts with
`node dist/main.js`). Nothing in this repository can therefore _enforce_ that a
backup exists — the backup and its restorability check above are manual steps
the deploying operator must complete and confirm. If that ever needs to be
enforced, it belongs in whatever pipeline runs `migrate deploy`, not here.
Note: the decommission migration also ends the sessions of users left without any
role by the purge (their refresh tokens are revoked). That covers a user who
still holds a `PT_*` assignment at deploy time, a user attached to a PT role with
a non-standard code (roles are matched by `realm = 'PERGURUAN_TINGGI'` before the
realm rewrite, not only by the known `PT_*` codes), and a PT user whose
assignment was already removed by offboarding but who remains attached to the PT
unit — the migration snapshots the unit's accounts before deleting the unit,
because `users.unit_id` is `SET NULL` and the link is lost afterwards. It also
covers a non-PT role whose assignment was _scoped_ to the PT unit: the
assignment's `unit_id` is `SET NULL` too, and the token's unit comes from the
assignment (`tokenUnitId`), so a detached assignment would mint a null-unit token
that every optional unit filter reads as "all units". Such assignments are
deactivated (not deleted) and their holders swept with the rest. It also covers a
PT-home account whose _only_ active assignment is a non-foundation role that was
already null-scoped: the home unit's deletion makes `tokenUnitId` fall back to
`users.unit_id = NULL`, which mints the same widening null-unit token, so those
assignments are deactivated before the affected users are computed. A
foundation/global role is exempt — its null scope is foundation-wide by design —
as is any assignment scoped to a surviving unit. An access token
already issued stays valid until it expires — at most `JWT_EXPIRES_IN` (15
minutes by default). This is the same short window the system already accepts for
every other offboarding or role change, because `authenticate` is stateless by
design and does not query the database per request.

### Production Migration

```bash
cd apps/api

# Deploy pending migrations
npx prisma migrate deploy

# Generate client
npx prisma generate
```

### Backup Database

```bash
# Backup
pg_dump -U postgres cipansor > backup_$(date +%Y%m%d).sql

# Restore
psql -U postgres cipansor < backup_20240101.sql
```

---

## Monitoring & Logging

### Log Locations

- **API Logs**: `apps/api/logs/`
  - `error.log` - Error logs only
  - `combined.log` - All logs

### Health Check Endpoints

- **API**: `GET /health` — readiness check. It probes the database
  (`SELECT 1` via Prisma) and answers **503** (`status: "unavailable"`) when
  Postgres is unreachable, otherwise **200** (`status: "ok"`) with the
  `GIT_COMMIT_SHA` the release workflow polls.
- **Web**: Available at root `/`

### Recommended Monitoring Tools

1. **Application Monitoring**: none connected yet — Azure Application Insights is the planned choice (data stays in the yayasan's own Azure tenant)
2. **Infrastructure**: Prometheus + Grafana
3. **Logging**: ELK Stack, Loki

---

## Security Checklist

### Before Going Live

- [ ] Ganti JWT_SECRET dengan secret yang kuat (min 32 karakter random)
- [ ] Set NODE_ENV=production
- [ ] Aktifkan HTTPS/SSL
- [ ] Configure CORS dengan domain yang tepat
- [ ] Hapus atau protect Swagger docs di production
- [ ] Setup firewall rules
- [ ] Enable rate limiting
- [ ] Configure security headers
- [ ] Backup database secara reguler
- [ ] Setup monitoring dan alerting

### Security Headers

Headers yang sudah dikonfigurasi:

- X-Frame-Options: SAMEORIGIN
- X-Content-Type-Options: nosniff
- X-XSS-Protection: 1; mode=block
- Referrer-Policy: strict-origin-when-cross-origin

---

## Troubleshooting

### API tidak bisa connect ke Database

```bash
# Check connection string
DATABASE_URL="postgresql://user:password@host:5432/cipansor"

# Test connection
psql "$DATABASE_URL" -c "SELECT 1"
```

### Build Error

```bash
# Clear cache dan rebuild
pnpm store prune
rm -rf node_modules
pnpm install
pnpm build
```

### Memory Issues

Tambahkan memory limit di environment:

```bash
export NODE_OPTIONS="--max-old-space-size=4096"
```

### Port Already in Use

```bash
# Check port
lsof -i :3001

# Kill process
kill -9 <PID>
```

---

## Platform Recommendations

### API Hosting

1. **Railway** - Easy deployment, auto-scaling
2. **Render** - Free tier available
3. **DigitalOcean App Platform** - Good for scaling
4. **AWS ECS** - Enterprise-grade

### Frontend Hosting

1. **Vercel** - Best for Next.js
2. **Netlify** - Good alternative
3. **Cloudflare Pages** - Fast CDN

### Database Hosting

1. **Neon** - Serverless PostgreSQL
2. **Supabase** - PostgreSQL + extras
3. **Railway PostgreSQL** - Simple setup
4. **AWS RDS** - Enterprise-grade

---

## Support

- Repositori: <https://github.com/ypcipansor/cipansor>
- Isu & permintaan: <https://github.com/ypcipansor/cipansor/issues>
- Konvensi pengembangan: [`AGENTS.md`](../AGENTS.md)

Untuk catatan insiden produksi dan langkah pemulihannya, lihat
[`.claude/memory/known-issues.md`](../.claude/memory/known-issues.md); untuk
konteks dua-host (apex vs portal) lihat [`ARCHITECTURE.md`](./ARCHITECTURE.md).
