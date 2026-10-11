import { describe, expect, it } from "vitest";
import { parseSetCookies, splitSetCookieHeader } from "./set-cookie";

/**
 * The four cookies the API sets, exactly as `setSessionCookies` orders them
 * (access, refresh, routing principal, CSRF) and as Express serializes them —
 * with the `Expires` date that contains a comma. Node's `fetch` joins repeated
 * `Set-Cookie` fields into one comma-and-space string, so this is the input
 * `parseSetCookies` really sees.
 */
const REAL_HEADERS = [
  "cipansor_at=eyJhbGciOiJIUzI1NiJ9.access; Max-Age=900; Path=/; Expires=Wed, 07 Oct 2026 21:35:30 GMT; HttpOnly; SameSite=Lax",
  "cipansor_rt=eyJhbGciOiJIUzI1NiJ9.refresh; Max-Age=2592000; Path=/api/auth; Expires=Fri, 06 Nov 2026 21:35:30 GMT; HttpOnly; SameSite=Lax",
  "cipansor_principal=%7B%22id%22%3A%22u-1%22%2C%22role%22%3A%22SUPER_ADMIN%22%2C%22roleCode%22%3A%22SUPER_ADMIN%22%7D; Max-Age=2592000; Path=/; Expires=Fri, 06 Nov 2026 21:35:30 GMT; HttpOnly; SameSite=Lax",
  "cipansor_csrf=0123456789abcdef; Max-Age=2592000; Path=/; Expires=Fri, 06 Nov 2026 21:35:30 GMT; SameSite=Lax",
];

const JOINED = REAL_HEADERS.join(", ");

describe("parseSetCookies", () => {
  it("reads all four cookies from getSetCookie()", () => {
    const headers = {
      get: () => JOINED,
      getSetCookie: () => REAL_HEADERS,
    };
    const cookies = parseSetCookies(headers);
    expect(cookies.map((c) => c.name)).toEqual([
      "cipansor_at",
      "cipansor_rt",
      "cipansor_principal",
      "cipansor_csrf",
    ]);
    expect(cookies.find((c) => c.name === "cipansor_at")?.value).toBe(
      "eyJhbGciOiJIUzI1NiJ9.access",
    );
    expect(
      cookies.find((c) => c.name === "cipansor_principal")?.value,
    ).toContain("SUPER_ADMIN");
  });

  it("reads all four cookies from the joined header when getSetCookie is absent", () => {
    const cookies = parseSetCookies({ get: () => JOINED });
    expect(cookies.map((c) => c.name)).toEqual([
      "cipansor_at",
      "cipansor_rt",
      "cipansor_principal",
      "cipansor_csrf",
    ]);
  });

  it("does not split an Expires date into a bogus cookie", () => {
    const cookies = parseSetCookies({ get: () => JOINED });
    // The bug the naive `split(",")` produced: "07 Oct 2026 21:35:30 GMT" as a
    // cookie named "07 Oct 2026 21:35:30 GMT".
    expect(cookies.some((c) => c.name.includes(" "))).toBe(false);
    expect(cookies).toHaveLength(4);
  });

  it("returns nothing when no cookie was set", () => {
    expect(parseSetCookies({ get: () => null })).toEqual([]);
    expect(
      parseSetCookies({ get: () => null, getSetCookie: () => [] }),
    ).toEqual([]);
  });
});

describe("splitSetCookieHeader", () => {
  it("keeps a comma-bearing Expires inside its own cookie", () => {
    expect(splitSetCookieHeader(JOINED)).toHaveLength(4);
  });

  it("splits a minimal joined header", () => {
    expect(splitSetCookieHeader("a=1; Path=/, b=2; Path=/")).toEqual([
      "a=1; Path=/",
      "b=2; Path=/",
    ]);
  });
});
