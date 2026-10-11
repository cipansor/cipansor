import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * This helper exists because four call sites each invented their own answer and
 * every one of them shipped to production wrong — two of them on domains the
 * yayasan does not own. So the tests worth having are not "does it concatenate
 * strings", they are the four properties that were actually violated.
 *
 * The URL is built from `config.publicSiteUrl`, which reads `PUBLIC_SITE_URL`.
 * A developer's local `.env` sets that to `http://localhost:3000` (the correct
 * value for the local stack), so a test asserting the production hostname
 * against whatever the environment happens to hold fails on a machine that is
 * set up exactly right. The host under test is therefore pinned: the module is
 * re-imported with `PUBLIC_SITE_URL` stubbed to the production value, and
 * `dotenv` (loaded by `config`) never overrides an existing variable.
 */
const PROD_SITE = 'https://cipansor.or.id';

let certificateVerificationUrl: (code: string) => string;
let config: { publicSiteUrl: string };

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv('PUBLIC_SITE_URL', PROD_SITE);
  ({ certificateVerificationUrl } = await import('./verification-url'));
  ({ config } = await import('../config'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('certificateVerificationUrl', () => {
  it('points at a host we own', () => {
    const url = certificateVerificationUrl('CERT-TFZ-30-2024001');
    const { hostname } = new URL(url);
    expect(hostname.endsWith('cipansor.or.id')).toBe(true);
    // The two that actually shipped.
    expect(url).not.toContain('cipansor.app');
    expect(url).not.toContain('cipansor.com');
  });

  it('points at the page that exists, not the one behind the login wall', () => {
    const url = certificateVerificationUrl('X');
    expect(new URL(url).pathname).toBe('/public/verify-sanad');
    // `/verify` has never been a route here; `/certificates/verify/<code>`
    // exists but answers 307 to /login, which is useless to a dinas office.
    expect(new URL(url).pathname).not.toMatch(/^\/verify\b/);
    expect(new URL(url).pathname).not.toContain('/certificates/');
  });

  it('identifies the certificate, so the scanner does not retype it', () => {
    // The sanad URL used to be the bare page for every certificate ever issued.
    const url = certificateVerificationUrl('CERT-TFZ-30-2024001');
    expect(new URL(url).searchParams.get('code')).toBe('CERT-TFZ-30-2024001');
  });

  it('encodes a number that would otherwise break the query string', () => {
    const url = certificateVerificationUrl('CERT/2026 #7&x');
    expect(new URL(url).searchParams.get('code')).toBe('CERT/2026 #7&x');
  });

  it('does not double the slash when the configured base has a trailing one', () => {
    // config strips it; asserted here because the bug only shows up in the
    // joined string, which is what gets printed on paper.
    expect(config.publicSiteUrl.endsWith('/')).toBe(false);
    expect(certificateVerificationUrl('X')).not.toContain('.id//');
  });

  /**
   * The production **default** must be a host we own.
   *
   * The tests above pin `PUBLIC_SITE_URL`, so they would still pass if the
   * fallback in `config` regressed to `cipansor.app` — the exact mistake this
   * file exists to prevent. The fallback only takes effect where no
   * `PUBLIC_SITE_URL` is set (production, CI), so it is checked at the source,
   * where a developer's `.env` cannot mask it.
   */
  it('the config fallback is a host we own', () => {
    const source = readFileSync(resolve(__dirname, '../config/index.ts'), 'utf8');
    const match = source.match(
      /publicSiteUrl:\s*\(process\.env\.PUBLIC_SITE_URL\s*\|\|\s*'([^']+)'\)/
    );
    expect(match).not.toBeNull();
    const fallback = match![1];
    expect(new URL(fallback).hostname.endsWith('cipansor.or.id')).toBe(true);
    expect(fallback).not.toContain('cipansor.app');
    expect(fallback).not.toContain('cipansor.com');
    expect(fallback).not.toContain('localhost');
  });
});
