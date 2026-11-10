import { describe, it, expect } from "vitest";
import { config } from "../../middleware";

/**
 * The offline banner probes `/ping` (app/ping/route.ts). The middleware must
 * let that one path through untouched — a redirect to /login would read as
 * "offline" on every page for a signed-out visitor — and nothing else that
 * merely starts with "ping".
 */
const matcher = new RegExp(`^${config.matcher[0]}$`);
const runsMiddleware = (path: string) => matcher.test(path);

describe("middleware matcher and the /ping probe", () => {
  it("skips /ping", () => {
    expect(runsMiddleware("/ping")).toBe(false);
  });

  it("still runs for paths that only start with ping", () => {
    expect(runsMiddleware("/pingdom")).toBe(true);
    expect(runsMiddleware("/ping/extra")).toBe(true);
  });

  it("still runs for ordinary pages", () => {
    expect(runsMiddleware("/login")).toBe(true);
    expect(runsMiddleware("/dashboard")).toBe(true);
  });

  it("does not run for the API proxy or static assets", () => {
    expect(runsMiddleware("/api/health")).toBe(false);
    expect(runsMiddleware("/_next/static/chunk.js")).toBe(false);
    expect(runsMiddleware("/favicon.ico")).toBe(false);
  });
});
