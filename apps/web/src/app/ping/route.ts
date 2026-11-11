import { NextResponse } from "next/server";

/**
 * Lightweight health endpoint on the web origin, at `/ping`.
 *
 * It used to be `/api/health`, but behind nginx every `/api` path goes to the
 * API, where `/api/health` is the UKS (clinic) module and answers 404 — so a
 * probe meant to prove the network works reported it down. `/ping` is served
 * by the web wherever it runs, and the middleware lets it through untouched. Used by the offline
 * detection (use-online-status / offline-banner) as a connectivity probe —
 * `navigator.onLine` alone misreports behind VPNs/proxies and in automated
 * browsers, so the client verifies with a real request against this route.
 */
export function GET() {
  return NextResponse.json({ status: "ok" });
}

export function HEAD() {
  return new Response(null, { status: 200 });
}
