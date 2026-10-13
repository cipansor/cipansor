import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  contentSecurityPolicy,
  apiOrigin,
  STATIC_SECURITY_HEADERS,
} from "./security-headers";

const here = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(here, p), "utf8");
/** Every file under `dir`, as paths relative to the web app. */
const walk = (dir: string): string[] =>
  fs
    .readdirSync(path.join(here, dir), { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );

describe("static security headers", () => {
  const byKey = Object.fromEntries(
    STATIC_SECURITY_HEADERS.map((h) => [h.key, h.value]),
  );

  it("pins HSTS so the web host is never downgraded off HTTPS", () => {
    // Every PWA guarantee (a secure service-worker scope, Web Push, the session
    // cookie) depends on this. The API host gets it from helmet; the web host
    // has nothing else.
    expect(byKey["Strict-Transport-Security"]).toContain("max-age=");
    expect(byKey["Strict-Transport-Security"]).toContain("includeSubDomains");
  });

  it("sets clickjacking and sniffing defences", () => {
    // DENY agrees with the CSP's `frame-ancestors 'none'`; SAMEORIGIN said
    // otherwise to the browsers that still read only this header.
    expect(byKey["X-Frame-Options"]).toBe("DENY");
    expect(contentSecurityPolicy("n")).toContain("frame-ancestors 'none'");
    // OWASP: switch the legacy XSS auditor off; the CSP is the defence.
    expect(byKey["X-XSS-Protection"]).toBe("0");
    expect(byKey["X-Content-Type-Options"]).toBe("nosniff");
    expect(byKey["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("isolates the browsing context (COOP)", () => {
    expect(byKey["Cross-Origin-Opener-Policy"]).toBe("same-origin");
  });

  it("keeps the permissions the portal needs and denies the rest", () => {
    const policy = byKey["Permissions-Policy"];
    // Not a Permissions-Policy feature: Chromium warned on every page.
    expect(policy).not.toContain("push");
    // The E-Simaan setoran recorder calls `getUserMedia({ audio: true })`;
    // denying `microphone` here makes every recording fail with no visible
    // cause beyond a generic toast.
    expect(policy).toContain("microphone=(self)");
    // Absen Saya takes its selfie with `getUserMedia({ video })` and reads
    // `navigator.geolocation`; `()` refused both without a prompt.
    expect(policy).toContain("camera=(self)");
    expect(policy).toContain("geolocation=(self)");
    // Denied permissions use the empty allowlist `()`.
    expect(policy).toContain("payment=()");
  });

  it("allows every powerful feature a component asks for", () => {
    // The camera and geolocation were denied here while Absen Saya used both,
    // and no test noticed: this one reads the components instead of a list.
    const policy = byKey["Permissions-Policy"];
    const uses: [RegExp, string][] = [
      [/getUserMedia\(\{[^}]*video/, "camera"],
      [/getUserMedia\(\{[^}]*audio/, "microphone"],
      [
        /navigator\.geolocation\.(getCurrentPosition|watchPosition)/,
        "geolocation",
      ],
    ];
    // This file's own comments name the calls, so it is not a caller.
    const sources = walk("src").filter(
      (f) =>
        /\.tsx?$/.test(f) &&
        !/\.test\.tsx?$/.test(f) &&
        f !== path.join("src", "lib", "security-headers.ts"),
    );
    expect(sources.length).toBeGreaterThan(100);
    for (const [pattern, feature] of uses) {
      const callers = sources.filter((f) => pattern.test(read(f)));
      if (callers.length > 0) {
        expect(policy, `${feature} is used by ${callers.join(", ")}`).toContain(
          `${feature}=(self)`,
        );
      }
    }
  });

  it("is wired into next.config's headers() so it actually ships", () => {
    const config = read("next.config.ts");
    expect(config).toContain("STATIC_SECURITY_HEADERS");
    expect(config).toMatch(/source:\s*"\/:path\*"/);
  });
});

describe("Content-Security-Policy", () => {
  const csp = contentSecurityPolicy("TESTNONCE123");

  it("carries the per-request nonce on script-src", () => {
    expect(csp).toContain("script-src 'self' 'nonce-TESTNONCE123'");
  });

  it("never allows 'unsafe-inline' for scripts", () => {
    // The whole point: a script injected through a rendered announcement body
    // must not execute.
    const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src"))!;
    expect(scriptSrc).not.toContain("unsafe-inline");
  });

  it("locks down the high-value directives", () => {
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self'");
  });

  it("names the API origin in connect-src", () => {
    // Production serves web and API from separate hosts; omitting this blocks
    // every fetch.
    expect(csp).toContain(`connect-src 'self' ${apiOrigin()}`);
  });

  it("does not ask the browser to upgrade requests", () => {
    // WebKit upgrades http://localhost too, so a production build served over
    // plain http (CI's e2e) loaded its own scripts from https and never
    // hydrated.
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("names no API host when the API is the portal's own origin", () => {
    // Staging and production build with NEXT_PUBLIC_API_URL empty: `/api` on
    // the same origin. The policy used to name http://localhost:3001 there.
    const before = process.env.NEXT_PUBLIC_API_URL;
    try {
      process.env.NEXT_PUBLIC_API_URL = "";
      const deployed = contentSecurityPolicy("n");
      expect(deployed).not.toContain("localhost");
      expect(deployed).toContain(
        "connect-src 'self' https://challenges.cloudflare.com",
      );
      expect(deployed).toContain("media-src 'self' blob:;");
    } finally {
      if (before === undefined) delete process.env.NEXT_PUBLIC_API_URL;
      else process.env.NEXT_PUBLIC_API_URL = before;
    }
  });

  it("allows the Turnstile frame and script", () => {
    expect(csp).toContain("https://challenges.cloudflare.com");
  });

  it("allows the app's own blob/data PDF previews in a frame", () => {
    expect(csp).toMatch(/frame-src[^;]*blob:[^;]*data:/);
  });

  it("allows the recorded-audio blob and the API-host recording to play", () => {
    // `AudioRecorder` previews a just-recorded `blob:` URL; the tahfidz record
    // page plays a saved recording served from the API host (an absolute
    // `/uploads/**` URL). Without `media-src` the browser falls back to
    // `default-src 'self'` and both are blocked — a silent preview and a
    // recording that will not play.
    const mediaSrc = csp.split("; ").find((d) => d.startsWith("media-src"))!;
    expect(mediaSrc).toContain("blob:");
    expect(mediaSrc).toContain(apiOrigin());
  });
});

describe("CSP is applied by middleware, not a static header", () => {
  it("middleware builds the CSP from the shared helper and sets it", () => {
    const mw = read("middleware.ts");
    expect(mw).toContain(
      'import { contentSecurityPolicy } from "@/lib/security-headers"',
    );
    expect(mw).toContain('"Content-Security-Policy"');
    // It must thread the nonce onto the request headers, which is where Next
    // reads it to stamp its inline bootstrap scripts.
    expect(mw).toContain('requestHeaders.set("x-nonce", nonce)');
  });

  it("the root layout presents the nonce on its executable inline script", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain('requestHeaders.get("x-nonce")');
    expect(layout).toMatch(/nonce=\{nonce \|\| undefined\}/);
  });

  it("next.config does not also set a static CSP that would override the nonce", () => {
    const config = read("next.config.ts");
    // A static CSP without the nonce would break hydration; the two must not
    // both exist.
    expect(config).not.toContain('key: "Content-Security-Policy"');
  });
});
