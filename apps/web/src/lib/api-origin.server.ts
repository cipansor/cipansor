/**
 * The absolute origin the *server* uses to reach the API — from configuration
 * only, never from the request.
 *
 * - `API_INTERNAL_URL` when set: compose names the API `http://api:3001`.
 * - `NEXT_PUBLIC_API_URL` when it is an absolute origin: `pnpm dev`, where
 *   web (:3000) and API (:3001) differ.
 * - Otherwise `http://127.0.0.1:3001`. An **empty** `NEXT_PUBLIC_API_URL` means
 *   "same origin" to the bundle (`lib/api.ts`); Node's `fetch` cannot use a
 *   relative URL, and the API is on the loopback wherever web and API run side
 *   by side — the Azure App Service sidecars share it (`deploy/azure/nginx`
 *   proxies `/api` to `127.0.0.1:3001`).
 *
 * An earlier revision built the origin from the request's `Host` /
 * `X-Forwarded-Host` headers. That made the server fetch whatever host a
 * request named, and in the Azure deployment it sent every page view back out
 * through the public address and Cloudflare to reach an API on the same
 * machine.
 *
 * Shared by every server-side fetch of the public API (`public-intakes.server`,
 * `privacy-policy.server`) so the resolution has exactly one home.
 */
export function apiOriginForServer(): string {
  if (process.env.API_INTERNAL_URL) return process.env.API_INTERNAL_URL;
  const browserOrigin = process.env.NEXT_PUBLIC_API_URL;
  if (browserOrigin) return browserOrigin;
  return "http://127.0.0.1:3001";
}
