import { chromium } from "@playwright/test";
import { DEMO_ACCOUNTS } from "@cipansor/shared";

const API = "http://localhost:3001/api";
const WEB = "http://localhost:3000";

async function main() {
  const acc = DEMO_ACCOUNTS.find((a) => a.roleCode === "SUPER_ADMIN")!;
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: acc.email, password: acc.password }),
  });
  const body = await r.json();
  const session = body?.data;
  const token = session?.accessToken ?? session?.token;
  if (!token)
    throw new Error("no token: " + JSON.stringify(body).slice(0, 300));

  const origin = new URL(WEB).origin;
  const u = session.user;
  const slimUser = {
    id: u.id,
    role: u.role,
    unitId: u.unitId,
    userRoles: (u.userRoles ?? []).map((a: any) => ({
      isPrimary: a.isPrimary,
      role: { code: a.role?.code },
    })),
  };
  const mk = (name: string, value: string) => ({
    name,
    value,
    domain: new URL(WEB).hostname,
    path: "/",
    expires: Math.floor(Date.now() / 1000) + 86400,
    httpOnly: false,
    secure: false,
    sameSite: "Lax" as const,
  });
  const authStorage = JSON.stringify({
    state: { user: session.user, isAuthenticated: true },
    version: 0,
  });

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: {
      cookies: [
        mk("accessToken", session.accessToken),
        mk(
          "auth-storage",
          encodeURIComponent(
            JSON.stringify({
              state: { user: slimUser, isAuthenticated: true },
              version: 0,
            }),
          ),
        ),
      ],
      origins: [
        {
          origin,
          localStorage: [
            { name: "accessToken", value: session.accessToken },
            { name: "refreshToken", value: session.refreshToken },
            { name: "auth-storage", value: authStorage },
          ],
        },
      ],
    },
  });
  const page = await ctx.newPage();
  const target = process.argv[2];
  await page.goto(WEB + target, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  const info = await page.evaluate(`(() => {
    const main = document.querySelector("main");
    const mr = main.getBoundingClientRect();
    const cs = getComputedStyle(main);
    const contentRight = mr.right - parseFloat(cs.paddingRight || "0");
    const contentLeft = mr.left + parseFloat(cs.paddingLeft || "0");
    const rows = [];
    const walk = (el, depth) => {
      const he = el;
      const r = he.getBoundingClientRect();
      const over =
        he.scrollWidth > he.clientWidth + 2 ||
        r.right > contentRight + 2 ||
        r.left < contentLeft - 2;
      if (over) {
        const tag = he.tagName;
        if (!["svg", "path", "circle", "line", "rect", "polyline", "g", "polygon"].includes(tag)) {
          rows.push({
            tag,
            cls: String(he.className || "").slice(0, 110),
            right: Math.round(r.right),
            left: Math.round(r.left),
            sw: he.scrollWidth,
            cw: he.clientWidth,
            depth,
            text: (he.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 45),
          });
        }
      }
      Array.from(el.children).forEach((c) => walk(c, depth + 1));
    };
    walk(main, 0);
    const deep = rows.filter(
      (r) => !rows.some((o) => o.depth === r.depth + 1 && o.left >= r.left - 30 && o.right <= r.right + 30 && o !== r),
    );
    return {
      mainClient: main.clientWidth,
      mainScroll: main.scrollWidth,
      contentRight: Math.round(contentRight),
      contentLeft: Math.round(contentLeft),
      total: rows.length,
      deep: deep.slice(0, 14),
    };
  })()`);
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
}
main();
