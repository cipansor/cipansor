/**
 * Visual QA per role: log in as each representative account, open every menu
 * item its role should see (straight from the nav registry), assert the page
 * actually opens (no bounce to a dashboard, no 404/error screen), and save a
 * screenshot per page.
 *
 * Usage (stack must be running — see scripts/dev-up.sh):
 *   ../api/node_modules/.bin/tsx scripts/screenshot-roles.ts [outDir] [roleFilter]
 *
 * Output: <outDir>/<role>/<path>.png + <outDir>/report.json, and a failure
 * summary on stdout. Exit code 1 when any page fails.
 */

import fs from "fs";
import path from "path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { DEMO_ACCOUNTS } from "@cipansor/shared";
import { getNavigationForRoleCode } from "../src/config/navigation";
import { getDashboardForRole, deriveLegacyRole } from "../src/lib/rbac";
import { BASE_URL, loginAs, storageStateFor } from "./lib/auth-state";

/** Flatten a role's navigation groups into the list of menu paths to visit. */
function menuPathsForRole(roleCode: string): string[] {
  return getNavigationForRoleCode(roleCode).flatMap((group) =>
    group.items.map((item) => item.href),
  );
}

const OUT_DIR = process.argv[2] || path.join(__dirname, "../.qa-screens");
const ROLE_FILTER = process.argv[3];

interface RoleAccount {
  label: string;
  roleCode: string;
}

// Drive the sweep off the canonical DEMO_ACCOUNTS — the single list that the API
// seed (apps/api/prisma/seed.ts) provisions, one login per RoleCode. Using it
// here guarantees every account we try to log in as actually exists in a freshly
// seeded database. `loginAs` answers the 2FA challenge every admin account sits
// behind; seed with E2E_FIXED_2FA=1 so it can.
const ACCOUNTS: RoleAccount[] = DEMO_ACCOUNTS.map((acc) => ({
  label: acc.roleCode.toLowerCase().replace(/_/g, "-"),
  roleCode: acc.roleCode,
}));

interface PageResult {
  role: string;
  path: string;
  finalPath: string;
  ok: boolean;
  problems: string[];
  /** Non-fatal: the page rendered, but a request it made was refused. */
  warnings: string[];
  screenshot: string;
}

/**
 * What counts as a broken page: it must not error, bounce, render blank, or
 * spill sideways. It is judged on the CONTENT AREA (`<main>`), not the whole
 * `body`.
 *
 * The distinction matters. A page can render perfectly while one of its
 * background widgets is refused by the API — the shell then raises a
 * "Insufficient permissions" toast, which `sonner` portals to the document
 * body. Reading `body.innerText` therefore flagged a fully-rendered page as
 * broken, which is how an earlier run reported 167 failures where the
 * screenshots were all fine. Those refusals are recorded separately as
 * `warnings` (a real nav/API contract mismatch worth fixing) so the failure
 * count keeps meaning "this screenshot is unusable".
 */
