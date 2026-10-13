import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  hostSplitActionFor,
  pwaEnabledForHost,
  indexableHost,
  PUBLIC_HOST,
  PORTAL_HOST,
  PUBLIC_PATH_PREFIXES,
} from "./host-split";

/**
 * Two lists describe the same set of public pages, in two files:
 *
 *   middleware.ts  `publicPrefixes`      — what may be READ without a session
 *   host-split.ts  `PUBLIC_PATH_PREFIXES` — which HOST serves it
 *
 * Adding a page to one and not the other fails quietly and in opposite
 * directions: miss host-split and the page is served only from
 * portal.cipansor.or.id behind a login; miss middleware and the apex serves it
 * and then bounces the visitor to a login screen that host cannot satisfy.
 * Either way an anonymous visitor — a prospective parent, or the Ad Grants
 * reviewer — meets a sign-in form on a marketing page.
 *
 * Parsed out of middleware.ts rather than imported, matching rbac.test.ts:
 * the list is a module-private const, and duplicating it here to compare
 * against would defeat the entire point of comparing.
 */
describe("the two public-path lists agree", () => {
  it("host-split.ts matches middleware.ts", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "middleware.ts"),
      "utf8",
    );
    const block = src.match(/const publicPrefixes\s*=\s*\[([\s\S]*?)\n\];/);
    if (!block) throw new Error("publicPrefixes not found in middleware.ts");
    const fromMiddleware = [...block[1].matchAll(/"([^"]+)"/g)].map(
      (m) => m[1],
    );

    expect(fromMiddleware.length).toBeGreaterThan(0);
    expect([...PUBLIC_PATH_PREFIXES].sort()).toEqual(
      [...fromMiddleware].sort(),
    );
  });
});

/**
 * The split is a redirect rule applied to every request, so its failure modes
 * are the loud kind: a marketing page that bounces visitors to a login screen,
 * or an application route that lands on a host with no session and no way back.
 * These tests pin the shape of both directions.
 */
/** Reads the action back as the old string-or-null shape, for terse assertions. */
const target = (host: string | null, pathname: string): string | null => {
  const a = hostSplitActionFor(host, pathname);
  if (!a) return null;
  return a.kind === "redirect" ? a.host : "404";
};

describe("hostSplitActionFor", () => {
  describe("unknown hosts are left alone", () => {
    // `pnpm dev` serves both halves from one origin. If the split fired there,
    // every developer would be redirected to production the moment they opened
    // /dashboard.
    it.each(["localhost", "localhost:3000", "127.0.0.1:3000", "", null])(
      "%s → no redirect",
      (host) => {
        expect(target(host, "/dashboard")).toBeNull();
        expect(target(host, "/profil")).toBeNull();
      },
    );
  });

  describe("public host", () => {
    it("keeps the landing page", () => {
      expect(target(PUBLIC_HOST, "/")).toBeNull();
    });

    it.each(PUBLIC_PATH_PREFIXES)("keeps %s", (prefix) => {
      expect(target(PUBLIC_HOST, prefix)).toBeNull();
      expect(target(PUBLIC_HOST, `${prefix}/anak`)).toBeNull();
    });

    // `/public/*` pages are exempt from middleware by the matcher, so these two
    // assertions describe what `hostSplitActionFor` *would* answer rather than
    // something a request actually reaches. Kept because the function is the
    // contract middleware switches on: if the matcher ever stops excluding
    // `/public`, the printed QR's address must still resolve on the apex and be
    // sent back from the portal.
    it("keeps the public verify-card page", () => {
      expect(target(PUBLIC_HOST, "/public/verify-card")).toBeNull();
      expect(target(PORTAL_HOST, "/public/verify-card")).toBe(PUBLIC_HOST);
    });

    it("keeps the public verify-sanad page", () => {
      expect(target(PUBLIC_HOST, "/public/verify-sanad")).toBeNull();
      expect(target(PORTAL_HOST, "/public/verify-sanad")).toBe(PUBLIC_HOST);
    });

    // 404, not a redirect to the portal. A redirect would imply the
    // application also lives at cipansor.or.id — the assumption the split
    // exists to remove — and nothing has ever linked here to be rescued.
    it.each([
      "/login",
      "/dashboard",
      "/unauthorized",
      "/keuangan/invoice",
      "/perencanaan",
      "/settings/chatbot",
    ])("answers 404 for %s", (path) => {
      expect(target(PUBLIC_HOST, path)).toBe("404");
    });

    it("treats www the same as the apex", () => {
      expect(target(`www.${PUBLIC_HOST}`, "/dashboard")).toBe("404");
      expect(target(`www.${PUBLIC_HOST}`, "/profil")).toBeNull();
    });
  });

  describe("portal host", () => {
    it.each(PUBLIC_PATH_PREFIXES)(
      "sends %s back to the public host",
      (prefix) => {
        expect(target(PORTAL_HOST, prefix)).toBe(PUBLIC_HOST);
        expect(target(PORTAL_HOST, `${prefix}/anak`)).toBe(PUBLIC_HOST);
      },
    );

    it("keeps the root, which is the way in to the application", () => {
      // Not a marketing page here: middleware turns it into the dashboard or
      // the login screen. Bouncing it to the apex would strand anyone who typed
      // the portal's name on the marketing site instead.
      expect(target(PORTAL_HOST, "/")).toBeNull();
    });

    it.each(["/login", "/dashboard", "/unauthorized", "/keuangan"])(
      "keeps %s",
      (path) => {
        expect(target(PORTAL_HOST, path)).toBeNull();
      },
    );
  });

  describe("prefix matching respects segment boundaries", () => {
    // "/unit" is public; "/units" is the admin CRUD page. Matching on a bare
    // string prefix would hand the admin page to the marketing host, where
    // there is no session to open it with.
    it("does not treat /units as public", () => {
      expect(target(PUBLIC_HOST, "/units")).toBe("404");
      expect(target(PORTAL_HOST, "/units")).toBeNull();
    });

    it("does not treat /unit-usaha as public", () => {
      expect(target(PUBLIC_HOST, "/unit-usaha")).toBe("404");
    });

    // The public Fasilitas and Kegiatan pages live at /campus and /activities
    // because /facilities (Sarpras) and /extracurricular are portal modules,
    // read with a session; neither may leak onto the marketing host.
    it("keeps the portal's /facilities and /extracurricular off the public host", () => {
      expect(target(PUBLIC_HOST, "/facilities")).toBe("404");
      expect(target(PUBLIC_HOST, "/extracurricular")).toBe("404");
      expect(target(PORTAL_HOST, "/facilities")).toBeNull();
      expect(target(PUBLIC_HOST, "/campus")).toBeNull();
      expect(target(PUBLIC_HOST, "/activities")).toBeNull();
    });
  });

  it("is case-insensitive and port-insensitive about the host", () => {
    expect(target("Portal.Cipansor.Or.Id:443", "/profil")).toBe(PUBLIC_HOST);
    expect(target("CIPANSOR.OR.ID", "/dashboard")).toBe("404");
  });

  it("is exhaustive: every request gets exactly one of three answers", () => {
    // Guards against a fourth branch being added without a decision about what
    // it means — the shape is the contract middleware.ts switches on.
    for (const host of [PUBLIC_HOST, PORTAL_HOST, "localhost:3000"]) {
      for (const path of ["/", "/profil", "/dashboard"]) {
        const a = hostSplitActionFor(host, path);
        expect(
          a === null || a.kind === "redirect" || a.kind === "notFound",
        ).toBe(true);
      }
    }
  });

  it("never returns the host the request already arrived on", () => {
    // A rule that returns its own host is an infinite redirect loop, and it
    // would take the whole site down rather than one page.
    const paths = ["/", "/profil", "/unit/smpit", "/dashboard", "/login", "/x"];
    for (const path of paths) {
      expect(target(PUBLIC_HOST, path)).not.toBe(PUBLIC_HOST);
      expect(target(PORTAL_HOST, path)).not.toBe(PORTAL_HOST);
    }
  });
});

