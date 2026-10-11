/**
 * Storyboard + atlas capture for the application documents.
 *
 *   FLOWS  — a business process, step by step, described in a JSON file (no
 *            Playwright code to write). Every step may assert what must be on
 *            screen (`see`) BEFORE it takes the screenshot, so a picture can
 *            never show a screen that does not say what the manual claims.
 *   ATLAS  — one screenshot of every page in every role's menu (nested items
 *            included), with the menu group and title, as a manifest.
 *
 * Run from apps/web (the `@/` alias and node_modules resolve from there):
 *
 *   cd apps/web
 *   export PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome   # adjust
 *   ../api/node_modules/.bin/tsx ../../.claude/skills/screenshot-roles/scripts/screenshot-flow.ts \
 *       flow  ../../docs/alur/absensi-harian.flow.json  --out /tmp/capture
 *   ../api/node_modules/.bin/tsx ../../.claude/skills/screenshot-roles/scripts/screenshot-flow.ts \
 *       atlas sdit.walikelas@cipansor.or.id SDIT_TATA_USAHA --out /tmp/capture   # or: atlas all
 *   ../api/node_modules/.bin/tsx ../../.claude/skills/screenshot-roles/scripts/screenshot-flow.ts \
 *       plan  SMPIT_GURU                                                  # list pages, no browser
 *
 * Needs the local stack seeded with E2E_FIXED_2FA=1 (skill `stack`). Login goes
 * through apps/web/e2e/helpers/auth-api.ts — the helper the e2e suite keeps
 * current with the cookie session — never through its own copy.
 *
 * Output: <out>/<flow>/<step id>.png + flow-report.json ;
 *         <out>/atlas/<account>/<path>.png + atlas-report.json.
 * Exit code 1 when any step or page fails.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "fs";
import path from "path";
import os from "os";
import { createRequire } from "module";

// ------------------------------------------------------------------ plumbing

function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error("pnpm-workspace.yaml not found above the working directory");
}
const REPO = findRepoRoot();
const WEB = path.join(REPO, "apps/web");
if (path.resolve(process.cwd()) !== WEB) {
  console.error(`Run from ${WEB} (cd apps/web) so the "@/" alias resolves.`);
  process.exit(2);
}
const webRequire = createRequire(path.join(WEB, "package.json"));
const { chromium } = webRequire("@playwright/test");
const auth = webRequire(path.join(WEB, "e2e/helpers/auth-api.ts"));
const { DEMO_ACCOUNTS } = webRequire("@cipansor/shared");

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const VIEWPORT = { width: 1280, height: 800 };

// ------------------------------------------------------------------ types

type Locator =
  | string
  | {
      role?: string;
      name?: string;
      label?: string;
      placeholder?: string;
      text?: string;
      testid?: string;
      css?: string;
      exact?: boolean;
      nth?: number;
    };

interface Step {
  id: string;
  as?: string; // demo e-mail (sdit.walikelas@cipansor.or.id) or role code; "publik" = not signed in; a new session from this step on
  goto?: string;
  click?: Locator;
  fill?: { target: Locator; value: string };
  press?: string;
  /**
   * Ordered interactions, run in the order written. Use this when the order
   * matters — filling an optional note *inside* a dialog before clicking its
   * submit button. The flat `click`/`fill`/`press` fields are a fixed sequence
   * (click, then fill, then press) kept for the common click-then-fill step;
   * `actions`, when present, run after them. A step that needs fill-then-click
   * must use `actions` — the flat fields cannot express it.
   */
  actions?: StepAction[];
  wait?: number; // ms
  see?: string[]; // texts that must be visible before the screenshot
  not_see?: string[];
  shot?: "after" | "before" | false; // default "after"
  highlight?: Locator; // outlined in the screenshot
  // What to photograph: the whole window (default), "main" (the page body without the
  // sidebar — larger text in a manual; a toast outside <main> is then not in the picture),
  // or one element, e.g. {"role":"dialog"} for a dialog.
  area?: "page" | "main" | Locator;
  caption?: string; // carried into the report; the manual's figure caption
  full_page?: boolean;
}

/** One interaction in a step's ordered `actions` list. */
type StepAction =
  | { click: Locator }
  | { fill: { target: Locator; value: string } }
  | { press: string }
  | { wait: number };
