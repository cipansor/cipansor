import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import request from 'supertest';

const { queryRaw } = vi.hoisted(() => ({ queryRaw: vi.fn(async () => [{ '?column?': 1 }]) }));
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: queryRaw } }));
vi.mock('@/lib/redis', () => ({ redis: {} }));

import { app } from './app';
import { CACHE_MS, TIMEOUT_MS, databaseReady, resetDatabaseReady } from '@/lib/database-ready';

/**
 * The Azure release workflows wait until GET /health reports the commit they
 * released (deploy/azure/wait-for-release.sh). If `commit` stopped reflecting
 * GIT_COMMIT_SHA, every release would time out; if it reported something else,
 * a release could pass while the old code was still answering.
 *
 * /health is also the readiness signal (#665): it must probe the database and
 * answer 503 when Postgres is unreachable. The regression assertion is
 * `$queryRaw` having been called — on the old static handler it was never
 * touched, so this file failed before the fix.
 */
// Each case asks the database afresh; the kept answer is its own case below.
beforeEach(() => {
  resetDatabaseReady();
  queryRaw.mockClear();
});

describe('GET /health', () => {
  const original = process.env.GIT_COMMIT_SHA;
  afterEach(() => {
    if (original === undefined) delete process.env.GIT_COMMIT_SHA;
    else process.env.GIT_COMMIT_SHA = original;
  });

  it('reports the commit the image was built from', async () => {
    process.env.GIT_COMMIT_SHA = '0123456789abcdef0123456789abcdef01234567';
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.commit).toBe('0123456789abcdef0123456789abcdef01234567');
    // The readiness signal: the database was actually probed.
    expect(queryRaw).toHaveBeenCalled();
  });

  it('reports null when the image was built without one', async () => {
    delete process.env.GIT_COMMIT_SHA;
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.commit).toBeNull();
  });

  // The bug in #665: the body was static, so a DB-less instance answered 200
  // and a load balancer or the release workflow kept routing traffic to it.
  it('answers 503 (not-ready) when the database is unreachable', async () => {
    queryRaw.mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('unavailable');
    expect(res.body.database).toBe('unreachable');
    // Still says which code answered, so a release log shows it.
    expect(res.body).toHaveProperty('commit');
  });
});

/**
 * /health is public and not rate limited, and the release workflow and App
 * Service Health check poll it, so the database probe is bounded: it gives up
 * after TIMEOUT_MS, and one answer serves every request for CACHE_MS.
 */
describe('GET /health — the database probe is bounded', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a database that never answers is "not ready" after the timeout, not later', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    queryRaw.mockImplementationOnce(() => new Promise(() => undefined));
    let answer: boolean | undefined;
    void databaseReady().then((ready) => (answer = ready));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(answer).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(answer).toBe(false);
  });

  it('many requests within the window cost one query', async () => {
    const answers = await Promise.all(
      Array.from({ length: 20 }, () => request(app).get('/health'))
    );
    expect(answers.every((r) => r.status === 200)).toBe(true);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('asks again once the kept answer is older than the window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    queryRaw.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));
    expect((await request(app).get('/health')).status).toBe(503);
    expect((await request(app).get('/health')).status).toBe(503); // kept
    vi.setSystemTime(Date.now() + CACHE_MS);
    expect((await request(app).get('/health')).status).toBe(200); // recovered
    expect(queryRaw).toHaveBeenCalledTimes(2);
  });
});

/**
 * `environment` is the deployed copy (`config.appEnv`), not `NODE_ENV`. Both
 * staging and production compile with `NODE_ENV=production`, so a debugger on
 * staging used to read "production" from this field and draw the wrong
 * conclusion. The distinction lives in `resolveAppEnv`; this pins that /health
 * exposes it, and keeps `nodeEnv` for what it actually means.
 */
describe('GET /health environment', () => {
  it('reports the deployed copy and the build mode as separate fields', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('environment');
    expect(res.body).toHaveProperty('nodeEnv');
    expect(['local', 'staging', 'production']).toContain(res.body.environment);
    expect(typeof res.body.nodeEnv).toBe('string');
  });
});
