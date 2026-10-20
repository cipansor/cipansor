/**
 * Google service-account access tokens (JWT-bearer flow).
 *
 * Implements the two steps Google documents for server-to-server auth:
 *
 *   1. sign a JWT assertion with the service account's RSA private key, and
 *   2. exchange it at https://oauth2.googleapis.com/token for an access token.
 *
 * WHY BY HAND, RATHER THAN `google-auth-library`. Everything here is 40 lines
 * of `node:crypto` against a stable, published spec, and it costs the API image
 * nothing. The library would add a dependency tree (gaxios, gtoken, jws,
 * gcp-metadata) to a container that already ships a Prisma engine, for a single
 * RS256 signature we can make with the standard library. Note what this file
 * does NOT do: it never *verifies* a token, so none of the usual hand-rolled-JWT
 * hazards (algorithm confusion, skipped signature checks) apply. It signs an
 * assertion with a key we own and hands it to Google, who does the verifying.
 *
 * `subject` is the domain-wide-delegation part: the service account has no
 * mailbox of its own, so it asks to act *as* a real Workspace user. That
 * impersonation is what the Workspace admin authorises, per scope, in
 * Admin console → Security → API controls → Domain-wide delegation.
 */

import crypto from 'crypto';
import { logger } from './logger';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const JWT_BEARER_GRANT = 'urn:ietf:params:oauth:grant-type:jwt-bearer';

/**
 * Bound the token exchange so it cannot outlive the delivery claim that guards
 * the send (review finding on #804). An unbounded `fetch` to the token endpoint
 * could hang past the one-hour channel lease, and the send holding the claim
 * would never report an outcome. Well under that lease, so a stalled exchange
 * fails cleanly and the channel is retried.
 */
const TOKEN_REQUEST_TIMEOUT_MS = 30_000;

/** Google rejects an assertion whose lifetime exceeds one hour. */
const ASSERTION_LIFETIME_SECONDS = 3600;

/**
 * Refresh this many seconds before the token actually expires, so a request
 * that starts just under the wire does not finish just over it.
 */
const REFRESH_MARGIN_SECONDS = 60;

export interface ServiceAccountCredentials {
  /** `client_email` from the service account's JSON key. */
  clientEmail: string;
  /** `private_key` from the JSON key, with real newlines. */
  privateKey: string;
  /** The Workspace user to impersonate (domain-wide delegation). */
  subject: string;
  /** OAuth scopes, e.g. `https://www.googleapis.com/auth/gmail.send`. */
  scopes: string[];
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/**
 * Build and sign the JWT assertion. Exported for tests: it is pure, so its
 * output can be checked against the private key without touching the network.
 */
export function buildAssertion(
  credentials: ServiceAccountCredentials,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): string {
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: credentials.clientEmail,
    sub: credentials.subject,
    scope: credentials.scopes.join(' '),
    aud: TOKEN_ENDPOINT,
    iat: nowSeconds,
    exp: nowSeconds + ASSERTION_LIFETIME_SECONDS,
  };

  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), credentials.privateKey);

  return `${unsigned}.${base64url(signature)}`;
}

interface CachedToken {
  accessToken: string;
  /** Unix seconds. */
  expiresAt: number;
}

/**
 * Mints and caches access tokens for one service account identity.
 *
 * Google's tokens last an hour and every e-mail would otherwise buy a fresh
 * one, so the token is held until it is nearly expired. The in-flight promise
 * is cached too: an announcement blast fans out dozens of sends at once, and
 * without this they would each open their own token request.
 */
export class ServiceAccountTokenSource {
  private cached: CachedToken | null = null;
  private inFlight: Promise<string> | null = null;

  constructor(private readonly credentials: ServiceAccountCredentials) {}

  /** Drop the cached token — used by tests and after a config change. */
  reset(): void {
    this.cached = null;
    this.inFlight = null;
  }

  async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    if (this.cached && this.cached.expiresAt - REFRESH_MARGIN_SECONDS > now) {
      return this.cached.accessToken;
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.fetchToken(now).finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  private async fetchToken(nowSeconds: number): Promise<string> {
    const assertion = buildAssertion(this.credentials, nowSeconds);

    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: JWT_BEARER_GRANT, assertion }).toString(),
      signal: AbortSignal.timeout(TOKEN_REQUEST_TIMEOUT_MS),
    });

    const body = (await response.json().catch(() => null)) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    } | null;

    if (!response.ok || !body?.access_token) {
      // `unauthorized_client` here almost always means the client ID was not
      // granted this scope in the Admin console, or `subject` is not a real
      // user in the domain — not that the key is wrong.
      const detail = body?.error_description || body?.error || `HTTP ${response.status}`;
      logger.error('Google service-account token request failed', {
        subject: this.credentials.subject,
        detail,
      });
      throw new Error(`Google token request failed: ${detail}`);
    }

    this.cached = {
      accessToken: body.access_token,
      expiresAt: nowSeconds + (body.expires_in ?? ASSERTION_LIFETIME_SECONDS),
    };

    return body.access_token;
  }
}