/**
 * Data a flow needs before the first screen — created through the API as a real
 * user, like the e2e specs do (e.g. a draft RKA Yayasan to ratify). `save` maps a
 * variable name to a dotted path in the JSON answer ("data.id", "data.classes.0.name");
 * later steps use it as {{name}} in goto, fill values and see/not_see texts.
 * Built-ins: {{stamp}} (unique per run), {{year}} (a far-future year), {{today}}.
 */
interface Setup {
  as: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string; // API path without /api, e.g. "/attendance/me/classes"
  body?: unknown;
  /** A file to upload as multipart `file` (repo-relative path); the step's
   *  `body` string is then used as the file name. */
  file?: string;
  /** A step that may already be done on a re-run (e.g. enrolling a signing key).
   *  A 4xx answer is then not fatal — the flow continues. */
  optional?: boolean;
  save?: Record<string, string>;
}
interface Flow {
  name: string;
  title?: string;
  setup?: Setup[];
  steps: Step[];
}

// ------------------------------------------------------------------ helpers

function locate(page: any, l: Locator): any {
  if (typeof l === "string") {
    // Shorthand: a button, link, tab, menu item or plain text with that name.
    return page
      .getByRole("button", { name: l })
      .or(page.getByRole("link", { name: l }))
      .or(page.getByRole("tab", { name: l }))
      .or(page.getByRole("menuitem", { name: l }))
      .or(page.getByRole("checkbox", { name: l }))
      .or(page.getByText(l, { exact: true }))
      .first();
  }
  let out: any;
  if (l.role) out = page.getByRole(l.role, { name: l.name, exact: l.exact });
  else if (l.label) out = page.getByLabel(l.label, { exact: l.exact });
  else if (l.placeholder)
    out = page.getByPlaceholder(l.placeholder, { exact: l.exact });
  else if (l.text) out = page.getByText(l.text, { exact: l.exact });
  else if (l.testid) out = page.getByTestId(l.testid);
  else if (l.css) out = page.locator(l.css);
  else throw new Error(`locator has no role/label/placeholder/text/testid/css`);
  return out.nth(l.nth ?? 0);
}

async function settle(page: any) {
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(350);
}

/**
 * Whether any occurrence of `text` is on screen, waiting up to `timeout` ms.
 *
 * A plain `getByText(t).first().waitFor()` is not enough: Radix Select keeps a
 * visually hidden native `<select>` whose `<option>` carries the same label, so
 * `.first()` can land on an invisible node and declare a visible screen absent.
 * The loop polls every match until one is visible.
 */
async function anyVisible(
  page: any,
  text: string,
  timeout = 0,
): Promise<boolean> {
  const deadline = Date.now() + timeout;
  do {
    const all = page.getByText(text);
    const n = await all.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      if (
        await all
          .nth(i)
          .isVisible()
          .catch(() => false)
      )
        return true;
    }
    if (Date.now() >= deadline) return false;
    await page.waitForTimeout(150);
  } while (true);
}

async function outline(el: any, on: boolean) {
  await el
    .evaluate((node: HTMLElement, enable: boolean) => {
      if (enable) {
        node.dataset.prevOutline = node.style.outline;
        node.style.outline = "3px solid #e11d48";
        node.style.outlineOffset = "2px";
      } else {
        node.style.outline = node.dataset.prevOutline ?? "";
      }
    }, on)
    .catch(() => {});
}

async function dump(page: any): Promise<string> {
  // What is on screen, in words — for a reader who cannot look at the picture.
  const grab = async (sel: string, n: number) =>
    (
      await page
        .locator(sel)
        .allInnerTexts()
        .catch(() => [])
    )
      .map((t: string) => t.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, n);
  const lines = [
    `url: ${page.url()}`,
    `title: ${await page.title().catch(() => "")}`,
    `headings: ${(await grab("h1, h2, h3", 12)).join(" | ")}`,
    `buttons: ${(await grab("button", 30)).join(" | ")}`,
    `links: ${(await grab("a", 20)).join(" | ")}`,
    `labels: ${(await grab("label", 20)).join(" | ")}`,
    `alerts: ${(await grab("[role=alert], [data-sonner-toast]", 5)).join(" | ")}`,
  ];
  return lines.join("\n    ");
}

