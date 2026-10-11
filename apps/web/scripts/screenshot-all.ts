/**
 * Comprehensive visual sweep: log in as SUPER_ADMIN (wildcard route access),
 * visit every App Router page pattern found on disk (static ones directly,
 * dynamic ones discovered by crawling the links a seeded list page renders),
 * screenshot each, and record any page that errors, bounces, or renders blank.
 *
 * Usage:
 *   ../api/node_modules/.bin/tsx scripts/screenshot-all.ts <outDir> [onlyFilter]
 *
 * Output: <outDir>/<path>.png + <outDir>/public/<path>.png + <outDir>/report.json
 */

import fs from "fs";
import path from "path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { DEMO_ACCOUNTS } from "@cipansor/shared";
import { API_URL, BASE_URL, loginAs, storageStateFor } from "./lib/auth-state";
import { matchesDynamicPattern } from "./lib/dynamic-routes";

const OUT_DIR = process.argv[2] || path.join(__dirname, "../.qa-all");
const ONLY = process.argv[3];

const APP_DIR = path.join(__dirname, "../src/app");
const PUBLIC_PREFIXES = [
  "/profil",
  "/program-unggulan",
  "/unit",
  "/berita",
  "/galeri",
  "/wakaf-infaq",
  "/kontak",
  "/verifikasi",
  "/public/verify-card",
  "/public/verify-letter",
  "/public/verify-sanad",
  "/public/spmb",
];
const PUBLIC_ROUTES = ["/", "/login", "/reset-password", "/unauthorized"];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

function routeFromFile(file: string): string {
  const rel = path.relative(APP_DIR, file).replace(/\/?page\.tsx$/, "");
  const cleaned = rel.replace(/\(([^)]*)\)/g, "").replace(/\/+/g, "/");
  const route = "/" + cleaned.replace(/^\/|\/$/g, "");
  return route === "/" ? "/" : route;
}

const ALL_ROUTES = walk(APP_DIR).map(routeFromFile).sort();
const STATIC_ROUTES = ALL_ROUTES.filter((r) => !r.includes("[") && r !== "/");
const DYNAMIC_PATTERNS = ALL_ROUTES.filter((r) => r.includes("["));

// Concrete URLs for dynamic patterns, resolved from seeded data by
// `scripts/resolve-dynamic-routes.ts` (run it first). Without this, detail and
// edit screens that no index page links to are never captured.
const RESOLVED_DYNAMIC: string[] = (() => {
  try {
    const file = path.join(__dirname, "dynamic-routes.json");
    return Object.values(
      JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>,
    );
  } catch {
    return [];
  }
})();

function isKnownRoute(p: string): boolean {
  if (ONLY && !p.includes(ONLY)) return false;
  const pathname = p.split("?")[0];
  return (
    STATIC_ROUTES.includes(pathname) ||
    pathname === "/" ||
    DYNAMIC_PATTERNS.some((dp) => matchesDynamicPattern(pathname, dp))
  );
}

