import * as fs from "fs";
import * as path from "path";
import type { Page } from "@playwright/test";
import { generate as generateTotp } from "otplib";
import { currentWorkerIndex } from "./workers";

/**
 * API-based authentication for e2e tests.
 *
 * Driving the login form is brittle (and impossible for admins, who are forced
 * through a 2FA gate). Instead we authenticate against the real API — completing
 * the 2FA challenge with a TOTP derived from the seed's fixed secret — and inject
 * the resulting session into the browser.
 *
 * The browser session is now an HttpOnly cookie the page's JavaScript cannot
 * read; `injectSession` writes that cookie (Playwright can, even HttpOnly) plus
 * the readable CSRF cookie, and seeds only the *user* into localStorage so the
 * UI shell renders before `/auth/me` answers. The API helpers below keep using
 * the bearer token — they opt in with `X-Client: bearer`.
 *
 * Requires the API seeded with `E2E_FIXED_2FA=1` so admin accounts share a known
 * TOTP secret.
 */

const API_URL = process.env.API_URL || "http://localhost:3001/api";
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const FIXED_2FA_SECRET =
  process.env.E2E_2FA_SECRET || "NTGHH5U5LDHIYARFFNGFQKQHARJU7GBE";

/** Cookie names issued by the API (apps/api/src/modules/auth/auth.cookies.ts). */
export const ACCESS_COOKIE = "cipansor_at";
export const REFRESH_COOKIE = "cipansor_rt";
export const CSRF_COOKIE = "cipansor_csrf";
export const PRINCIPAL_COOKIE = "cipansor_principal";

/**
 * The slim routing cookie the Next middleware reads (no API round trip).
 *
 * The API's own value when the session came from a sign-in: it decides the
 * bucket from the active role code (falling back to the legacy column only for
 * komite and alumni), and a copy derived here from `user.role` routed ketua@ —
 * STAFF in that column, Ketua Pengurus by assignment — as STAFF. The
 * derivation below is only for a session a test builds by hand.
 */
function principalValue(session: {
  user: Record<string, unknown> & { role?: string; id?: string };
  principal?: string;
}): string {
  if (session.principal) return session.principal;
  const user = session.user as {
    id?: string;
    role?: string;
    userRoles?: Array<{ isPrimary?: boolean; role?: { code?: string } }>;
  };
  const primary =
    user.userRoles?.find((a) => a?.isPrimary) ?? user.userRoles?.[0];
  return JSON.stringify({
    id: user.id ?? "",
    role: user.role ?? primary?.role?.code ?? "",
    roleCode: primary?.role?.code ?? user.role ?? "",
  });
}

/** A stable double-submit value; the API only requires cookie === header. */
export const E2E_CSRF_TOKEN = "e2e-csrf-token";

export interface SeedUser {
  email: string;
  password: string;
}

/** Seed credentials, keyed by a friendly role name. */
export const SEED_USERS = {
  superAdmin: {
    email: "superadmin@cipansor.or.id",
    password: "SuperAdmin123!",
  },
  adminSdit: { email: "admin.sdit@cipansor.or.id", password: "Admin123!" },
  yayasanBendahara: {
    email: "yayasan.bendahara@cipansor.or.id",
    password: "Cipansor123!",
  },
  teacher: { email: "fatimah@cipansor.or.id", password: "Teacher123!" },
  parent: { email: "parent3@cipansor.or.id", password: "Parent123!" },
  student: { email: "student3@cipansor.or.id", password: "Student123!" },
  // The three yayasan organs, each with one step in ratifying a yayasan
  // document (perencanaan-pengesahan.spec.ts). Legacy UNIT_ADMIN, so CI's
  // E2E_FIXED_2FA seed gives them the fixed TOTP secret like any admin.
  ketuaPengurus: {
    email: "yayasan.ketua@cipansor.or.id",
    password: "Cipansor123!",
  },
  pengawas: {
    email: "yayasan.pengawas@cipansor.or.id",
    password: "Cipansor123!",
  },
  pembina: {
    email: "yayasan.pembina@cipansor.or.id",
    password: "Cipansor123!",
  },
} satisfies Record<string, SeedUser>;

export type SeedRole = keyof typeof SEED_USERS;