/**
 * A demo account by e-mail (exact) or by role code (the first one). Prefer the
 * e-mail: several accounts share a role code (sdit.guru, sdit.walikelas and
 * sdit.wakasek are all SDIT_GURU) and only the wali kelas has a class of their own.
 */
function accountFor(key: string) {
  const acc = DEMO_ACCOUNTS.find(
    (a: any) => a.email === key || a.roleCode === key,
  );
  if (!acc)
    throw new Error(
      `no demo account for "${key}" — use an e-mail or role code from packages/shared/src/types/demo-accounts.ts`,
    );
  return acc;
}

async function newSession(browser: any, key: string) {
  if (key === "publik") {
    // No login: the public site (SPMB registration, tracking, verification pages).
    const context = await browser.newContext({ viewport: VIEWPORT });
    return { context, page: await context.newPage() };
  }
  const acc = accountFor(key);
  const session = await auth.apiLogin({
    email: acc.email,
    password: acc.password,
  });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await auth.injectSession(page, session);
  return { context, page };
}

function launch() {
  return chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

// ------------------------------------------------------------------ flow

function dig(obj: any, dotted: string): unknown {
  return dotted.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);
}

/**
 * A multipart upload for `setup` steps that carry a file (the KTP photo).
 *
 * `auth.apiRequest` speaks JSON only, so the form is built here against the
 * real API with the session's bearer token. The file path is relative to the
 * repo root; the step's `body` string names the upload.
 */
