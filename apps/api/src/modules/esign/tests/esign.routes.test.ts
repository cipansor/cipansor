import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/redis', () => ({ redis: {} }));

import router from '../esign.routes';
import { isSuperAdmin } from '@/middleware/auth';

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: (...args: unknown[]) => unknown; name: string }>;
  };
}

function handlersFor(method: string, path: string) {
  const layer = (router.stack as unknown as RouteLayer[]).find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  if (!layer?.route) throw new Error(`No route for ${method.toUpperCase()} ${path}`);
  return layer.route.stack;
}

/**
 * express-rate-limit hangs `resetKey`/`getKey` on the middleware it returns.
 * Recognising the limiter by those rather than by identity keeps the test from
 * needing the module to export it just to be checked.
 */
function isRateLimiter(handle: unknown): boolean {
  return (
    typeof handle === 'function' &&
    typeof (handle as { resetKey?: unknown }).resetKey === 'function'
  );
}

function hasLimiter(method: string, path: string) {
  return handlersFor(method, path).some((h) => isRateLimiter(h.handle));
}

/**
 * Public routes are those registered before `router.use(authenticate)`, so
 * they sit at a lower index in the stack than that middleware layer.
 */
function isPublicRoute(method: string, path: string) {
  const stack = router.stack as unknown as Array<RouteLayer & { name?: string }>;
  const authIndex = stack.findIndex((l) => !l.route && l.name === 'authenticate');
  const routeIndex = stack.findIndex(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  if (routeIndex === -1) throw new Error(`No route for ${method.toUpperCase()} ${path}`);
  return authIndex === -1 || routeIndex < authIndex;
}

function hasRoute(method: string, path: string) {
  return (router.stack as unknown as RouteLayer[]).some(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
}

/**
 * Every route that carries a passphrase or handles public uploads must carry rate limiting.
 */
describe('esign.routes rate limiting', () => {
  it('POST /letters/:letterId/sign is rate limited', () => {
    expect(hasLimiter('post', '/letters/:letterId/sign')).toBe(true);
  });

  it('POST /me/activate is rate limited', () => {
    expect(hasLimiter('post', '/me/activate')).toBe(true);
  });

  it('POST /me/passphrase is rate limited', () => {
    expect(hasLimiter('post', '/me/passphrase')).toBe(true);
  });

  /**
   * The settings page reads this on every visit and it holds nothing guessable.
   */
  it('GET /me is NOT rate limited', () => {
    expect(hasLimiter('get', '/me')).toBe(false);
  });

  /**
   * A token-only verification endpoint must not exist.
   *
   * It answers "this letter is valid" from a database row alone, so it says
   * nothing about the document the asker is actually holding — a forger keeps
   * the genuine QR, edits the body, and the endpoint still says yes. Public
   * verification binds to the uploaded bytes instead, and this test is what
   * stops the convenient shortcut from being added back.
   */
  it('exposes no token-based verification route', () => {
    expect(hasRoute('get', '/verify/:token')).toBe(false);
    expect(hasRoute('post', '/verify/:token')).toBe(false);
  });

  it('POST /verify-pdf is rate limited', () => {
    expect(hasLimiter('post', '/verify-pdf')).toBe(true);
  });

  /**
   * The public key-status service answers about a key, never about a letter —
   * so it earns a public route of its own. It must be reachable without a
   * session (a recipient checking an old archive has none) and must carry the
   * public rate limiter, since its input is unauthenticated.
   */
  it('GET /public/key-status is public and rate limited', () => {
    expect(hasRoute('get', '/public/key-status')).toBe(true);
    expect(isPublicRoute('get', '/public/key-status')).toBe(true);
    expect(hasLimiter('get', '/public/key-status')).toBe(true);
  });

  /**
   * The key-status route must not grow into a document-verification route by
   * another name: it takes a fingerprint, and it must never take a token.
   */
  it('key-status does not accept a token parameter', () => {
    expect(hasRoute('get', '/public/key-status/:token')).toBe(false);
  });
});

/**
 * Only a Super Admin issues, refuses or revokes signing keys.
 */
describe('esign.routes authority gates', () => {
  it('GET /requests requires isSuperAdmin', () => {
    expect(handlersFor('get', '/requests').some((h) => h.handle === isSuperAdmin)).toBe(true);
  });

  it('POST /requests/:id/decide requires isSuperAdmin', () => {
    expect(handlersFor('post', '/requests/:id/decide').some((h) => h.handle === isSuperAdmin)).toBe(
      true
    );
  });

  it('POST /keys/:userId/revoke requires isSuperAdmin', () => {
    expect(handlersFor('post', '/keys/:userId/revoke').some((h) => h.handle === isSuperAdmin)).toBe(
      true
    );
  });

  /**
   * The key inventory names every holder of a signing authority, so it is
   * Super Admin's alone — and it exists only because revoking one requires
   * being able to see it first.
   */
  it('GET /keys requires isSuperAdmin', () => {
    expect(handlersFor('get', '/keys').some((h) => h.handle === isSuperAdmin)).toBe(true);
  });

  /**
   * Revoking a letter's signature deliberately does NOT sit behind
   * `isSuperAdmin`: a signer may withdraw their own signature. The authority
   * check is made in the service against the signature row, which is the only
   * place that knows who signed this particular letter — so the guard here is
   * that the route stays authenticated and never becomes public.
   */
  /**
   * Revoking a naskah is not behind `isSuperAdmin` — and precisely because
   * Super Admin must NOT be able to. Authority to revoke follows authority to
   * issue: it belongs to the signing office, checked in the service against the
   * signature row. Guarding this route with `isSuperAdmin` would hand the
   * annulment of a Ketua's SK to whoever administers the servers.
   */
  it('POST /letters/:letterId/revoke is authenticated but not Super-Admin-only', () => {
    expect(hasRoute('post', '/letters/:letterId/revoke')).toBe(true);
    expect(
      handlersFor('post', '/letters/:letterId/revoke').some((h) => h.handle === isSuperAdmin)
    ).toBe(false);
    // Paired with the assertion below so this reads as a real discrimination
    // and not a helper that answers "not public" to everything.
    expect(isPublicRoute('post', '/letters/:letterId/revoke')).toBe(false);
    expect(isPublicRoute('post', '/verify-pdf')).toBe(true);
  });

  /**
   * Revoking carries a passphrase, so it must be rate limited like signing.
   * A revocation is a signed statement, not a status change — the same
   * guessing surface as the signature itself.
   */
  it('POST /letters/:letterId/revoke is rate limited', () => {
    expect(hasLimiter('post', '/letters/:letterId/revoke')).toBe(true);
  });

  it('POST /revocation-requests/:id/decide is rate limited', () => {
    expect(hasLimiter('post', '/revocation-requests/:id/decide')).toBe(true);
  });

  /**
   * Asking for a revocation is open to anyone who may read the letter — the
   * clerk who spots the duplicate number is rarely the officer who may annul
   * it — but it is never public, and it never carries a passphrase, because
   * nothing changes until the request is decided.
   */
  it('requesting a revocation is authenticated, un-gated and passphrase-free', () => {
    expect(hasRoute('post', '/letters/:letterId/revocation-requests')).toBe(true);
    expect(isPublicRoute('post', '/letters/:letterId/revocation-requests')).toBe(false);
    expect(
      handlersFor('post', '/letters/:letterId/revocation-requests').some(
        (h) => h.handle === isSuperAdmin
      )
    ).toBe(false);
    expect(hasLimiter('post', '/letters/:letterId/revocation-requests')).toBe(false);
  });
});
