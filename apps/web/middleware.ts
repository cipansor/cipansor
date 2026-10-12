/**
 * Next.js Middleware
 * Handles authentication, route protection, and role-based routing
 */

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  canAccessRoute,
  getDashboardForRole,
  isLegacyRole,
  type LegacyRole,
} from "@/lib/rbac";
import { PRINCIPAL_COOKIE } from "@cipansor/shared";
import { hostSplitActionFor, isPortalHost } from "@/lib/host-split";
import { contentSecurityPolicy } from "@/lib/security-headers";

/**
 * Mint a fresh nonce for a document request.
 *
 * A 128-bit random value, base64. `crypto.getRandomValues` is available in the
 * middleware runtime; the value is unpredictable and unique per request, which
 * is the whole security property of a nonce.
 */
function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

// Public routes that don't require authentication.
// "/unauthorized" is the access-denied page ProtectedRoute redirects to; it
// must stay reachable for any user (otherwise RBAC would bounce them off it).
//
// "/reset-password" is here for the same reason a login form is: the person
// arriving on it cannot sign in — they are holding a link e-mailed to them.
// Leaving it out is what made every "set your password" e-mail land on
// "/login?redirect=/reset-password" with the token discarded; the page existed
// nowhere and the redirect hid that fact.
//
// THERE IS DELIBERATELY NO SELF-SERVICE "lupa password" PAGE. A reset is
// started by an admin who has identified the person, not by anyone who can type
// an e-mail address into a public form. That keeps the mail-sending trigger
// behind the session wall and off the open internet.
//
// Portal-only: not in PUBLIC_PATH_PREFIXES, so the apex answers 404 for it,
// which is right for an account action.
const publicRoutes = ["/login", "/", "/unauthorized", "/reset-password"];

/**
 * Public marketing pages, reachable with no session at all.
 *
 * These are the pages Google indexes and the Ad Grants review visits. Anything
 * added under these prefixes must stay readable to an anonymous visitor —
 * bouncing a prospective parent to the staff login screen is what got the Ad
 * Grants application rejected the first time.
 *
 * (`/public/*` is already exempt because the matcher below excludes it.)
 */
const publicPrefixes = [
  "/profil",
  "/program-unggulan",
  "/unit",
  "/campus",
  "/activities",
  "/berita",
  "/galeri",
  "/wakaf-infaq",
  "/kontak",
  /**
   * The path a letter's printed QR used to open.
   *
   * The page itself is gone: a token attests that *some* letter was signed,
   * never that the document in your hand is that letter, so a forger could keep
   * the genuine QR and edit the body while the page still answered that the
   * letter was valid. Verification now means uploading the PDF itself at
   * /public/verify-letter, and next.config.ts 308s this path there.
   *
   * The prefix stays public because the redirect must reach people who have no
   * account here — a dinas office, a wali santri — and the letters carrying the
   * old URL are already on paper.
   */
  "/verifikasi",
  /**
   * Where a printed student ID card's QR points. Kept in step with
   * `PUBLIC_PATH_PREFIXES` in lib/host-split.ts (the two lists must describe
   * the same set; a sync test enforces it). It is a `/public/*` page, so the
   * matcher below exempts it from middleware entirely — this listing only keeps
   * the two canonical lists in agreement (Flag 11), not a runtime effect.
   */
  "/public/verify-card",
  /**
   * Where the public key-status page lives (AATL ICA7). Kept in step with
   * `PUBLIC_PATH_PREFIXES` in lib/host-split.ts (the sync test enforces it).
   * Listing it here makes the read-without-a-session intent explicit; without
   * the matching entry in host-split.ts the page would 404 on the apex.
   */
  "/public/verify-key",
  /**
   * Where a printed sanad/syahadah's QR points (`certificateVerificationUrl`).
   * Kept in step with `PUBLIC_PATH_PREFIXES` in lib/host-split.ts. Like
   * `/public/verify-card` the matcher already exempts it from middleware; the
   * listing only keeps the two canonical lists in agreement (Flag 11).
   */
  "/public/verify-sanad",
];

/**
 * The caller's role, read from the API-set routing cookie.
 *
 * The session itself is an HttpOnly `cipansor_at` token the middleware cannot
 * make sense of, so the API sets a second HttpOnly cookie beside it holding only
 * what routing needs — `{ id, role, roleCode }`. Reading it here, locally, is
 * the whole point: the earlier shape asked the API for every page request,
 * which meant one round trip per page and per `<Link>` prefetch, all keyed on
 * the web container's loopback address and shared by every user.
 *
 * It is not a credential. The value is not trusted to authorise anything: the
 * API decides that on every request, so a stale or forged cookie only reaches a
 * page whose first call answers 401. A missing/malformed cookie is "not signed
 * in", the same normal answer a missing cookie always was.
 */
