/**
 * Authenticated read scenario.
 *
 * Reads protected endpoints with a bearer token. It exists to measure *the
 * authenticated* reads, so it fails rather than silently measuring anonymous
 * 401s: every endpoint requires 200, and a missing or expired token aborts the
 * run (see setup()).
 *
 * Needs credentials:
 *
 *   LOAD_TEST_EMAIL / LOAD_TEST_PASSWORD   a demo account on the target
 *
 * Without them the scenario throws in setup(), which makes k6 write no summary
 * and the runner exit 2 — "could not run", never a fabricated anonymous green.
 * Use public-smoke.js for the anonymous path.
 *
 * On the Cipansor API a browser login is also gated by Cloudflare Turnstile
 * (`requireTurnstile('login')`) and 2FA. Two ways through, both deliberate:
 *
 *   1. A target where Turnstile is not configured (`TURNSTILE_SECRET_KEY`
 *      unset — the local dev stack). A normal email/password login then works.
 *   2. `X-Client: bearer` (see docs/MOBILE_API.md), which asks the API to
 *      return `accessToken`/`refreshToken` in the body for a non-browser
 *      client. Turnstile is a *browser* gate; a bearer client is not expected
 *      to solve it. Whether the target still demands it is the target's
 *      policy, not this script's.
 *
 * If a login answers `requiresTwoFactor`/`requiresTwoFactorSetup`/
 * `requiresPasswordChange`, there is no token for a script to use; that is a
 * "could not run", not an anonymous pass. It never fabricates a token.
 *
 * Rate limiting: as in public-smoke.js, a 429 is counted in `rate_limited` and
 * the runner refuses a baseline from a throttled run. `setup()` makes one login
 * attempt, and the API's credential limiter (10/min by default) would answer
 * 429 to a repeated login, not 401 — the scenario treats that as "no token".
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { thresholdsFor, PROFILES } from '../config.js';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
const EMAIL = __ENV.LOAD_TEST_EMAIL;
const PASSWORD = __ENV.LOAD_TEST_PASSWORD;
const profile = PROFILES[__ENV.PROFILE] || PROFILES.smoke;
const baseline = __ENV.BASELINE_JSON ? JSON.parse(__ENV.BASELINE_JSON) : null;

// See public-smoke.js: a request is only comparable when it was expected, so
// only a 200 (this scenario's pass) feeds the latency series.
const unexpectedResponses = new Counter('unexpected_responses');
const expectedResponses = new Counter('expected_responses');
const rateLimited = new Counter('rate_limited');
const expectedDuration = new Trend('expected_response_duration', true);

export const options = {
  ...profile,
  thresholds: thresholdsFor(baseline),
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(95)', 'p(99)'],
};

// The authenticated reads. Each must answer 200: a 401 means the token was
// missing or expired and the run measured nothing about authenticated access.
const ENDPOINTS = [
  { name: 'auth-me', path: '/api/auth/me' },
  { name: 'dashboard-quick-stats', path: '/api/dashboard/quick-stats' },
  { name: 'dashboard-stats', path: '/api/dashboard/stats' },
  { name: 'students', path: '/api/students?page=1&limit=10' },
  { name: 'classes', path: '/api/classes?page=1&limit=10' },
];

function login() {
  if (!EMAIL || !PASSWORD) return null;
  const res = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Client': 'bearer' },
      tags: { name: 'auth-login' },
    }
  );
  if (res.status !== 200) return null;
  let body;
  try {
    body = res.json();
  } catch (_e) {
    return null;
  }
  const data = body && body.data ? body.data : {};
  return data.accessToken || null;
}

export function setup() {
  if (!EMAIL || !PASSWORD) {
    // A throw aborts the whole run before any iteration: k6 writes no summary
    // and the runner exits 2. That is the honest answer for a scenario whose
    // subject (authenticated reads) cannot be reached without a session.
    throw new Error('authenticated-read needs LOAD_TEST_EMAIL / LOAD_TEST_PASSWORD');
  }
  const token = login();
  if (!token) {
    throw new Error(
      'login did not return an accessToken (2FA, Turnstile, or bad credentials) — cannot measure authenticated reads'
    );
  }
  return { token };
}

export default function (data) {
  const headers = { Accept: 'application/json', Authorization: `Bearer ${data.token}` };
  for (const endpoint of ENDPOINTS) {
    const res = http.get(`${BASE_URL}${endpoint.path}`, { headers, tags: { name: endpoint.name } });
    const ok = res.status === 200;
    if (res.status === 429) rateLimited.add(1);
    else if (ok) expectedDuration.add(res.timings.duration);
    if (ok) expectedResponses.add(1);
    else unexpectedResponses.add(1);
    check(res, {
      [`${endpoint.name} -> 200`]: () => ok,
    });
  }
  // Stay under the API's 100 req/min/IP limiter; see public-smoke.js.
  sleep(0.5);
}

export function teardown() {
  // Nothing to clean up: this scenario only reads.
}