export interface AuthSession {
  user: Record<string, unknown> & { role?: string; id?: string };
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
  /** The routing cookie's value exactly as the API set it at sign-in. */
  principal?: string;
}

async function postJson(path: string, body: unknown, bearer?: string) {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Ask for the tokens in the body: a cookie jar is awkward from fetch and
      // the API helpers need a raw bearer for subsequent requests.
      "x-client": "bearer",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    const json = JSON.parse(text);
    return { json, setCookie: res.headers.get("set-cookie") ?? "" };
  } catch {
    // Non-JSON (e.g. the rate limiter's plain "Too many requests" body).
    throw new Error(`POST ${path} → ${res.status}: ${text.slice(0, 120)}`);
  }
}

/** Pull a cookie value out of a `Set-Cookie` header string. */
function cookieFromSetCookie(header: string, name: string): string | null {
  const match = header.match(new RegExp(`(?:^|,\\s*)${name}=([^;,]*)`));
  return match ? match[1] : null;
}

/** The routing cookie the API set, decoded to the JSON the middleware parses. */
function principalFromSetCookie(header: string): string | undefined {
  const raw = cookieFromSetCookie(header, PRINCIPAL_COOKIE);
  return raw ? decodeURIComponent(raw) : undefined;
}

// Cache sessions per email (per worker process) so we don't re-run the login +
// 2FA flow in every beforeEach — that quickly trips the 2FA rate limiter.
const sessionCache = new Map<string, AuthSession>();

/**
 * One session store per worker: `.auth/sessions.w<worker>.json`, holding
 * `{ [email]: AuthSession }`. global-setup writes it (one real login + 2FA per
 * role *per worker*); each worker reads only its own.
 *
 * Per worker, not one shared file (#1144). A single session per role meant
 * every worker held the same refresh token, and the API rotates that token on
 * first use — deleting the presented row — so whichever worker refreshed first
 * revoked the session for all the others, which then answered 401 and bounced
 * to `/login` mid-test. Separate files also mean a worker that rotates its
 * session writes back only its own file, with no cross-worker write race.
 */
export function sessionsFileFor(worker: number): string {
  return path.join(__dirname, `../../.auth/sessions.w${worker}.json`);
}

/** The cache key for a role's session: the role's email, within one worker. */
export function sessionKey(email: string): string {
  return email;
}

/** Seed email → the role's storageState file name (`.auth/<role>.json`). */
const STORAGE_STATE_FILE_BY_EMAIL: Record<string, string> = Object.fromEntries(
  Object.entries(SEED_USERS).map(([role, user]) => [user.email, role]),
);

/**
 * The storageState mirror a spec reads (`test.use({ storageState })`), or null
 * for an email that is not a seed role. It mirrors worker 0's session, so it
 * must move whenever that session does (#1144).
 */
export function storageStateFileFor(email: string): string | null {
  const role = STORAGE_STATE_FILE_BY_EMAIL[email];
  return role ? path.join(__dirname, `../../.auth/${role}.json`) : null;
}

function readSessionsFile(worker: number): Record<string, AuthSession> {
  try {
    return JSON.parse(fs.readFileSync(sessionsFileFor(worker), "utf8"));
  } catch {
    return {};
  }
}

/**
 * Persist one worker's store. Worker 0 also owns the storageState mirrors the
 * `test.use({ storageState })` specs read, so they are rewritten here — the one
 * place a stored session changes — keeping a rotated worker-0 session and its
 * mirror in step. Without this, `session-isolation.spec.ts` rotating worker 0's
 * token left the mirror on the refresh token the server had just deleted: the
 * next mirror-reading spec refreshed with it, answered 401 and bounced to
 * `/login`. (A local stack's 15-minute access token is what makes that refresh
 * happen; CI's 7-day token hides it.)
 */
export function writeSessionsFile(
  worker: number,
  sessions: Record<string, AuthSession>,
): void {
  fs.mkdirSync(path.dirname(sessionsFileFor(worker)), { recursive: true });
  fs.writeFileSync(sessionsFileFor(worker), JSON.stringify(sessions, null, 2));
  if (worker !== 0) return;
  for (const [email, session] of Object.entries(sessions)) {
    const file = storageStateFileFor(email);
    if (file) {
      fs.writeFileSync(
        file,
        JSON.stringify(buildStorageState(session), null, 2),
      );
    }
  }
}

