/**
 * Shared k6 configuration and threshold policy.
 *
 * Thresholds are relative to a recorded baseline, never absolute: this
 * machine's absolute numbers are not the server's, and a fixed millisecond
 * budget would fail the moment the load profile changes. The runner
 * (run-load-tests.mjs) reads this same object, so the comparison the report
 * makes and the pass/fail k6 enforces cannot drift apart.
 */

// A regression is a *relative* change against the recorded baseline. The
// tolerances are deliberately loose: staging is a shared VM and a single run
// is noisy, so these flag a real step change, not run-to-run jitter.
export const REGRESSION = {
  // p95 may grow by half again before it is called a regression.
  p95: 1.5,
  // p99 gets more room; it is the noisiest of the three.
  p99: 1.75,
  // Below this many samples p99 *is* the single slowest request, so it swings
  // run to run (measured: 327ms -> 764ms across two identical 48-request smoke
  // runs) and flags regressions that never happened. The p99 threshold is only
  // emitted, and the p99 comparison only made, once the run is large enough for
  // the percentile to mean something. p50/p95 stay checked at every size.
  p99MinSamples: 100,
  // An absolute error-rate ceiling. k6's own `http_req_failed` rate counts
  // every non-2xx/3xx response, including the 401s the anonymous smoke
  // scenario expects on protected routes, so the report computes its own rate
  // from the `expected_responses` / `unexpected_responses` counters. This
  // ceiling applies to that computed rate.
  errorRate: 0.01,
  // The k6 threshold is `checks: ['rate>0.99']`, so exactly 0.99 is a failure
  // there. The runner compares with `<=` against this value so the two verdicts
  // cannot disagree at the boundary. Kept here so the number has one home.
  checksRate: 0.99,
};

/**
 * The single millisecond limit both sides use for a relative tolerance.
 *
 * k6 emits `p(95)<limit` (a strict `<`, so it fails at `p95 >= limit`) and the
 * runner flags `p95 >= limit`. Rounding here, once, is what keeps the two from
 * disagreeing by a step: without it k6 compared against a rounded value while
 * the runner compared against the exact one.
 */
export function latencyLimit(baselineMs, factor) {
  return Math.ceil(baselineMs * factor);
}

/**
 * Turn a recorded baseline into k6 threshold expressions.
 *
 * Both the thresholds here and the runner's comparison read ONE metric,
 * `expected_response_duration`, a Trend each scenario fills only for responses
 * it expected (2xx/3xx and the 401s the anonymous scenario counts as passes).
 * Before this, k6 thresholded `http_req_duration{expected_response:true}`
 * (2xx/3xx only, so the 24 `/healthz` samples) while the runner compared the
 * overall `http_req_duration` (all 48 samples, 401s included) — two different
 * populations that disagreed: a run could print "thresholds crossed" and "no
 * regression" at once. Rate-limited (429) responses are excluded, since a
 * throttled run is not comparable at all.
 */
export function thresholdsFor(baseline) {
  const thresholds = { checks: [`rate>${REGRESSION.checksRate}`] };
  const key = 'expected_response_duration';
  if (baseline && baseline.p95) {
    thresholds[key] = [`p(95)<${latencyLimit(baseline.p95, REGRESSION.p95)}`];
  }
  // Only threshold p99 when the baseline it was derived from had enough samples
  // for p99 to be a percentile rather than the single slowest request.
  if (baseline && baseline.p99 && (baseline.requests ?? 0) >= REGRESSION.p99MinSamples) {
    thresholds[key] = [...(thresholds[key] || []), `p(99)<${latencyLimit(baseline.p99, REGRESSION.p99)}`];
  }
  return thresholds;
}

export const PROFILES = {
  smoke: {
    // One VU, 12 iterations. Each iteration is 4 GETs plus a 0.5s pause, so the
    // run spends ~48 requests in ~7s — comfortably inside the API's global
    // limiter of 100 requests/minute per IP. A bigger run trips the limiter and
    // measures the 429s instead of the app, which the runner detects and
    // refuses to record as a baseline. Raise the limiter or wait out the window
    // before making this profile heavier.
    vus: 1,
    iterations: 12,
  },
  load: {
    // The full profile is only for a stack you own. Do not point it at
    // staging without telling the team first.
    stages: [
      { duration: '30s', target: 10 },
      { duration: '1m', target: 10 },
      { duration: '15s', target: 0 },
    ],
  },
};

/**
 * Where a target answers the API's health route. The API serves `/health`
 * itself, so the local stack (the API on :3001, no nginx) is asked there. A
 * deployed host puts nginx in front, which forwards only `/healthz` (and
 * `/api/...`) to the API: `/health` on staging is answered by the web app with
 * a 307 to `/login`, so measuring it there timed a page render, not the API.
 * `override` (HEALTH_PATH) wins when given.
 */
export function healthPathFor(baseUrl, override) {
  if (override) return override;
  return /:3001$/.test(String(baseUrl).replace(/\/+$/, '')) ? '/health' : '/healthz';
}
