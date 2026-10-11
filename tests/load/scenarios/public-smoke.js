/**
 * Public smoke load scenario.
 *
 * Safe to point at any environment, including staging: it is one VU, a
 * handful of iterations, and it never writes. It exercises the routes that
 * are reachable without a session:
 *
 *   /healthz    the API's health route through nginx on a deployed host;
 *               `/health` on the local stack, where the API answers directly
 *               (`healthPathFor` in config.js; HEALTH_PATH overrides it).
 *   /api/auth/me                  protected — 401 without a session is the correct answer
 *   /api/dashboard/quick-stats    protected — 401 without a session
 *   /api/students                 protected — 401 without a session
 *
 * An expected 401 counts as a pass. The point of the smoke run is to record
 * the latency and connection behaviour of the edge and the API under a trickle
 * of traffic; whether a session is present is a separate question, answered by
 * the authenticated scenario when credentials are supplied.
 *
 * Rate limiting: the API mounts a global limiter of 100 requests/minute per IP
 * (apps/api/src/middleware/rate-limit.ts, config.rateLimit). A run that trips
 * it is measuring the limiter, not the app, so a 429 is counted separately in
 * `rate_limited` and the runner refuses to record or compare a baseline from a
 * throttled run. The smoke profile stays under the budget on purpose.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';
import { thresholdsFor, PROFILES, healthPathFor } from '../config.js';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
const profile = PROFILES[__ENV.PROFILE] || PROFILES.smoke;
const baseline = __ENV.BASELINE_JSON ? JSON.parse(__ENV.BASELINE_JSON) : null;

// k6's built-in `http_req_failed` counts every non-2xx/3xx response as a
// failure, so the 401s this scenario expects would read as a 75% error rate.
// These two counters let the runner compute the real error rate instead.
const unexpectedResponses = new Counter('unexpected_responses');
const expectedResponses = new Counter('expected_responses');
const rateLimited = new Counter('rate_limited');
// The one latency series the thresholds and the runner both read — only
// expected (non-429) responses, see config.js thresholdsFor().
const expectedDuration = new Trend('expected_response_duration', true);

export const options = {
  ...profile,
  thresholds: thresholdsFor(baseline),
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(50)', 'p(95)', 'p(99)'],
};

const ENDPOINTS = [
  { name: 'health', path: healthPathFor(BASE_URL, __ENV.HEALTH_PATH), expect: [200] },
  { name: 'auth-me', path: '/api/auth/me', expect: [200, 401] },
  { name: 'dashboard-quick-stats', path: '/api/dashboard/quick-stats', expect: [200, 401] },
  { name: 'students', path: '/api/students?page=1&limit=10', expect: [200, 401] },
];

export default function () {
  for (const endpoint of ENDPOINTS) {
    const res = http.get(`${BASE_URL}${endpoint.path}`, {
      tags: { name: endpoint.name },
      headers: { Accept: 'application/json' },
    });
    const ok = endpoint.expect.includes(res.status);
    if (res.status === 429) rateLimited.add(1);
    // Only an expected response's latency is comparable to the baseline: an
    // unexpected status (a 404, a 500) can be faster or slower for reasons that
    // have nothing to do with the app's real latency, so mixing it in skews the
    // percentile the thresholds and the comparison read.
    else if (ok) expectedDuration.add(res.timings.duration);
    if (ok) expectedResponses.add(1);
    else unexpectedResponses.add(1);
    check(res, {
      [`${endpoint.name} -> ${endpoint.expect.join('|')}`]: () => ok,
    });
  }
  // Stay under the API's 100 req/min/IP limiter. Without this the run measures
  // the limiter (429s) instead of the app.
  sleep(0.5);
}