function readPrincipal(
  request: NextRequest,
): { role: LegacyRole; roleCode: string } | null {
  const raw = request.cookies.get(PRINCIPAL_COOKIE)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { role?: unknown; roleCode?: unknown };
    if (!isLegacyRole(parsed.role)) return null;
    return {
      role: parsed.role,
      roleCode:
        typeof parsed.roleCode === "string" ? parsed.roleCode : parsed.role,
    };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // One nonce per document request, threaded into every response below. Next
  // reads the CSP off the *request* headers to stamp its own inline bootstrap
  // scripts, and server components read it back to stamp theirs, so every
  // response that a document can be rendered from must carry it.
  const nonce = newNonce();
  const csp = contentSecurityPolicy(nonce);

  // A rewrite/next that keeps the request headers (with the nonce and CSP) so
  // the renderer can see them. A redirect cannot — it is answered directly by
  // the browser, and its target is re-rendered through middleware with a fresh
  // nonce.
  const pass = () => {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };

  const redirect = (url: URL, status?: number) => {
    const response = NextResponse.redirect(url, status);
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };

  const rewrite = (url: URL, status?: number) => {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
    const response = NextResponse.rewrite(url, {
      status,
      request: { headers: requestHeaders },
    });
    response.headers.set("Content-Security-Policy", csp);
    return response;
  };

  // Host split, before anything else.
  //
  // The public site and the application are served from separate hosts (see
  // lib/host-split.ts). This MUST run ahead of the auth checks below: those
  // send an anonymous visitor to `/login`, and `/login` is in `publicRoutes`,
  // so reaching them at all would put the login form back on the apex — the one
  // thing the split exists to prevent.
  //
  // Returns null for any host that is not one of the two production names, so
  // `pnpm dev` on localhost is untouched.
  const action = hostSplitActionFor(request.headers.get("host"), pathname);

  if (action?.kind === "notFound") {
    // An application path asked for on the public host. The apex has no
    // application on it, so it says so — rewrite, not redirect, so the address
    // the visitor typed stays in the bar and they can see what was wrong with
    // it. There is one way in to the system and it is portal.cipansor.or.id.
    return rewrite(new URL("/404", request.url), 404);
  }

  if (action?.kind === "redirect") {
    const url = request.nextUrl.clone();
    url.host = action.host;
    url.port = "";
    url.protocol = "https:";
    // 308, not 307: this is a permanent move, and unlike 301 it is guaranteed
    // not to rewrite a POST into a GET on the way.
    return redirect(url, 308);
  }

  // Check if the route is public
  const isPublicRoute =
    publicRoutes.some(
      (route) => pathname === route || pathname.startsWith("/login"),
    ) ||
    // Match on segment boundaries so "/unit" never also grants "/units".
    publicPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );

  // Authentication, only where it decides the outcome.
  //
  // `readPrincipal` is a local cookie read, but it is still skipped when the
  // result cannot change the response: public routes and `/` never consult it,
  // and a request to `/login` only needs to know whether to bounce to a
  // dashboard.
  let isAuthenticated = false;
  let role: LegacyRole | undefined;
  let roleCode: string | undefined;

  if (!isPublicRoute || pathname === "/login" || pathname === "/") {
    const principal = readPrincipal(request);
    if (principal) {
      isAuthenticated = true;
      role = principal.role;
      roleCode = principal.roleCode;
    }
  }

  // Redirect unauthenticated users to login
  if (!isPublicRoute && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return redirect(loginUrl);
  }

  // Redirect authenticated users from login to their role-specific dashboard
  if (pathname === "/login" && isAuthenticated) {
    const dashboard = getDashboardForRole(role, roleCode);
    return redirect(new URL(dashboard, request.url));
  }

  // Redirect from root to appropriate page
  if (pathname === "/") {
    if (isAuthenticated) {
      const dashboard = getDashboardForRole(role, roleCode);
      return redirect(new URL(dashboard, request.url));
    }
    // On the portal the root is the front door of the application, not a
    // marketing page — the landing page lives on the public host, and the host
    // split above already sent every marketing path there. Rendering it here
    // would give the pesantren's front page a second address that answers on a
    // noindex host, and leave someone who typed the portal's name looking at a
    // brochure instead of the sign-in form they came for.
    if (isPortalHost(request.headers.get("host"))) {
      return redirect(new URL("/login", request.url));
    }
    // Allow unauthenticated users to see landing page
    return pass();
  }

  // Role-based access control for authenticated users
  if (isAuthenticated && role && !isPublicRoute) {
    if (!canAccessRoute(role, pathname, roleCode)) {
      // Redirect to their proper dashboard if trying to access unauthorized route
      const dashboard = getDashboardForRole(role, roleCode);
      return redirect(new URL(dashboard, request.url));
    }
  }

  return pass();
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (images, etc.)
     */
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\..*|public).*)",
  ],
};
