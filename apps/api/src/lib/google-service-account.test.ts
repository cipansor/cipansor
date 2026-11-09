import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { buildAssertion, ServiceAccountTokenSource } from './google-service-account';

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const credentials = {
  clientEmail: 'mailer@project.iam.gserviceaccount.com',
  privateKey: PRIVATE_PEM,
  subject: 'noreply@cipansor.or.id',
  scopes: ['https://www.googleapis.com/auth/gmail.send'],
};

function decodeSegment(segment: string) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

describe('buildAssertion', () => {
  it('produces a signature Google can verify with the matching public key', () => {
    const assertion = buildAssertion(credentials, 1_700_000_000);
    const [header, claims, signature] = assertion.split('.');

    const verified = crypto.verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${claims}`),
      publicKey,
      Buffer.from(signature, 'base64url')
    );

    expect(verified).toBe(true);
  });

  it('claims the impersonated mailbox and only the send scope', () => {
    const assertion = buildAssertion(credentials, 1_700_000_000);
    const [, claims] = assertion.split('.');
    const payload = decodeSegment(claims);

    expect(payload.iss).toBe('mailer@project.iam.gserviceaccount.com');
    // `sub` is the domain-wide-delegation part: the service account has no
    // mailbox, so it asks to act as this user.
    expect(payload.sub).toBe('noreply@cipansor.or.id');
    expect(payload.scope).toBe('https://www.googleapis.com/auth/gmail.send');
    expect(payload.aud).toBe('https://oauth2.googleapis.com/token');
  });

  it('never asks for more than the hour Google allows', () => {
    const now = 1_700_000_000;
    const payload = decodeSegment(buildAssertion(credentials, now).split('.')[1]);

    expect(payload.iat).toBe(now);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(3600);
  });
});

describe('ServiceAccountTokenSource', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('caches the token instead of buying one per message', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const source = new ServiceAccountTokenSource(credentials);

    expect(await source.getAccessToken()).toBe('tok-1');
    expect(await source.getAccessToken()).toBe('tok-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('collapses a burst of concurrent requests into one token exchange', async () => {
    // The shape this guards: an announcement fans out dozens of sends at once,
    // and without the in-flight promise each one opens its own token request.
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ access_token: 'tok-1', expires_in: 3600 }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const source = new ServiceAccountTokenSource(credentials);
    const tokens = await Promise.all(Array.from({ length: 20 }, () => source.getAccessToken()));

    expect(new Set(tokens)).toEqual(new Set(['tok-1']));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the cached token is inside the refresh margin', async () => {
    let issued = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        issued += 1;
        // A 30-second token is already inside the 60-second margin.
        return new Response(JSON.stringify({ access_token: `tok-${issued}`, expires_in: 30 }), {
          status: 200,
        });
      })
    );

    const source = new ServiceAccountTokenSource(credentials);

    expect(await source.getAccessToken()).toBe('tok-1');
    expect(await source.getAccessToken()).toBe('tok-2');
  });

  it('bounds the token exchange so it cannot outlive the delivery claim', async () => {
    // An unbounded token fetch could hang past the channel claim's one-hour
    // lease, leaving the send that holds the claim with no outcome to record
    // (review finding on #804). Asserting only that a signal is attached would
    // pass for a signal with no deadline, so the deadline is pinned to the real
    // 30 s and the abort is actually driven: `AbortSignal.timeout` schedules on
    // a native timer vitest's fake timers do not control, so the deadline is
    // shrunk (keeping the requested value under observation) and awaited for
    // real.
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeoutSpy = vi
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation((ms: number) => realTimeout(Math.min(ms, 20)));

    const fetchMock = vi.fn(
      (_url: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason ?? new Error('aborted'))
          );
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    const source = new ServiceAccountTokenSource(credentials);

    await expect(source.getAccessToken()).rejects.toThrow();
    // The requested bound is the module's own 30 s, not whatever was mocked in.
    expect(timeoutSpy.mock.calls[0][0]).toBe(30_000);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal?.aborted).toBe(true);
  });

  it('reports the reason Google gave rather than a bare failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: 'unauthorized_client',
              error_description:
                'Client is unauthorized to retrieve access tokens using this method',
            }),
            { status: 401 }
          )
      )
    );

    const source = new ServiceAccountTokenSource(credentials);

    // This is the error a Workspace admin sees when the client ID has not been
    // granted the scope, and saying so is the difference between a five-minute
    // fix and an afternoon.
    await expect(source.getAccessToken()).rejects.toThrow(/unauthorized to retrieve access tokens/);
  });
});
