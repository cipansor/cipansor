/**
 * What the API client does when a call answers 401 and the refresh fails.
 *
 * Two regressions this pins, both invisible to a signed-in e2e run:
 * - an anonymous visitor on a public page (the SPMB page reads /units) was
 *   sent to the staff login screen, because the client no longer checked that
 *   there had been a session to lose;
 * - the check must be read before the refresh, since a refused refresh clears
 *   the session cookies in its own response.
 */
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { api } from "./api";
import { dropLegacySessionTokens } from "@/stores/auth";

const CSRF = "cipansor_csrf";

function failWith(status: number, config: InternalAxiosRequestConfig) {
  return new AxiosError(`HTTP ${status}`, "ERR_BAD_REQUEST", config, null, {
    status,
    statusText: "",
    headers: {},
    config,
    data: {},
  });
}

let location: { pathname: string; href: string };
const originalLocation = window.location;

beforeEach(() => {
  // Every protected call answers 401.
  api.defaults.adapter = (config) => Promise.reject(failWith(401, config));
  location = { pathname: "/dashboard", href: "http://localhost/dashboard" };
  Object.defineProperty(window, "location", {
    value: location,
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.cookie = `${CSRF}=; path=/; max-age=0`;
  Object.defineProperty(window, "location", {
    value: originalLocation,
    writable: true,
    configurable: true,
  });
});

/** The refresh answers `status` and, like the API, clears the CSRF cookie. */
function refreshFails(status: number) {
  return vi.spyOn(axios, "post").mockImplementation(async (url) => {
    expect(String(url)).toMatch(/\/auth\/refresh$/);
    document.cookie = `${CSRF}=; path=/; max-age=0`;
    throw failWith(status, { headers: {} } as InternalAxiosRequestConfig);
  });
}

describe("a 401", () => {
  it("leaves an anonymous visitor where they are, without a refresh", async () => {
    location.pathname = "/public/spmb";
    location.href = "http://localhost/public/spmb";
    const refresh = refreshFails(401);

    await expect(api.get("/units")).rejects.toBeInstanceOf(AxiosError);
    // No session, so no refresh either: it would spend the per-IP auth rate
    // limit on every anonymous page.
    expect(refresh).not.toHaveBeenCalled();
    expect(location.href).toBe("http://localhost/public/spmb");
  });

  it("sends a signed-in user to the login, even though the refresh cleared the cookie", async () => {
    document.cookie = `${CSRF}=abc; path=/`;
    refreshFails(401);

    await expect(api.get("/auth/me")).rejects.toBeInstanceOf(AxiosError);
    expect(location.href).toBe("/login");
  });

  it("keeps the session when the refresh failed for a reason that says nothing about it", async () => {
    document.cookie = `${CSRF}=abc; path=/`;
    vi.spyOn(axios, "post").mockRejectedValue(
      failWith(429, { headers: {} } as InternalAxiosRequestConfig),
    );

    await expect(api.get("/auth/me")).rejects.toBeInstanceOf(AxiosError);
    expect(location.href).toBe("http://localhost/dashboard");
  });

  it("does not refresh a request that left anonymously, even if a session lands before its 401", async () => {
    // The e2e flake this pins (#1144): the login screen fires /auth/me with no
    // session; the test then injects one, and only then does that anonymous
    // 401 arrive. Judged by the cookie at error time it looks like a lost
    // session, so the client refreshes — rotating the shared refresh token and
    // logging out every other worker. It must judge by the state at send time.
    const refresh = vi.spyOn(axios, "post").mockResolvedValue({} as never);
    api.defaults.adapter = (config) => {
      // The sign-in sets the session while this anonymous request is in flight.
      document.cookie = `${CSRF}=abc; path=/`;
      return Promise.reject(failWith(401, config));
    };

    await expect(api.get("/auth/me")).rejects.toBeInstanceOf(AxiosError);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("dropLegacySessionTokens", () => {
  it("removes the tokens the old client kept where script could read them", () => {
    localStorage.setItem("accessToken", "old-access");
    localStorage.setItem("refreshToken", "old-refresh");
    localStorage.setItem("auth-storage", '{"state":{}}');

    dropLegacySessionTokens();

    expect(localStorage.getItem("accessToken")).toBeNull();
    expect(localStorage.getItem("refreshToken")).toBeNull();
    // The cached user is not a credential and stays.
    expect(localStorage.getItem("auth-storage")).toBe('{"state":{}}');
  });
});
