/**
 * Session bootstrapping shared by every visual/QA script.
 *
 * `storageStateFor` existed twice — once in `screenshot-all.ts` and a slimmer,
 * subtly different copy in `probe-pages.ts` — and the two drifted. Keeping one
 * definition here means a change to the session shape reaches every script at
 * once.
 *
 * The API signs a browser in with HttpOnly cookies (`cipansor_at` et al.), not
 * a token the page's JavaScript can read. So the session is captured *from the
 * API's own `Set-Cookie` headers* and handed to Playwright verbatim — a
 * hand-built `accessToken` cookie the API never reads is what silently bounced
 * every sweep page back to `/login`. Only `auth-storage` (the user the zustand
 * store rehydrates) is written by hand.
 */
import { DEMO_ACCOUNTS } from "@cipansor/shared";
import { generate as generateTotp } from "otplib";
import { parseSetCookies } from "./set-cookie";

export const API_URL = process.env.API_URL || "http://localhost:3001/api";
export const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

/** The fixed secret the seed writes when `E2E_FIXED_2FA=1` (see seed.ts). */
const FIXED_2FA_SECRET =
  process.env.E2E_2FA_SECRET || "NTGHH5U5LDHIYARFFNGFQKQHARJU7GBE";

/** A cookie exactly as the API set it, ready for Playwright's `addCookies`. */
export interface SessionCookie {
  name: string;
  value: string;
  path: string;
}

export interface Session {
  accessToken: string;
  refreshToken?: string;
  user: Record<string, any>;
  /** The API's own session cookies, captured from its `Set-Cookie` headers. */
  cookies: SessionCookie[];
}

/** The cookie paths the API scopes its session cookies to. */
const REFRESH_COOKIE_PATH = "/api/auth";

/** Parse a response's `Set-Cookie` fields down to name/value/path. */
function sessionCookies(res: Response): SessionCookie[] {
  return parseSetCookies(res.headers).map((c) => ({
    name: c.name,
    value: c.value,
    // The refresh cookie is scoped to the auth endpoints; the rest to `/`.
    path: c.name === "cipansor_rt" ? REFRESH_COOKIE_PATH : "/",
  }));
}

export async function loginAs(roleCode: string): Promise<Session> {
  const acc = DEMO_ACCOUNTS.find((a) => a.roleCode === roleCode);
  if (!acc) throw new Error(`no demo account for ${roleCode}`);

  const res = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Ask for the tokens in the body too; the browser path returns no token a
      // script could reuse, only HttpOnly cookies.
      "x-client": "bearer",
    },
    body: JSON.stringify({ email: acc.email, password: acc.password }),
  });
  const cookies = sessionCookies(res);
  const login = (await res.json()) as { data?: Record<string, any> };
  const data = login.data;

  // Admin and organ accounts sit behind a 2FA gate. Seed with E2E_FIXED_2FA=1
  // and the challenge is answerable from the fixed secret, so a sweep script
  // can still log in unattended.
  if (data?.requiresTwoFactor) {
    const token = await generateTotp({ secret: FIXED_2FA_SECRET });
    const verifyRes = await fetch(`${API_URL}/auth/2fa/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-client": "bearer",
        authorization: `Bearer ${data.tempToken}`,
      },
      body: JSON.stringify({ token }),
    });
    const verifiedCookies = sessionCookies(verifyRes);
    const verified = (await verifyRes.json()) as { data?: Record<string, any> };
    if (!verified.data?.accessToken) {
      throw new Error(
        `2FA failed for ${roleCode}: ${JSON.stringify(verified)}`,
      );
    }
    return { ...(verified.data as Session), cookies: verifiedCookies };
  }

  if (!data?.accessToken) {
    throw new Error(`login failed for ${roleCode}: ${JSON.stringify(login)}`);
  }
  return { ...(data as Session), cookies };
}

export function storageStateFor(session: Session) {
  const { origin, hostname } = new URL(BASE_URL);
  const expires = Math.floor(Date.now() / 1000) + 86400;

  const cookies = session.cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: hostname,
    path: c.path,
    expires,
    // The CSRF cookie is the one the axios interceptor echoes; it must stay
    // readable by page JS. Every other session cookie is HttpOnly.
    httpOnly: c.name !== "cipansor_csrf",
    secure: false,
    sameSite: "Lax" as const,
  }));

  return {
    cookies,
    origins: [
      {
        origin,
        localStorage: [
          {
            name: "auth-storage",
            value: JSON.stringify({
              state: { user: session.user, isAuthenticated: true },
              version: 0,
            }),
          },
        ],
      },
    ],
  };
}