async function uploadFile(
  session: { accessToken: string },
  apiPath: string,
  relFile: string,
  fileName: string,
) {
  const API_URL = process.env.API_URL || "http://localhost:3001/api";
  const abs = path.isAbsolute(relFile) ? relFile : path.join(REPO, relFile);
  if (!fs.existsSync(abs)) throw new Error(`upload file not found: ${abs}`);
  const ext = path.extname(abs).slice(1) || "png";
  const type =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "pdf"
        ? "application/pdf"
        : ext === "webp"
          ? "image/webp"
          : "image/png";
  const form = new FormData();
  form.append(
    "file",
    new Blob([fs.readFileSync(abs)], { type }),
    fileName || `upload.${ext}`,
  );
  const res = await fetch(`${API_URL}${apiPath}`, {
    method: "POST",
    headers: { authorization: `Bearer ${session.accessToken}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`POST ${apiPath} → ${res.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

async function runFlow(browser: any, file: string, outRoot: string) {
  const raw: Flow = JSON.parse(fs.readFileSync(file, "utf8"));
  const dir = path.join(outRoot, raw.name);
  fs.mkdirSync(dir, { recursive: true });

  // --- setup through the API, then substitute {{variables}} everywhere
  const vars: Record<string, string> = {
    stamp: String(Date.now()),
    year: String(2100 + (Date.now() % 7000)),
    today: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" }),
  };
  for (const st of raw.setup ?? []) {
    // A variable an earlier `optional` step failed to save (the e-sign key
    // already exists, so no request id came back) cannot be resolved. That is
    // the expected re-run path, not an error, and the flow's own steps do not
    // depend on it — so skip rather than throw.
    const missing = [...st.path.matchAll(/\{\{(\w+)\}\}/g)]
      .map((m) => m[1])
      .filter((k) => !(k in vars));
    if (missing.length && st.optional) {
      console.warn(
        `  ~ setup ${st.method} ${st.path}: skipped ({{${missing[0]}}} not set)`,
      );
      continue;
    }
    const acc = accountFor(st.as);
    const sess = await auth.apiLogin({
      email: acc.email,
      password: acc.password,
    });
    const sub = (s: string) =>
      s.replace(
        /\{\{(\w+)\}\}/g,
        (_: string, k: string) => vars[k] ?? `{{${k}}}`,
      );
    const body =
      st.body === undefined
        ? undefined
        : JSON.parse(
            JSON.stringify(st.body).replace(
              /\{\{(\w+)\}\}/g,
              (_: string, k: string) => vars[k] ?? `{{${k}}}`,
            ),
          );
    // A step with `file` is a multipart upload (e.g. the KTP photo); the API
    // helpers only speak JSON, so the form is built here from the session token.
    // An `optional` step is one a re-run may find already done — a 4xx is not
    // fatal then, so the same flow runs twice against a persistent demo DB.
    let ans: any;
    try {
      ans = st.file
        ? await uploadFile(sess, sub(st.path), st.file, sub(String(body ?? "")))
        : await auth.apiRequest(sess, st.method, sub(st.path), body);
    } catch (e: any) {
      if (!st.optional) throw e;
      console.warn(
        `  ~ setup ${st.method} ${st.path}: skipped (${String(e?.message).slice(0, 90)})`,
      );
      ans = {};
    }
    for (const [name, where] of Object.entries(st.save ?? {})) {
      const v = dig(ans, where);
      if (v === undefined || v === null) {
        // On an `optional` step (one a re-run finds already done) the answer is
        // empty, so a variable it would have saved is simply left unset.
        if (st.optional) {
          console.warn(
            `  ~ setup ${st.method} ${st.path}: no "${where}" to save`,
          );
          continue;
        }
        throw new Error(
          `setup ${st.method} ${st.path}: "${where}" not found in the answer`,
        );
      }
      vars[name] = String(v);
    }
  }
  // Setup steps the API declined (an `optional` step a re-run finds already
  // done) never ran, so drop them instead of letting an unresolved variable
  // they would have produced abort the whole flow. The flow's own steps do not
  // reference these — only later setup steps do.
  const usedVars = new Set(
    [...JSON.stringify(raw.steps ?? []).matchAll(/\{\{(\w+)\}\}/g)].map(
      (m) => m[1],
    ),
  );
  const keptSetup = (raw.setup ?? []).filter((st) => {
    const missing = [...st.path.matchAll(/\{\{(\w+)\}\}/g)]
      .map((m) => m[1])
      .filter((k) => !(k in vars));
    return !(missing.length && st.optional && !usedVars.has(missing[0]));
  });
  raw.setup = keptSetup;

  const flow: Flow = JSON.parse(
    JSON.stringify(raw).replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => {
      if (!(k in vars)) throw new Error(`unknown variable {{${k}}} in ${file}`);
      return vars[k].replace(/"/g, '\\"');
    }),
  );
  const report: any[] = [];
  let ctx: { context: any; page: any } | null = null;
  let ok = true;

  for (const [i, step] of flow.steps.entries()) {
    const problems: string[] = [];
    const png = path.join(dir, `${step.id}.png`);
    let shot = "";
    try {
      if (step.as) {
        if (ctx) await ctx.context.close();
        ctx = await newSession(browser, step.as);
      }
      if (!ctx) throw new Error(`step ${step.id}: the first step needs "as"`);
      const { page } = ctx;

      if (step.goto) {
        await page.goto(`${BASE_URL}${step.goto}`, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
      }
      await settle(page);

      const snap = async (name: string) => {
        if (step.area && step.area !== "page") {
          const el =
            step.area === "main"
              ? page.locator("main").first()
              : locate(page, step.area);
          await el.screenshot({ path: name });
        } else {
          await page.screenshot({
            path: name,
            fullPage: step.full_page ?? false,
          });
        }
      };
      const takeShot = async (name: string) => {
        if (step.highlight) await outline(locate(page, step.highlight), true);
        await snap(name);
        if (step.highlight) await outline(locate(page, step.highlight), false);
      };

      if (step.shot === "before") {
        const target =
          step.highlight ?? step.click ?? step.fill?.target ?? undefined;
        if (target) await outline(locate(page, target), true);
        await snap(png);
        if (target) await outline(locate(page, target), false);
        shot = png;
      }
      if (step.click) await locate(page, step.click).click({ timeout: 10000 });
      if (step.fill)
        await locate(page, step.fill.target).fill(step.fill.value, {
          timeout: 10000,
        });
      if (step.press) await page.keyboard.press(step.press);
      // Ordered interactions, for a step whose order the flat fields cannot
      // express (fill inside a dialog, then click its submit).
      for (const action of step.actions ?? []) {
        if ("click" in action)
          await locate(page, action.click).click({ timeout: 10000 });
        else if ("fill" in action)
          await locate(page, action.fill.target).fill(action.fill.value, {
            timeout: 10000,
          });
        else if ("press" in action) await page.keyboard.press(action.press);
        else if ("wait" in action) await page.waitForTimeout(action.wait);
      }
      if (step.wait) await page.waitForTimeout(step.wait);
      // With `see`, wait on the texts themselves: they are the sync point, and a
      // toast ("Kehadiran disimpan") is gone within seconds, so a network-idle
      // wait first would miss it. Without `see`, let the page settle.
      if (!step.see?.length) await settle(page);

      for (const t of step.see ?? []) {
        // Any *visible* match counts. Radix Select also renders a hidden native
        // <select> holding an <option> with the same text, so `.first()` alone
        // would match an invisible node and report a visible screen as missing.
        if (!(await anyVisible(page, t, 8000)))
          problems.push(`not visible: "${t}"`);
      }
      for (const t of step.not_see ?? []) {
        if (await anyVisible(page, t, 0))
          problems.push(`should not be visible: "${t}"`);
      }

      if (step.see?.length) await page.waitForTimeout(250);
      if (step.shot !== false && step.shot !== "before") {
        await takeShot(png);
        shot = png;
      }
      if (problems.length) {
        await page
          .screenshot({ path: png.replace(/\.png$/, ".FAILED.png") })
          .catch(() => {});
        problems.push(`on screen now:\n    ${await dump(page)}`);
      }
      report.push({
        id: step.id,
        ok: problems.length === 0,
        file: shot ? path.relative(outRoot, shot) : "",
        caption: step.caption ?? "",
        url: new URL(page.url()).pathname,
        see: step.see ?? [],
        problems,
      });
    } catch (e) {
      const page = ctx?.page;
      let where = "";
      if (page) {
        await page
          .screenshot({ path: png.replace(/\.png$/, ".FAILED.png") })
          .catch(() => {});
        where = `\n    on screen now:\n    ${await dump(page)}`;
      }
      problems.push(`${(e as Error).message.split("\n")[0]}${where}`);
      report.push({
        id: step.id,
        ok: false,
        file: "",
        caption: step.caption ?? "",
        url: page ? new URL(page.url()).pathname : "",
        see: step.see ?? [],
        problems,
      });
    }
    const last = report[report.length - 1];
    console.log(
      `${last.ok ? "✓" : "✗"} [${flow.name}] ${i + 1}/${flow.steps.length} ${step.id}` +
        (last.ok ? "" : `\n  ${last.problems.join("\n  ")}`),
    );
    if (!last.ok) {
      ok = false;
      break; // later steps depend on this one
    }
  }
  if (ctx) await ctx.context.close();
  fs.writeFileSync(
    path.join(dir, "flow-report.json"),
    JSON.stringify(
      { flow: flow.name, title: flow.title ?? "", ok, steps: report },
      null,
      2,
    ),
  );
  return ok;
}

// ------------------------------------------------------------------ atlas

interface AtlasPage {
  group: string;
  title: string;
  href: string;
  duty?: string; // pages of a duty group (Wali Kelas) exist only for someone holding the duty
}

function pagesFor(roleCode: string): AtlasPage[] {
  const nav = webRequire(path.join(WEB, "src/config/navigation.ts"));
  const rbac = webRequire(path.join(WEB, "src/lib/rbac.ts"));
  const out: AtlasPage[] = [];
  const dash = rbac.getDashboardForRole(
    rbac.deriveLegacyRole(roleCode),
    roleCode,
  );
  out.push({ group: "Ringkasan", title: "Dasbor", href: dash });
  const walk = (
    group: string,
    duty: string | undefined,
    items: any[],
    prefix: string,
  ) => {
    for (const it of items ?? []) {
      if (it.href)
        out.push({ group, duty, title: prefix + it.title, href: it.href });
      if (it.children?.length)
        walk(group, duty, it.children, `${prefix}${it.title} → `);
    }
  };
  for (const g of nav.getNavigationForRoleCode(roleCode))
    walk(g.title, g.duty, g.items, "");
  const seen = new Set<string>();
  return out.filter((p) => !seen.has(p.href) && seen.add(p.href));
}

async function runAtlas(browser: any, keys: string[], outRoot: string) {
  // One pass per ACCOUNT, not per role code: sdit.guru and sdit.walikelas share
  // SDIT_GURU but see different menus. "all" = every demo account.
  const accounts = keys.includes("all")
    ? DEMO_ACCOUNTS
    : keys.map((k) => accountFor(k));
  const results: any[] = [];
  for (const acc of accounts) {
    const roleCode = acc.roleCode as string;
    const label = (acc.email as string).split("@")[0];
    const dir = path.join(outRoot, "atlas", label);
    fs.mkdirSync(dir, { recursive: true });
    let ctx;
    try {
      ctx = await newSession(browser, acc.email);
    } catch (e) {
      console.log(`✗ LOGIN ${label}: ${(e as Error).message.split("\n")[0]}`);
      results.push({
        account: label,
        role: roleCode,
        href: "(login)",
        ok: false,
        problems: [(e as Error).message.split("\n")[0]],
      });
      continue;
    }
    const isWali = label.includes("walikelas");
    for (const p of pagesFor(roleCode)) {
      if (p.duty && !isWali) continue; // needs the duty; the walikelas account covers it
      const problems: string[] = [];
      const errors: string[] = [];
      const onConsole = (m: any) =>
        m.type() === "error" && errors.push(m.text());
      ctx.page.on("console", onConsole);
      try {
        await ctx.page.goto(`${BASE_URL}${p.href}`, {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        await settle(ctx.page);
      } catch (e) {
        problems.push(
          `navigation failed: ${(e as Error).message.split("\n")[0]}`,
        );
      }
      ctx.page.off("console", onConsole);
      const finalPath = new URL(ctx.page.url()).pathname;
      if (finalPath !== p.href && !finalPath.startsWith(`${p.href}/`))
        problems.push(`bounced to ${finalPath}`);
      const text = (
        await ctx.page
          .locator("body")
          .innerText()
          .catch(() => "")
      ).slice(0, 4000);
      for (const m of [
        "Application error",
        "This page could not be found",
        "Internal Server Error",
        "Unhandled Runtime Error",
      ])
        if (text.includes(m)) problems.push(`error text: ${m}`);
      const real = errors.filter((t) => !t.includes("Failed to load resource"));
      if (real.length) problems.push(`console: ${real[0].slice(0, 160)}`);
      const file = path.join(
        dir,
        `${p.href === "/" ? "root" : p.href.slice(1).replace(/\//g, "__")}.png`,
      );
      await ctx.page.screenshot({ path: file }).catch(() => {});
      results.push({
        account: label,
        role: roleCode,
        group: p.group,
        title: p.title,
        href: p.href,
        finalPath,
        ok: problems.length === 0,
        problems,
        file: path.relative(outRoot, file),
      });
      console.log(
        `${problems.length ? "✗" : "✓"} [${label}] ${p.href}${problems.length ? " — " + problems.join("; ") : ""}`,
      );
    }
    await ctx.context.close();
  }
  fs.mkdirSync(path.join(outRoot, "atlas"), { recursive: true });
  fs.writeFileSync(
    path.join(outRoot, "atlas", "atlas-report.json"),
    JSON.stringify(results, null, 2),
  );
  const bad = results.filter((r) => !r.ok);
  console.log(`\n${results.length} pages, ${bad.length} problems.`);
  return bad.length === 0;
}

// ------------------------------------------------------------------ main

async function main() {
  const [mode, ...rest] = process.argv.slice(2);
  const outRoot = path.resolve(
    arg("--out", path.join(os.tmpdir(), "cipansor-capture")),
  );
  const positional = rest.filter(
    (a, i) => !a.startsWith("--") && rest[i - 1] !== "--out",
  );

  if (mode === "plan") {
    const roles = positional.length
      ? positional.map((k) => accountFor(k))
      : DEMO_ACCOUNTS;
    const plan = Object.fromEntries(
      roles.map((a: any) => [a.email, pagesFor(a.roleCode)]),
    );
    console.log(JSON.stringify(plan, null, 2));
    return;
  }
  if (mode !== "flow" && mode !== "atlas") {
    console.error(
      "usage: screenshot-flow.ts flow <file.flow.json...> | atlas <email|ROLE_CODE...|all> | plan [email|ROLE_CODE...]  [--out DIR]",
    );
    process.exit(2);
  }
  fs.mkdirSync(outRoot, { recursive: true });
  const browser = await launch();
  let ok = true;
  try {
    if (mode === "flow") {
      if (!positional.length) throw new Error("give at least one *.flow.json");
      for (const f of positional)
        ok = (await runFlow(browser, path.resolve(f), outRoot)) && ok;
    } else {
      if (!positional.length)
        throw new Error("give demo e-mails / role codes, or: all");
      ok = await runAtlas(browser, positional, outRoot);
    }
  } finally {
    await browser.close();
  }
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