// Failed logins are cached too: without this, every subsequent test in the
// worker re-attempts the 2FA flow, hammering (and re-heating) the rate
// limiter, which turns one warm-limiter setup failure into a full-suite
// cascade of 429s.
const failureCache = new Map<string, Error>();

/** Authenticate against the API, transparently completing 2FA when required. */
export async function apiLogin(user: SeedUser): Promise<AuthSession> {
  const worker = currentWorkerIndex();
  const key = sessionKey(user.email);
  const cached = sessionCache.get(key) ?? readSessionsFile(worker)[key];
  if (cached) {
    sessionCache.set(key, cached);
    return cached;
  }
  const priorFailure = failureCache.get(key);
  if (priorFailure) throw priorFailure;

  try {
    // No session was minted for this worker (e.g. a `--workers` count above the
    // one global-setup used): log in now rather than fall back to another
    // worker's session, which would reintroduce the sharing this avoids.
    const session = await apiLoginNew(user);
    sessionCache.set(key, session);
    return session;
  } catch (error) {
    failureCache.set(key, error as Error);
    throw error;
  }
}

/**
 * A brand-new session, bypassing every cache: for global-setup (minting the
 * per-worker sessions) and for a test that rotates or revokes its refresh
 * token. Rotating a cached one would leave every other test in the worker
 * holding a refresh token the server has already deleted.
 */
export async function apiLoginNew(user: SeedUser): Promise<AuthSession> {
  return apiLoginUncached(user);
}

/** @deprecated Use {@link apiLoginNew}; kept for existing spec imports. */
export const apiLoginFresh = apiLoginNew;

/**
 * Keep this worker's stored session in step with a rotation the *browser* made.
 *
 * Every test in a worker reuses the one stored session; when a test drives a
 * real `/auth/refresh` through the page, the server deletes the old refresh
 * token and the stored copy goes stale. Call this with the rotated cookies so
 * the next test (or a `--repeat-each` pass, which starts a fresh worker
 * process) reads a live token rather than the one this test just spent.
 */
export function adoptRotatedSession(
  email: string,
  tokens: Pick<AuthSession, "accessToken" | "refreshToken">,
): void {
  const worker = currentWorkerIndex();
  const key = sessionKey(email);
  const stored = readSessionsFile(worker);
  const current = sessionCache.get(key) ?? stored[key];
  if (!current) return;
  const rotated = { ...current, ...tokens };
  sessionCache.set(key, rotated);
  writeSessionsFile(worker, { ...stored, [key]: rotated });
}

/**
 * Rotate a stored session's tokens against `/auth/refresh`, or return null when
 * the token no longer works. The API deletes the presented refresh token on
 * use, so this both validates a session from a previous run and hands back the
 * replacement — the only way a session may be reused across runs (#1144).
 */
export async function refreshSession(
  session: AuthSession,
): Promise<AuthSession | null> {
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-client": "bearer" },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    if (!res.ok) return null;
    const data = (await res.json())?.data;
    if (!data?.accessToken || !data?.refreshToken) return null;
    return {
      ...session,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
    };
  } catch {
    return null;
  }
}

async function apiLoginUncached(user: SeedUser): Promise<AuthSession> {
  const login = await postJson("/auth/login", {
    email: user.email,
    password: user.password,
  });
  const data = login.json?.data;
  if (!data)
    throw new Error(
      `Login failed for ${user.email}: ${JSON.stringify(login.json)}`,
    );

  // Admin accounts are gated behind 2FA; complete it with a fresh TOTP.
  if (data.requiresTwoFactor) {
    const token = await generateTotp({ secret: FIXED_2FA_SECRET });
    const verified = await postJson(
      "/auth/2fa/login",
      { token },
      data.tempToken,
    );
    if (!verified.json?.data?.accessToken) {
      throw new Error(
        `2FA login failed for ${user.email}: ${JSON.stringify(verified.json)}`,
      );
    }
    return {
      ...(verified.json.data as Omit<AuthSession, "csrfToken">),
      csrfToken:
        cookieFromSetCookie(verified.setCookie, CSRF_COOKIE) ?? E2E_CSRF_TOKEN,
      principal: principalFromSetCookie(verified.setCookie),
    };
  }

  if (data.requiresTwoFactorSetup) {
    throw new Error(
      `${user.email} requires 2FA SETUP — seed the API with E2E_FIXED_2FA=1 so admins have a known secret.`,
    );
  }

  if (!data.accessToken) {
    throw new Error(
      `Unexpected login response for ${user.email}: ${JSON.stringify(data)}`,
    );
  }
  return {
    ...(data as Omit<AuthSession, "csrfToken">),
    csrfToken:
      cookieFromSetCookie(login.setCookie, CSRF_COOKIE) ?? E2E_CSRF_TOKEN,
    principal: principalFromSetCookie(login.setCookie),
  };
}

