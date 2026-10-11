# Deploying to Azure App Service

How Cipansor runs on Azure once it moves off the single VM, and how a change
travels from a merged PR to production. The VM procedure in
[`DEPLOYMENT.md`](./DEPLOYMENT.md) stays valid until the cutover.

## What runs where

Everything lives in resource group `cipansor-prod` (Indonesia Central).

| Piece | Resource | Notes |
|---|---|---|
| App hosting | App Service plan `cipansor-plan` (Linux B2) | Holds both apps below |
| Production | Web app `cipansor-produksi` | `cipansor.or.id`, `www.`, `portal.` |
| Staging | Web app `cipansor-staging` | `staging.cipansor.or.id`, public (noindex), **demo data only** |
| Database | PostgreSQL Flexible `cipansor-pg` (B1ms, 32 GB) | Private network only; databases `cipansor` and `cipansor_staging` |
| Images | Container Registry `cipansoracr` (Basic) | `cipansor-{api,web,nginx}:<commit sha>` |
| Files | Each app's own `/home` (App Service storage) | Uploads and identity documents; see [Files](#files) |
| Secrets | Key Vaults `cipansor-kv-prod`, `cipansor-kv-stg` | App settings reference them; no secrets in files |
| Logs | Log Analytics `cipansor-logs` | 30-day retention |

Each app is a **sidecar set**: four containers sharing `localhost`, the same
shape as `docker-compose.yml`.

| Container | Image | Port | Role |
|---|---|---|---|
| `nginx` (main) | `deploy/azure/nginx` | 80 | The only one App Service sends traffic to; routes `/api`, `/uploads` to api, the rest to web |
| `web` | `apps/web/Dockerfile` | 3000 | Next.js |
| `api` | `apps/api/Dockerfile` | 3001 | Express, cron jobs |
| `redis` | `redis:7-alpine` | 6379 | Cache (dashboard metrics, permissions, chatbot answers); contents may be lost |

The api runs cron jobs in-process, so each app stays at **one instance** with
Always On. Scaling out would run every job twice.

## Files

The api writes uploads to `public/uploads` and identity documents to
`private/identity`, relative to its working directory. On the VM those are
docker volumes. On App Service the only storage that survives a restart and
reaches a **sidecar** is the app's `/home`: Azure Files path mappings are
mounted into the main container (nginx) only. So the api gets
`PERSISTENT_DIR=/home/data`, and `docker-entrypoint.sh` replaces both
directories with links into it before the api starts. It refuses to replace a
directory that already holds files.

`/home` shares the plan's storage allowance (10 GB on Basic). When uploads
outgrow it, they belong in Blob Storage, which the api cannot write to yet.

## Differences between staging and production

