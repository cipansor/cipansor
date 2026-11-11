import { test, expect } from "@playwright/test";

/**
 * The offline banner proves the network works by asking the web origin for
 * `/ping` (app/ping/route.ts). It used to ask `/api/health`, which nginx sends
 * to the API's clinic module (404), so a working network read as offline. The
 * probe must answer without a session and without a redirect to /login.
 */
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Probe koneksi /ping", () => {
  test("GET /ping menjawab 200 tanpa sesi dan tanpa pengalihan", async ({
    request,
  }) => {
    const res = await request.get("/ping", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("HEAD /ping menjawab 200 tanpa sesi", async ({ request }) => {
    const res = await request.head("/ping", { maxRedirects: 0 });
    expect(res.status()).toBe(200);
  });

  test("path lain yang diawali ping tetap melewati middleware", async ({
    request,
  }) => {
    const res = await request.get("/pingdom", { maxRedirects: 0 });
    expect(res.status()).not.toBe(200);
  });
});