async function checkPage(
  page: Page,
  role: string,
  target: string,
  outDir: string,
): Promise<PageResult> {
  const problems: string[] = [];
  const warnings: string[] = [];
  const consoleErrors: string[] = [];
  const refused: string[] = [];
  const onConsole = (msg: { type(): string; text(): string }) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  };
  const onResponse = (res: { status(): number; url(): string }) => {
    if (res.status() < 400) return;
    try {
      const u = new URL(res.url());
      if (u.pathname.includes("/api/"))
        refused.push(`${res.status()} ${u.pathname}`);
    } catch {
      /* non-URL response */
    }
  };
  page.on("console", onConsole);
  page.on("response", onResponse);

  try {
    await page.goto(`${BASE_URL}${target}`, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    await page.waitForTimeout(1800);
  } catch (e) {
    problems.push(`navigation failed: ${(e as Error).message.split("\n")[0]}`);
  }
  page.off("console", onConsole);
  page.off("response", onResponse);

  const finalPath = new URL(page.url()).pathname;
  if (finalPath !== target && !finalPath.startsWith(`${target}/`)) {
    problems.push(`bounced to ${finalPath}`);
  }

  // Content area only — the shell chrome (sidebar/header) and any portaled
  // toast live outside it.
  const main = page.locator("main").first();
  const hasMain = (await main.count()) > 0;
  const mainText = (
    hasMain ? await main.innerText().catch(() => "") : ""
  ).slice(0, 4000);

  for (const marker of [
    "Application error",
    "This page could not be found",
    "Internal Server Error",
    "Unhandled Runtime Error",
    "Cannot read properties",
    "is not a function",
  ]) {
    if (mainText.includes(marker)) problems.push(`error text: ${marker}`);
  }
  if (/^\s*404\s*$/m.test(mainText)) problems.push("404 page");

  // The access-denied page is a real failure: the page itself refused the
  // visitor. The API's `Insufficient permissions` toast is NOT — see above.
  if (/Akses Ditolak/i.test(mainText))
    problems.push("rendered access-denied page");

  // Blank / near-empty render: no content text, or a content area with no
  // visible child nodes (a white screen still has a <main> element).
  //
  // The predicate is written as a STRING for `evaluate`, not a closure: tsx
  // (esbuild) injects a `__name` helper into named/nested functions, and
  // Playwright serialises the function by source — the injected reference then
  // throws `__name is not defined` inside the page and every page reports
  // "blank", which is exactly how a whole sweep produced 180 false failures.
  const visibleChildren = hasMain
    ? await main
        .evaluate(
          `(() => {
          const isVisible = (n) => {
            const r = n.getBoundingClientRect();
            const s = getComputedStyle(n);
            return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
          };
          return Array.from(document.querySelector("main").children).filter(isVisible).length;
        })()`,
        )
        .then((n: unknown) => Number(n) || 0)
        .catch(() => -1)
    : -1;
  if (mainText.replace(/\s/g, "").length < 40)
    problems.push("near-empty page text");
  if (hasMain && visibleChildren === 0)
    problems.push("blank content area (no visible children)");

  // See apps/web/AGENTS.md: the shell's <main> is a scroll container, so
  // document.scrollWidth hides real horizontal overflow. Measure <main>.
  // String form for the same `__name` reason as above — and a thrown
  // predicate must be distinguishable from "no overflow", not swallowed.
  const overflow = await page
    .evaluate(
      `(() => {
      const main = document.querySelector("main");
      if (!main) return null;
      const dx = main.scrollWidth - main.clientWidth;
      return dx > 8 ? { dx: dx, clientWidth: main.clientWidth } : null;
    })()`,
    )
    .then((r: unknown) => r as { dx: number; clientWidth: number } | null)
    .catch(() => null);
  if (overflow) {
    problems.push(
      `horizontal overflow: main content ${overflow.dx}px wider than ${overflow.clientWidth}px`,
    );
  }

  const relevantConsole = consoleErrors.filter(
    (t) => !t.includes("Failed to load resource"),
  );
  if (relevantConsole.length > 0) {
    problems.push(
      `console errors: ${relevantConsole.slice(0, 2).join(" | ").slice(0, 200)}`,
    );
  }

  if (refused.length > 0) {
    warnings.push(
      `API refused: ${[...new Set(refused)].join(", ").slice(0, 300)}`,
    );
  }

  // Sonner error toasts are transient overlays: they portal to the body, so a
  // screenshot taken while one is up shows an "Insufficient permissions" banner
  // that is not part of the page. They are already recorded as `warnings`
  // above, so drop them before capturing.
  // Same string-evaluation rule as screenshot-all.ts: a closure passed to
  // `evaluate` gets esbuild's `__name` helper injected and throws in the page.
  await page
    .evaluate(
      `document.querySelectorAll("[data-sonner-toast]").forEach((n) => n.remove())`,
    )
    .catch(() => undefined);

  const file = path.join(
    outDir,
    `${target === "/" ? "root" : target.slice(1).replace(/\//g, "__")}.png`,
  );
  await page.screenshot({ path: file, fullPage: false }).catch(() => undefined);

  return {
    role,
    path: target,
    finalPath,
    ok: problems.length === 0,
    problems,
    warnings,
    screenshot: file,
  };
}

async function run() {
  const accounts = ROLE_FILTER
    ? ACCOUNTS.filter((a) => a.label.includes(ROLE_FILTER))
    : ACCOUNTS;

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // PLAYWRIGHT_CHROMIUM points at a system/preinstalled chromium when the
  // pinned browser build for this @playwright/test version is not downloaded.
  const browser: Browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });
  const results: PageResult[] = [];

  for (const account of accounts) {
    const roleDir = path.join(OUT_DIR, account.label);
    fs.mkdirSync(roleDir, { recursive: true });

    let session;
    try {
      session = await loginAs(account.roleCode);
    } catch (e) {
      console.error(`✗ LOGIN ${account.label}: ${(e as Error).message}`);
      results.push({
        role: account.label,
        path: "(login)",
        finalPath: "",
        ok: false,
        problems: [(e as Error).message],
        warnings: [],
        screenshot: "",
      });
      continue;
    }

    const context = await browser.newContext({
      storageState: storageStateFor(session),
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    const targets = Array.from(
      new Set([
        getDashboardForRole(
          deriveLegacyRole(account.roleCode),
          account.roleCode,
        ),
        ...menuPathsForRole(account.roleCode),
      ]),
    );

    for (const target of targets) {
      const r = await checkPage(page, account.label, target, roleDir);
      results.push(r);
      console.log(
        `${r.ok ? "✓" : "✗"} [${account.label}] ${target}${r.ok ? "" : " — " + r.problems.join("; ")}`,
      );
    }

    await context.close();
  }

  await browser.close();

  const failures = results.filter((r) => !r.ok);
  const warned = results.filter((r) => r.ok && r.warnings.length > 0);
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    JSON.stringify(results, null, 2),
  );
  console.log(
    `\n${results.length} pages checked, ${failures.length} failures.`,
  );
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures)
      console.log(`  [${f.role}] ${f.path}: ${f.problems.join("; ")}`);
  }
  // Warnings are the nav/API contract mismatches: the page rendered, so it is
  // not a failure, but a role that was shown a menu item whose data it cannot
  // read is a defect in its own right. Reported per page pattern, not per role.
  if (warned.length > 0) {
    const byPath = new Map<string, { roles: string[]; warning: string }>();
    for (const w of warned) {
      const e = byPath.get(w.path) ?? { roles: [], warning: w.warnings[0] };
      e.roles.push(w.role);
      byPath.set(w.path, e);
    }
    console.log(
      `\n${warned.length} pages rendered but had refused API requests (${byPath.size} distinct paths):`,
    );
    for (const [p, e] of [...byPath].sort(
      (a, b) => b[1].roles.length - a[1].roles.length,
    )) {
      console.log(`  ${p} (${e.roles.length} roles): ${e.warning}`);
    }
  }
  if (failures.length > 0) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