/**
 * The PWA belongs to the application, and the application lives on one host.
 *
 * What these pin down is the *polarity*: off on the public site, on everywhere
 * else. Written as "on for the portal" instead, localhost would lose the PWA
 * and nobody could test the install flow in `pnpm dev` — a regression that
 * would not show up in production and so would survive for months.
 */
describe("pwaEnabledForHost", () => {
  it("is off on the public site", () => {
    // The apex would otherwise offer to install an app whose start_url is the
    // brochure and whose three manifest shortcuts all 404 there.
    expect(pwaEnabledForHost(PUBLIC_HOST)).toBe(false);
    expect(pwaEnabledForHost(`www.${PUBLIC_HOST}`)).toBe(false);
    expect(pwaEnabledForHost("CIPANSOR.OR.ID:443")).toBe(false);
  });

  it("is on for the portal", () => {
    expect(pwaEnabledForHost(PORTAL_HOST)).toBe(true);
    expect(pwaEnabledForHost("Portal.Cipansor.Or.Id:443")).toBe(true);
  });

  it.each(["localhost", "localhost:3000", "127.0.0.1:3000", "", null])(
    "stays on for %s, so dev keeps the install flow",
    (host) => {
      expect(pwaEnabledForHost(host)).toBe(true);
    },
  );
});

/**
 * Indexing is the mirror image: the public site is the reason to be indexed,
 * the portal is a staff login form that has no business in search results.
 */
describe("indexableHost", () => {
  it("indexes the public site", () => {
    expect(indexableHost(PUBLIC_HOST)).toBe(true);
    expect(indexableHost(`www.${PUBLIC_HOST}`)).toBe(true);
  });

  it("does not index the portal", () => {
    expect(indexableHost(PORTAL_HOST)).toBe(false);
    expect(indexableHost("PORTAL.cipansor.or.id:443")).toBe(false);
  });

  it("never turns both off for the same host", () => {
    // A host that is neither indexable nor running the app serves nothing
    // anyone can reach or find. Not possible today; asserted so it stays that
    // way if either predicate is rewritten.
    for (const host of [PUBLIC_HOST, PORTAL_HOST, "localhost:3000"]) {
      expect(indexableHost(host) || pwaEnabledForHost(host)).toBe(true);
    }
  });
});