function slug(p: string): string {
  const [pathname, query] = p.split("?");
  const base =
    pathname === "/" ? "root" : pathname.slice(1).replace(/\//g, "__");
  if (!query) return base;
  // A resolved URL may carry a query string (`?academicYearId=…&semester=1`);
  // fold it into the filename so the two variants don't collide.
  return `${base}__q_${query.replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "")}`;
}

interface Result {
  path: string;
  finalPath: string;
  ok: boolean;
  problems: string[];
  screenshot: string;
  hasAuth: boolean;
}

const results: Result[] = [];
const visited = new Set<string>();

async function capture(
  page: Page,
  target: string,
  hasAuth: boolean,
  outDir: string,
  collectLinks: (links: string[]) => void,
): Promise<void> {
  const key = (hasAuth ? "auth:" : "pub:") + target;
  if (visited.has(key)) return;
  visited.add(key);

  const problems: string[] = [];
  const consoleErrors: string[] = [];
  const onConsole = (msg: any) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  };
  page.on("console", onConsole);

  try {
    await page.goto(`${BASE_URL}${target}`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    // Wait for the page to actually settle, not just for a fixed 1.4s. Client
    // pages fetch their data after hydration; a flat wait sampled the loading
    // spinner on any slow tick and reported "near-empty main content" for pages
    // that render perfectly a moment later. Wait for network idle, then give
    // React one more commit to paint.
    await page
      .waitForLoadState("networkidle", { timeout: 15000 })
      .catch(() => undefined);
    // networkidle is not enough on its own: a React Query request can start
    // *after* the last idle tick (hydration + retry backoff), so the capture
    // landed on the loading spinner for pages that paint a moment later. Poll
    // the main region until its text stops changing, so we screenshot the
    // settled state rather than whatever was on screen at an arbitrary tick.
    let previous = -1;
    for (let i = 0; i < 12; i++) {
      const length = (await page
        .locator("main")
        .innerText()
        .then((t) => t.replace(/\s/g, "").length)
        .catch(() => -1)) as number;
      if (length >= 40 && length === previous) break;
      previous = length;
      await page.waitForTimeout(400);
    }
  } catch (e) {
    problems.push(`navigation failed: ${(e as Error).message.split("\n")[0]}`);
  }

  const finalPath = (() => {
    try {
      return new URL(page.url()).pathname;
    } catch {
      return "";
    }
  })();
  // Intentional redirects: `/finance/billing` is a bookmark-preserving alias
  // for the Tunggakan tab of `/finance`, and `/login` bounces an already
  // authenticated visitor to `/dashboard`. Landing elsewhere there is correct.
  const EXPECTED_REDIRECTS: Record<string, string> = {
    "/finance/billing": "/finance",
    "/login": "/dashboard",
  };
  const targetPathname = target.split("?")[0];
  const expected = EXPECTED_REDIRECTS[targetPathname];
  if (
    finalPath &&
    finalPath !== targetPathname &&
    !finalPath.startsWith(`${targetPathname}/`)
  ) {
    if (expected && finalPath === expected) {
      // fine — deliberate alias, keep the screenshot of the destination
    } else {
      problems.push(`bounced to ${finalPath}`);
    }
  }

  const bodyText = await page
    .locator("body")
    .innerText()
    .catch(() => "");
  const short = bodyText.slice(0, 6000);
  const dense = short.replace(/\s/g, "").length;
  for (const marker of [
    "Application error",
    "This page could not be found",
    "Internal Server Error",
    "Unhandled Runtime Error",
    "Cannot read properties",
    "is not a function",
  ]) {
    if (short.includes(marker)) problems.push(`error text: ${marker}`);
  }

  // Guard/empty-state screens that mean the URL was dead (a stale seeded id, a
  // missing query param). Read the *main* region only, and only the text that is
  // actually rendered: "not found" also lives in hidden Radix content (a closed
  // Select renders an "No results found" item, a detached dialog keeps its DOM)
  // and in ordinary list pages, so whole-body / whole-subtree matching invents
  // failures. `innerText` respects `display:none` but not `visibility:hidden` or
  // an off-screen/`aria-hidden` portal, so filter on computed visibility too.
  // Passed as a *string*, not a closure: esbuild (the tsx loader) injects its
  // `__name` helper into a serialized function via `keepNames`, and that helper
  // does not exist in the browser — the evaluate threw `ReferenceError: __name
  // is not defined`, `.catch` swallowed it to `""`, and every page therefore
  // looked near-empty. Keep this as a string so the source that runs in the page
  // is exactly what is written here.
  const WALK_MAIN = `(() => {
    const el = document.querySelector("main");
    if (!el) return "";
    const visible = (node) => {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (node.getAttribute("aria-hidden") === "true") return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    let out = "";
    const walk = (node) => {
      if (node.nodeType === Node.TEXT_NODE) { out += node.textContent ?? ""; return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const element = node;
      if (!visible(element)) return;
      for (const child of element.childNodes) walk(child);
      out += "\\n";
    };
    walk(el);
    return out;
  })()`;
  const mainText = (await page.evaluate(WALK_MAIN).catch(() => "")) as string;
  const mainDense = mainText.replace(/\s/g, "").length;
  if (mainDense > 0 && mainDense < 260) {
    for (const marker of [
      "tidak ditemukan",
      "not found",
      "Gagal memuat",
      "Gagal mengambil data",
    ]) {
      if (mainText.includes(marker)) problems.push(`error text: ${marker}`);
    }
  }
  if (/^\s*404\s*$/m.test(short)) problems.push("404 page");

  // Blank / near-empty render detection. Check `main` specifically: the app
  // shell's sidebar carries ~2000 characters of menu labels on every page, so a
  // whole-body length test passes even when the page's own content area
  // rendered nothing at all — which is exactly how a crashed detail page (a
  // stale seeded id, an undefined field read) used to sail through the sweep.
  if (dense < 40 && !target.startsWith("/public")) {
    problems.push("near-empty page text");
  }
  if (mainDense < 40 && !target.startsWith("/public")) {
    problems.push("near-empty main content");
  }

  // A page stuck on its loading state after the settle wait means the request
  // never resolved (or 404'd) — the spinner is the whole page. Measured against
  // `main`, since the sidebar's menu labels alone exceed any body-text threshold.
  if (
    /memuat\s+data|loading\.\.\.|memuat\.\.\./i.test(mainText) &&
    mainDense < 200
  ) {
    problems.push("stuck on loading state");
  }

  // Layout check. `document.scrollWidth` cannot see this: the app shell's
  // `main.flex-1.overflow-auto` is itself a scroll container, so an over-wide
  // toolbar scrolls inside <main> and the document width stays correct while
  // content slides sideways under a stationary header (see apps/web/AGENTS.md).
  // Same string-evaluation rule as WALK_MAIN above.
  const OVERFLOW_PROBE = `(() => {
    const main = document.querySelector("main");
    if (!main) return null;
    const dx = main.scrollWidth - main.clientWidth;
    return dx > 8 ? { dx, clientWidth: main.clientWidth } : null;
  })()`;
  const overflow = (await page.evaluate(OVERFLOW_PROBE).catch(() => null)) as {
    dx: number;
    clientWidth: number;
  } | null;
  if (overflow) {
    problems.push(
      `horizontal overflow: main content ${overflow.dx}px wider than ${overflow.clientWidth}px viewport`,
    );
  }

  const relevantConsole = consoleErrors.filter(
    (t) => !t.includes("Failed to load resource") && !t.includes("favicon"),
  );
  if (relevantConsole.length > 0) {
    problems.push(
      `console errors: ${relevantConsole.slice(0, 2).join(" | ").slice(0, 200)}`,
    );
  }
  page.off("console", onConsole);

  // Sonner toasts are transient overlays portalled to the body — an
  // "Insufficient permissions" banner can sit over an otherwise fine page.
  // Remove them so the screenshot shows the page, not a toast.
  // Same string-evaluation rule as WALK_MAIN above.
  await page
    .evaluate(
      `document.querySelectorAll("[data-sonner-toast]").forEach((n) => n.remove())`,
    )
    .catch(() => undefined);

  const dir = hasAuth ? outDir : path.join(outDir, "public");
  const file = path.join(dir, `${slug(target)}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, fullPage: false }).catch(() => undefined);

  const links = await page
    .locator("a[href]")
    .evaluateAll((as) =>
      as.map((a) => (a as HTMLAnchorElement).getAttribute("href") || ""),
    )
    .catch(() => [] as string[]);
  const internal = links
    .filter(
      (h) => h.startsWith("/") && !h.startsWith("//") && !h.startsWith("/api"),
    )
    .map((h) => h.split("#")[0].split("?")[0])
    .filter((h) => h.length > 1);
  collectLinks(internal);

  results.push({
    path: target,
    finalPath,
    ok: problems.length === 0,
    problems,
    screenshot: file,
    hasAuth,
  });
  const status = problems.length === 0 ? "✓" : "✗";
  console.log(
    `${status} ${hasAuth ? "[auth]" : "[pub] "} ${target}${problems.length ? " — " + problems.join("; ") : ""}`,
  );
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser: Browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });

  // Admin accounts are behind a 2FA gate (no demo exemption); `loginAs`
  // answers it from the fixed secret the seed writes with E2E_FIXED_2FA=1.
  const session = await loginAs("SUPER_ADMIN");

  // -------- authenticated crawl --------
  const ctx = await browser.newContext({
    storageState: storageStateFor(session),
    viewport: { width: 1440, height: 900 },
  });
  const page = await ctx.newPage();

  const queue: string[] = [];
  const queued = new Set<string>();
  const enqueue = (p: string) => {
    if (!p || p === "#" || p.startsWith("/_next") || p.startsWith("/api"))
      return;
    // `/parent/*` is read as a PARENT in its own pass below; the SUPER_ADMIN
    // session can't read its API, so sweeping it here only invents failures.
    if (p === "/parent" || p.startsWith("/parent/")) return;
    if (!isKnownRoute(p)) return;
    if (queued.has(p) || visited.has("auth:" + p)) return;
    queued.add(p);
    queue.push(p);
  };

  for (const r of STATIC_ROUTES) enqueue(r);
  for (const r of RESOLVED_DYNAMIC) enqueue(r);
  enqueue("/dashboard");

  const collect = (links: string[]) => links.forEach(enqueue);
  let guard = 0;
  while (queue.length > 0 && guard < 2000) {
    guard++;
    const target = queue.shift()!;
    await capture(page, target, true, OUT_DIR, collect);
  }
  await ctx.close();

  // -------- parent crawl (PARENT role) --------
  // `/parent/*` is guarded by `authorize(PARENT)` on the API, so sweeping it as
  // SUPER_ADMIN only ever produced "Insufficient permissions" — an artifact of
  // the visitor, not a broken page. Visit it as a real parent instead.
  const parentAccount = DEMO_ACCOUNTS.find((a) =>
    a.roleCode.endsWith("_ORANG_TUA"),
  );
  if (parentAccount) {
    const parentSession = await loginAs(parentAccount.roleCode);
    if (parentSession?.accessToken) {
      const parentCtx = await browser.newContext({
        storageState: storageStateFor(parentSession),
        viewport: { width: 1440, height: 900 },
      });
      const parentPage = await parentCtx.newPage();
      const parentQueue = [
        ...STATIC_ROUTES.filter((r) => r.startsWith("/parent")),
        ...RESOLVED_DYNAMIC.filter((r) => r.startsWith("/parent")),
      ];
      // These paths were already "visited" as SUPER_ADMIN; drop that key so the
      // parent pass really re-captures them under a session that can read them.
      for (const p of parentQueue) visited.delete("auth:" + p);
      // A parent menu links to dynamic pages too (`/parent/report-cards/[id]`,
      // `/parent/ibadah/[id]`); crawl those the same way the staff pass does.
      const parentQueued = new Set(parentQueue);
      const collectParent = (links: string[]) =>
        links.forEach((l) => {
          if (!(l === "/parent" || l.startsWith("/parent/"))) return;
          if (!isKnownRoute(l)) return;
          if (parentQueued.has(l) || visited.has("auth:" + l)) return;
          parentQueued.add(l);
          parentQueue.push(l);
        });
      for (const target of parentQueue) {
        await capture(parentPage, target, true, OUT_DIR, collectParent);
      }
      await parentCtx.close();
    }
  }

  // -------- public crawl (anonymous) --------
  const pubCtx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const pubPage = await pubCtx.newPage();
  const pubQueue: string[] = [];
  const pubQueued = new Set<string>();
  const enqueuePub = (p: string) => {
    if (!p || !isKnownRoute(p)) return;
    if (pubQueued.has(p) || visited.has("pub:" + p)) return;
    pubQueued.add(p);
    pubQueue.push(p);
  };
  for (const r of PUBLIC_ROUTES) enqueuePub(r);
  for (const r of STATIC_ROUTES)
    if (PUBLIC_PREFIXES.some((pre) => r === pre || r.startsWith(pre + "/")))
      enqueuePub(r);

  const collectPub = (links: string[]) =>
    links.forEach((l) => {
      if (PUBLIC_PREFIXES.some((pre) => l.startsWith(pre))) enqueuePub(l);
    });
  let pubGuard = 0;
  while (pubQueue.length > 0 && pubGuard < 800) {
    pubGuard++;
    const target = pubQueue.shift()!;
    await capture(pubPage, target, false, OUT_DIR, collectPub);
  }
  await pubCtx.close();
  await browser.close();

  const failures = results.filter((r) => !r.ok);
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    `\n${results.length} pages captured, ${failures.length} failures.`,
  );
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures)
      console.log(`  ${f.path}: ${f.problems.join("; ")}`);
  }
  // Show dynamic patterns we never reached (candidate gaps).
  const reached = new Set(results.map((r) => r.path));
  const missingDynamic = DYNAMIC_PATTERNS.filter(
    (dp) => ![...reached].some((p) => matchesDynamicPattern(p, dp)),
  );
  console.log(`\nDynamic patterns not covered (${missingDynamic.length}):`);
  for (const m of missingDynamic) console.log("  " + m);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
