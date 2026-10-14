# syntax=docker/dockerfile:1
# Cipansor Web (Next.js) — multi-stage build using Next standalone output.
# The runner ships only the standalone server + static assets + public dir.
#
# Behind a TLS-terminating egress proxy, pass the proxy CA as a build secret:
#   docker build --secret id=proxyca,src=<ca.crt> \
#     --build-arg NEXT_PUBLIC_API_URL=http://localhost:3001 \
#     -f apps/web/Dockerfile -t cipansor-web .
# In a normal network the secret is unused and the build works without it.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV CI=true
WORKDIR /app
RUN --mount=type=secret,id=proxyca,required=false \
    if [ -f /run/secrets/proxyca ]; then \
      cat /run/secrets/proxyca >> /etc/ssl/certs/ca-certificates.crt; \
    fi && \
    NODE_EXTRA_CA_CERTS=/run/secrets/proxyca corepack enable && \
    NODE_EXTRA_CA_CERTS=/run/secrets/proxyca corepack prepare pnpm@12.11.2 --activate

# ---- deps: install web + shared deps (api manifest not copied) ----
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/shared/package.json ./packages/shared/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    --mount=type=secret,id=proxyca,required=false \
    NODE_EXTRA_CA_CERTS=/run/secrets/proxyca pnpm install --frozen-lockfile

# ---- builder: build shared, then Next.js (standalone output) ----
FROM base AS builder
ENV NODE_OPTIONS=--max-old-space-size=4096
ENV NEXT_TELEMETRY_DISABLED=1
ENV BUILD_STANDALONE=1
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
# Site key Cloudflare Turnstile. Bawaannya kosong dengan sengaja: build yang
# tidak menyebutkannya menghasilkan halaman tanpa widget, bukan halaman dengan
# widget yang site key-nya salah.
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY}
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
RUN --mount=type=secret,id=proxyca,required=false \
    NODE_EXTRA_CA_CERTS=/run/secrets/proxyca pnpm --filter @cipansor/shared build \
 && NODE_EXTRA_CA_CERTS=/run/secrets/proxyca pnpm --filter web build

# ---- runner: minimal standalone server ----
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001

# Next standalone output bundles only the server's runtime deps.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# next/image writes optimised variants here. docker-compose mounts a named
# volume at this path so the cache survives redeploys; creating the directory
# here — owned by the runtime user — makes Docker seed that volume with the
# right ownership. Without it Docker creates the mountpoint as root, uid 1001
# cannot write, and every image is re-optimised on every single request.
RUN mkdir -p /app/apps/web/.next/cache/images \
 && chown -R nextjs:nodejs /app/apps/web/.next/cache

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"
WORKDIR /app/apps/web
CMD ["node", "server.js"]
