import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import type { AuthSession } from "./auth-api";

/**
 * The e2e harness injects a session the same shape the API now issues: the
 * bearer tokens as HttpOnly cookies, and only the *user* in localStorage. If a
 * helper ever went back to seeding a token into localStorage (or dropped the
 * `httpOnly` flag off the session cookie), the suite would pass while testing a
 * world the app no longer lives in — and a regression in the real migration
 * could slip through green e2e. These assertions keep the fixture honest.
 *
 * `BASE_URL` is set before the dynamic import: Vite defines
 * `process.env.BASE_URL` as its config `base` ("/") under vitest, and the
 * helper reads it at module load.
 */
process.env.BASE_URL = "http://localhost:3000";
let api: typeof import("./auth-api");
beforeAll(async () => {
  api = await import("./auth-api");
});

const session: AuthSession = {
  user: { id: "u-1", email: "guru@example.test", role: "TEACHER" },
  accessToken: "access-1",
  refreshToken: "refresh-1",
  csrfToken: "csrf-1",
};

describe("buildStorageState", () => {
  it("stores the session tokens as HttpOnly cookies", () => {
    const state = api.buildStorageState(session);
    const access = state.cookies.find((c) => c.name === api.ACCESS_COOKIE)!;
    const refresh = state.cookies.find((c) => c.name === api.REFRESH_COOKIE)!;
    expect(access.value).toBe("access-1");
    expect(access.httpOnly).toBe(true);
    expect(refresh.value).toBe("refresh-1");
    expect(refresh.httpOnly).toBe(true);
  });

  it("keeps the CSRF cookie readable so the client can echo it", () => {
    const state = api.buildStorageState(session);
    const csrf = state.cookies.find((c) => c.name === api.CSRF_COOKIE)!;
    expect(csrf.value).toBe("csrf-1");
    expect(csrf.httpOnly).toBe(false);
  });

  it("persists the user but no bearer token in localStorage", () => {
    const state = api.buildStorageState(session);
    const entries = state.origins[0].localStorage;
    const authStorage = JSON.parse(
      entries.find((e) => e.name === "auth-storage")!.value,
    );
    expect(authStorage.state.user).toEqual(session.user);
    expect(authStorage.state.accessToken).toBeUndefined();
    expect(authStorage.state.refreshToken).toBeUndefined();

    const serialized = JSON.stringify(state.origins);
    expect(serialized).not.toContain("access-1");
    expect(serialized).not.toContain("refresh-1");
    expect(serialized).not.toContain("accessToken");
    expect(serialized).not.toContain("refreshToken");
  });

  it("routes by the API's own routing cookie when the sign-in carried one", () => {
    // ketua@: STAFF in the legacy column, Ketua Pengurus by assignment. The API
    // routes the assignment; a value derived from `user.role` would not.
    const ketua: AuthSession = {
      ...session,
      user: { id: "u-2", email: "ketua@example.test", role: "STAFF" },
      principal: JSON.stringify({
        id: "u-2",
        role: "UNIT_ADMIN",
        roleCode: "YAYASAN_KETUA",
      }),
    };
    const state = api.buildStorageState(ketua);
    const principal = state.cookies.find(
      (c) => c.name === api.PRINCIPAL_COOKIE,
    )!;
    expect(JSON.parse(principal.value).role).toBe("UNIT_ADMIN");
    expect(principal.httpOnly).toBe(true);
  });
});

describe("the storageState mirror follows worker 0 (#1144)", () => {
  // `writeSessionsFile` writes into the real (gitignored) `.auth/`; snapshot and
  // restore so a run does not disturb the files a concurrent e2e run reads.
  const seed = {
    ...session,
    user: { id: "u-1", email: "superadmin@cipansor.or.id" },
  };
  const email = seed.user.email;
  const files = [".auth/sessions.w0.json", ".auth/sessions.w1.json"];
  const backups = new Map<string, string | null>();
  const roleFile = () => api.storageStateFileFor(email)!;

  beforeAll(() => {
    for (const f of [...files, roleFile()]) {
      backups.set(f, fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);
    }
  });

  function restore() {
    for (const [f, content] of backups) {
      if (content === null) fs.rmSync(f, { force: true });
      else fs.writeFileSync(f, content);
    }
  }

  function mirrorRefreshToken(): string {
    const mirror = JSON.parse(fs.readFileSync(roleFile(), "utf8"));
    return mirror.cookies.find(
      (c: { name: string }) => c.name === api.REFRESH_COOKIE,
    ).value;
  }

  it("maps a seed email to its role file, and rejects any other", () => {
    expect(api.storageStateFileFor("superadmin@cipansor.or.id")).toMatch(
      /\.auth\/superAdmin\.json$/,
    );
    expect(api.storageStateFileFor("nobody@example.test")).toBeNull();
  });

  it("rewrites the mirror when worker 0's session rotates", () => {
    try {
      api.writeSessionsFile(0, {
        [email]: { ...seed, refreshToken: "rt-new" },
      });
      expect(mirrorRefreshToken()).toBe("rt-new");
    } finally {
      restore();
    }
  });

  it("leaves the mirror alone for a non-zero worker", () => {
    try {
      api.writeSessionsFile(0, { [email]: { ...seed, refreshToken: "rt-a" } });
      api.writeSessionsFile(1, { [email]: { ...seed, refreshToken: "rt-b" } });
      expect(mirrorRefreshToken()).toBe("rt-a");
    } finally {
      restore();
    }
  });
});
