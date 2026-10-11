// Coverage gate for apps/api. Reads the v8 json-summary report vitest writes
// (apps/api/coverage/coverage-summary.json) and fails when any metric dropped
// more than `tolerance_pct` below the committed floor (.github/coverage-baseline.json).
//
// It is a ratchet, not a target: tests should never be added just to move the
// number, and the floor moves only upward. Run it locally after `pnpm --filter
// api test:coverage` with:  node .github/scripts/coverage-gate.mjs
//
// Env:
//   SUMMARY        path to the coverage summary   (default apps/api/coverage/coverage-summary.json)
//   BASELINE       path to the floor              (default .github/coverage-baseline.json)
//   COVERAGE_GATE  "off" to skip (used by the bootstrap PR that seeds the floor)
import { readFileSync, existsSync } from "node:fs";

const SUMMARY =
  process.env.SUMMARY ?? "apps/api/coverage/coverage-summary.json";
const BASELINE = process.env.BASELINE ?? ".github/coverage-baseline.json";

if ((process.env.COVERAGE_GATE ?? "").toLowerCase() === "off") {
  console.log("coverage-gate: skipped (COVERAGE_GATE=off)");
  process.exit(0);
}

const METRICS = [
  ["statements", "Statements"],
  ["branches", "Branches"],
  ["functions", "Functions"],
  ["lines", "Lines"],
];

const read = (path, what) => {
  if (!existsSync(path)) {
    console.error(`coverage-gate: ${what} not found at ${path}`);
    process.exit(1);
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    console.error(
      `coverage-gate: could not parse ${what} at ${path}: ${err.message}`,
    );
    process.exit(1);
  }
};

const summary = read(SUMMARY, "coverage summary");
const baseline = read(BASELINE, "coverage baseline");

if (!summary.total) {
  console.error(
    "coverage-gate: coverage summary has no `total` block — did vitest write json-summary?",
  );
  process.exit(1);
}

const tolerance = Number(baseline.tolerance_pct ?? 0);
const floor = baseline.metrics ?? {};
const rows = [];
let failed = false;

for (const [key, label] of METRICS) {
  const actual = summary.total[key]?.pct;
  const base = floor[key];
  if (typeof actual !== "number" || typeof base !== "number") {
    console.error(
      `coverage-gate: missing ${key} in the summary or the baseline`,
    );
    process.exit(1);
  }
  const min = base - tolerance;
  const ok = actual >= min;
  if (!ok) failed = true;
  rows.push({ label, actual, base, min, ok });
}

const pad = (s, n) => String(s).padEnd(n);
console.log("Metric      actual   floor   floor-tol   result");
for (const r of rows) {
  console.log(
    `${pad(r.label, 12)}${pad(r.actual.toFixed(2) + "%", 9)}${pad(r.base.toFixed(2) + "%", 8)}` +
      `${pad(r.min.toFixed(2) + "%", 10)}${r.ok ? "ok" : "BELOW FLOOR"}`,
  );
}

if (failed) {
  const worst = rows
    .filter((r) => !r.ok)
    .map((r) => r.label.toLowerCase())
    .join(", ");
  console.error(
    `\ncoverage-gate: coverage regressed below the floor on: ${worst}.\n` +
      "Add tests for the new or changed code rather than lowering the floor. If the " +
      "drop is genuinely intended, raise the discussion in the pull request; the floor " +
      `lives in ${BASELINE}.`,
  );
  process.exit(1);
}
console.log("\ncoverage-gate: at or above the floor.");