| Setting | Production | Staging | Why |
|---|---|---|---|
| `APP_ENV` | `production`, set by `deploy-production.yml` | `staging`, set by `deploy-staging.yml` | Which deployed copy this is — distinct from `NODE_ENV`, which is `production` on both because both run the same images. It is what `/health` reports as `environment`, and what lets a guard say "not in production" and mean it: the chatbot refuses its `stub` provider in production, so staging — where the assistant is exercised with the real provider — needs to be distinguishable. A production build with it unset resolves to `production`; anything else to `local`. |
| `SCHEDULER_ENABLED` | unset (on) | `false` | Staging must not bill, remind or escalate, even from demo data |
| `OUTBOUND_MESSAGES_ENABLED` | unset (on) | `false` | E-mail, SMS and WhatsApp are logged, never sent — even if real credentials leak into staging |
| `DOCUMENT_TEST_COPY` | unset (off) | `true`, set by `deploy-staging.yml` on every release | Every PDF the api renders and every page printed from the web is stamped "SALINAN UJI — BUKAN DOKUMEN SAH": staging's demo accounts carry the names of real office holders, their passwords are public, and the letterhead is the real one |
| `CHATBOT_PROVIDER` | `openai-compatible` with a Key Vault key (when enabled) | `openai-compatible` with staging's own `CHATBOT_API_KEY`, set by `deploy-staging.yml` | Staging runs the REAL provider, not a double, so a walkthrough there answers the way production answers. It needs its own key (`secrets.CHATBOT_API_KEY`, plus `vars.CHATBOT_API_BASE_URL` and `vars.CHATBOT_MODEL` on the `staging` environment). When the key is absent the workflow sets `disabled` and warns — the assistant stays off rather than answering from a stub that could be mistaken for a release-ready model. |
| `MIGRATE_ON_START` | `true` | `true` | The database is private; CI cannot reach it |
| `PERSISTENT_DIR` | `/home/data` | `/home/data` | Uploads and identity documents survive restarts ([Files](#files)) |
| Gmail / SMTP / WhatsApp credentials | Key Vault references | none | Second line of defence behind the switch above |
| `TURNSTILE_SECRET_KEY` | Key Vault reference | none | Without it the api's Turnstile check is off; no production secret is copied to staging |

**Staging holds demo data only — never a copy of real data.** It is reachable
by anyone who knows the name: there is no Cloudflare Access in front of it (the
Zero Trust plan could not be activated). It is seeded from `prisma/seed.ts`
(`ALLOW_DESTRUCTIVE_SEED=1`, the seed wipes every table first) **without**
`E2E_FIXED_2FA`, so it behaves like production: admin accounts are sent to 2FA
setup at their first login and must enrol an authenticator; there is no demo
mode to waive it.
Testing a migration against real data happens on a throwaway database restored
from the backup, as the VM runbook describes, not on staging.

## How a change is released

1. **Pull request** — CI (`ci.yml`) and E2E (`e2e-tests.yml`) must be green
   before merging (the ruleset requires Build, Lint, Tests, Security and
   E2E Tests (Chromium)). A change with no code in it — documentation or
   agent tooling only, as `.github/scripts/change-scope.sh` defines it — skips
   all of them, and E2E also skips a draft; a skipped job counts as passed.
2. **Merge to `main`** — after CI **and** E2E Tests pass on `main`,
   `deploy-staging.yml` (triggered by E2E, which first confirms CI passed on
   the same commit) builds
   the three images once, tags them with the commit SHA, pushes them to the
   registry, points `cipansor-staging` at them and waits until
   `https://staging.cipansor.or.id/healthz` reports that SHA (see
   [Verifying a release](#verifying-a-release)). The api applies pending
   migrations to the staging database as it starts, so a migration that cannot
   apply fails here first. When nothing between the commit staging runs and the
   new one is code, the build and restart are skipped and staging keeps
   reporting the earlier commit — the same code. Release that commit: it is
   the one whose images exist.
3. **Production** — only when the user asks for a release. Claude:
   1. confirms staging runs the SHA to be released and has been checked, and
      runs the k6 smoke against it (Actions → Load Tests → Run workflow;
      `tests/load/README.md`) — a regression against the recorded baseline
      stops the release until it is explained;
   2. takes a backup (`pg_dump` through the backup job, in addition to the
      server's own 7-day point-in-time restore);
   3. runs the pre-checks the VM runbook requires for any migration in the
      release — validate every new constraint against live data, because a
      migration that fails halfway leaves a failed row in `_prisma_migrations`
      that blocks every later one;
   4. `gh workflow run deploy-production.yml -f sha=<full sha>` — it refuses
      a SHA whose images staging never built, points `cipansor-produksi` at
      them and waits until `https://cipansor.or.id/healthz` reports that SHA;
   5. verifies behaviour (a real page and an authenticated API call), not just
      that the containers started.
4. **Rollback** — run `deploy-production.yml` again with the previous SHA.
   Migrations are forward-only; a release that changes the schema is rolled
   back by restoring the database from the backup in step 3.2.

## Verifying a release

`deploy/azure/wait-for-release.sh` asks the app, not Azure. The api image is
built with `GIT_COMMIT_SHA`, and `GET /health` reports it as `commit`. The
script polls `<host>/healthz` (nginx → api) until `commit` equals the released
SHA — the old code answering during the restart does not count, and an api that
never starts (a failed migration exits the container) times out after 15
minutes. `/health` is a readiness check, so it only answers 200 once the
database is reachable too; a container whose Postgres is down reports 503 and
the release keeps waiting rather than counting it as deployed (#665). It then
requires `<host>/manifest.json` (nginx → web) to return 200.

It goes through Cloudflare like a visitor, because the apps admit nothing else.
It deliberately does not use `az webapp sitecontainers status`: that call goes
to the SCM (Kudu) site, which is closed to everything but Cloudflare as well.

## Watching a release

`deploy-watch.yml` runs each time `Deploy staging` or `Deploy production`
finishes, and asks the GitHub API for the latest run of both. It opens an issue
labelled `deploy-watch` when the latest run failed or was cancelled, has been
stuck past 45 minutes, or finished green while the site it released is not
answering with its commit — the same `/healthz` and `/manifest.json` probes
[Verifying a release](#verifying-a-release) uses.

It runs on completion, not on a clock (decided 2026-10-10): a cron every 30
minutes was ~1,440 runs a month to watch sites that mostly had not changed. A
site that degrades later with no deploy — a container that restarts, a bad app
setting — is the platform's to report: turn on **Health check** for each web
app (Monitoring → Health check, path `/healthz`), which pings it every minute
and replaces an instance that stays unhealthy, and add an **availability test**
with an alert in Application Insights. Neither is configured from this
repository.

It is read-only with respect to the deployment: **it never rolls back, reruns or
repoints a container.** The issue carries the run id, the commit and the failing
job's log lines; a human decides what to do (step 3 or step 4 above). A failure
it has already reported is not reported twice — the open issue is matched on a
`deploy-watch:run=<id>` marker in its body.

Run it by hand against the real repository with
`GITHUB_REPOSITORY=ypcipansor/cipansor GH_TOKEN=… bash .github/scripts/deploy-watch.sh`,
or add `DEPLOY_WATCH_DRY_RUN=1` to print what it would open without creating
anything. `DEPLOY_WATCH_STUCK_MINUTES` and `DEPLOY_WATCH_WORKFLOWS` override the
threshold and the watched workflows. Its behaviour is pinned by
`apps/api/src/utils/deploy-watch.guard.test.ts`, which drives the real script
against a fake API.

## Cloudflare

Set up by hand in the Cloudflare dashboard, once:

- DNS: `staging` CNAME to `cipansor-staging.azurewebsites.net`, proxied; the
  production names move to `cipansor-produksi.azurewebsites.net` at cutover.
- A `TXT` record `asuid.staging` with the app's custom-domain verification ID,
  so Azure accepts the host name even though the proxied CNAME resolves to
  Cloudflare.
- SSL/TLS "Full (strict)" and an Origin CA certificate. The key pair is
  generated inside Key Vault (`cipansor-kv-stg/origin-staging`, issuer
  "Unknown"); only its CSR is signed in the Cloudflare dashboard and merged
  back, so the private key never leaves the vault.
- Turnstile: add `staging.cipansor.or.id` to the widget's hostnames.

## Access

- **Traffic:** App Service access restrictions admit only Cloudflare's IP
  ranges (and the SCM site uses the same rules). `nginx.conf` trusts
  `CF-Connecting-IP` because of this — if the restriction is ever removed, that
  line must change with it.
- **TLS:** Cloudflare "Full (strict)" to an Origin CA certificate on each app.
  App Service managed certificates cannot be issued behind the Cloudflare proxy.
- **Deploying:** GitHub Actions signs in with OIDC, no stored password. Two
  user-assigned identities, one per GitHub environment:
  `staging` may push images and update `cipansor-staging`; `production` may
  read the registry and update `cipansor-produksi`. Each environment's
  `AZURE_CLIENT_ID` variable names its identity. This repository uses GitHub's
  **immutable subject claims**, so each federated credential's subject is
  `repo:ypcipansor@312987445/cipansor@1109587728:environment:<name>` — the
  name-only form `repo:ypcipansor/cipansor:…` is rejected with `AADSTS700213`.
  `gh api repos/ypcipansor/cipansor/actions/oidc/customization/sub` shows the
  prefix.
- **Pulling images:** each app pulls from the registry with its own managed
  identity (`AcrPull`); the registry's admin user is disabled.
- **Secrets:** each app reads its own Key Vault with its managed identity
  (`Key Vault Secrets User`); staging cannot read production secrets.

## Reading logs

The SCM (Kudu) site admits Cloudflare only, so `az webapp log tail` and the
portal's Log stream do not work from elsewhere. Container output goes to Log
Analytics `cipansor-logs` instead (diagnostic setting `ke-log-analytics`):

```
az monitor log-analytics query -w <workspace id> --analytics-query \
  "AppServiceConsoleLogs | where _ResourceId endswith 'cipansor-staging' | top 100 by TimeGenerated"
```

Ingestion lags a few minutes.

## Creating a database on the server

Each environment has its own database and login role (`cipansor_staging`;
production's at cutover). On Azure Database for PostgreSQL the `public` schema
of a new database belongs to `azure_pg_admin`, **not** to the database owner,
so the owner cannot create tables and the first `prisma migrate deploy` fails
with `permission denied for schema public`. After `CREATE DATABASE … OWNER
<role>`, connect to it as the admin and run
`ALTER SCHEMA public OWNER TO <role>;`.

## Settings the CLI insists on

- Every `environmentVariables[].value` of a sitecontainer must name an app
  setting that exists, or `az webapp sitecontainers update` refuses to run.
  That is why `NEXT_PUBLIC_API_URL` exists as an app setting with an empty
  value (the web image is built for a same-origin API).
- web, nginx and redis have `inheritAppSettingsAndConnectionStrings=false`;
  otherwise every app setting — database URL and JWT secret included — is
  handed to every container.

## GitHub settings this relies on

- Environments `staging` and `production`, each limited to the `main` branch.
- Variables: `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `TURNSTILE_SITE_KEY`
  (repository), and `AZURE_CLIENT_ID` (per environment).
- The `staging` environment also carries `vars.CHATBOT_API_BASE_URL` and
  `vars.CHATBOT_MODEL`, plus `secrets.CHATBOT_API_KEY`. The three are required
  together: `resolveProvider()` needs all of key, base URL and model, and with
  any one missing the assistant is off. Without the secret,
  `deploy-staging.yml` sets `CHATBOT_PROVIDER=disabled` and warns; with the
  secret but a missing variable it now **fails the release** instead of writing
  a half-configured provider that deploys cleanly and shows no assistant. Either
  way the assistant is invisible on staging — the very bug the `APP_ENV` split
  exists to fix. Treat a missing staging key as a release blocker, not a silent
  degradation.