/**
 * Inject a session into the page's origin.
 *
 * Playwright writes the HttpOnly session cookie directly — the browser would
 * refuse `document.cookie` for it, but the context can still hold it — plus the
 * readable CSRF cookie the axios interceptor echoes. localStorage gets only the
 * *user*, the way the (now credential-free) persist store does. Call before
 * navigating to a protected route.
 */
export async function injectSession(page: Page, session: AuthSession) {
  const authStorage = JSON.stringify({
    state: { user: session.user, isAuthenticated: true },
    version: 0,
  });

  const expires = Math.floor(Date.now() / 1000) + 86400;
  const host = new URL(BASE_URL).hostname;
  await page.context().addCookies([
    {
      name: ACCESS_COOKIE,
      value: session.accessToken,
      domain: host,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      expires,
    },
    {
      name: REFRESH_COOKIE,
      value: session.refreshToken,
      domain: host,
      // The API scopes this to the auth endpoints; mirror it, or logout (which
      // clears path /api/auth) leaves a stray /-scoped cookie behind.
      path: "/api/auth",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      expires,
    },
    {
      name: PRINCIPAL_COOKIE,
      value: principalValue(session),
      domain: host,
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
      expires,
    },
    {
      name: CSRF_COOKIE,
      value: session.csrfToken,
      domain: host,
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
      expires,
    },
  ]);

  // localStorage so the store rehydrates the shell. addInitScript runs before
  // app JS on every load, so a reload keeps it.
  await page.addInitScript(
    ([storage]) => {
      localStorage.setItem("auth-storage", storage);
    },
    [authStorage] as const,
  );
}

/**
 * Authenticated JSON request against the real API. For spec data setup /
 * lookup (e.g. find a seeded record's id, create a fixture row, clean up).
 */
export async function apiRequest<T = unknown>(
  session: AuthSession,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  apiPath: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${API_URL}${apiPath}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.accessToken}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `${method} ${apiPath} → ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  if (text === "") return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      `${method} ${apiPath} → non-JSON response: ${text.slice(0, 120)}`,
    );
  }
}

/** Convenience: log in as a seed role and inject the session into the page. */
export async function loginAs(
  page: Page,
  role: SeedRole,
): Promise<AuthSession> {
  const session = await apiLogin(SEED_USERS[role]);
  await injectSession(page, session);
  return session;
}

/**
 * Build a Playwright storageState object for a session, mirroring injectSession
 * (cookies the middleware reads + the zustand-persisted localStorage). Used by
 * global-setup to write `.auth/<role>.json` so specs can `test.use({ storageState })`.
 */
export function buildStorageState(session: AuthSession) {
  const origin = new URL(BASE_URL).origin;
  const authStorage = JSON.stringify({
    state: { user: session.user, isAuthenticated: true },
    version: 0,
  });
  const expires = Math.floor(Date.now() / 1000) + 86400;
  return {
    cookies: [
      {
        name: ACCESS_COOKIE,
        value: session.accessToken,
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      },
      {
        name: REFRESH_COOKIE,
        value: session.refreshToken,
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      },
      {
        name: PRINCIPAL_COOKIE,
        value: principalValue(session),
        httpOnly: true,
        secure: false,
        sameSite: "Lax" as const,
      },
      {
        name: CSRF_COOKIE,
        value: session.csrfToken,
        httpOnly: false,
        secure: false,
        sameSite: "Lax" as const,
      },
    ].map((c) => ({
      ...c,
      domain: new URL(BASE_URL).hostname,
      path: c.name === REFRESH_COOKIE ? "/api/auth" : "/",
      expires,
    })),
    origins: [
      {
        origin,
        localStorage: [{ name: "auth-storage", value: authStorage }],
      },
    ],
  };
}
