import * as fs from "fs";
import * as path from "path";
import {
  apiLoginNew,
  buildStorageState,
  refreshSession,
  SEED_USERS,
  sessionKey,
  sessionsFileFor,
  type AuthSession,
} from "./helpers/auth-api";
import { E2E_WORKERS } from "./helpers/workers";

/**
 * Playwright Global Setup for Cipansor E2E Tests
 *
 * 1. Verify backend and frontend are reachable.
 * 2. Pre-authenticate the seed roles via the API (completing the admin 2FA gate
 *    with a fixed-secret TOTP) and write Playwright storageState files, so specs
 *    can `test.use({ storageState: ".auth/superAdmin.json" })`. This replaces the
 *    old UI login, which couldn't authenticate admins and waited on the wrong URL.
 */

const baseURL = process.env.BASE_URL || "http://localhost:3000";
const apiURL = process.env.API_URL || "http://localhost:3001/api";
// The health endpoint is mounted at the server root (/health), not under /api.
const healthURL = `${apiURL.replace(/\/api\/?$/, "")}/health`;

// Roles to pre-authenticate → storageState file name (under apps/web/.auth).
const ROLE_FILES: Record<keyof typeof SEED_USERS, string> = {
  superAdmin: "superAdmin",
  adminSdit: "adminSdit",
  teacher: "teacher",
  parent: "parent",
  student: "student",
  ketuaPengurus: "ketuaPengurus",
  pengawas: "pengawas",
  pembina: "pembina",
};

async function globalSetup() {
  console.log("🚀 Starting E2E Test Global Setup...");
  console.log(`📍 Base URL: ${baseURL}`);
  console.log(`📍 API URL: ${apiURL}`);

  const authDir = path.join(__dirname, "../.auth");
  fs.mkdirSync(authDir, { recursive: true });

  // 1. Backend health.
  let backendAvailable = false;
  try {
    const response = await fetch(healthURL);
    backendAvailable = response.ok;
    console.log(
      backendAvailable
        ? "✅ Backend API is healthy"
        : `⚠️ Backend API health check failed: ${response.status}`,
    );
  } catch (error) {
    console.warn("⚠️ Backend API is not accessible:", error);
  }

  // 2. Frontend reachable.
  try {
    const response = await fetch(baseURL);
    if (response.ok || response.status === 404) {
      console.log("✅ Frontend is accessible");
    } else {
      console.warn(`⚠️ Frontend check failed: ${response.status}`);
    }
  } catch (error) {
    console.warn("⚠️ Frontend is not accessible:", error);
  }

  // 3. Pre-authenticate roles via the API and persist storageState, plus one
  //    raw session store per worker (`.auth/sessions.w<N>.json`) that
  //    loginAs/apiLogin in that worker reads — so the whole run performs each
  //    login (and admin 2FA) once per role per worker instead of once per test,
  //    which trips the 2FA limiter. Sessions from a previous run are reused
  //    only by rotating them against `/auth/refresh`, so iterative local runs
  //    usually perform ZERO 2FA logins and never approach the limiter.
  //
  //    One store per worker, not one shared file (#1144): the API rotates a
  //    refresh token on first use and deletes the presented row, so a session
  //    two workers both held was revoked the moment either refreshed — the
  //    other was answered 401 and bounced to `/login` mid-test.
  const previous: Record<string, AuthSession>[] = [];
  for (let worker = 0; worker < E2E_WORKERS; worker++) {
    try {
      previous[worker] = JSON.parse(
        fs.readFileSync(sessionsFileFor(worker), "utf8"),
      );
    } catch {
      previous[worker] = {};
    }
    fs.rmSync(sessionsFileFor(worker), { force: true }); // workers only see verified sessions
  }

  // A stored session is reused only by *rotating* it against `/auth/refresh`,
  // which also proves it still works. It cannot be validated with `/auth/me`
  // and kept as-is: the API deletes a refresh token the moment it is used, so
  // the stored one is dead even while its access token still answers (#1144).
  const reusableSession = async (
    session: AuthSession | undefined,
  ): Promise<AuthSession | null> => {
    if (!session) return null;
    return refreshSession(session);
  };

  if (backendAvailable) {
    console.log(
      `🔐 Pre-authenticating roles via API (${E2E_WORKERS} worker sessions each)...`,
    );
    const stores: Record<string, AuthSession>[] = [];
    for (let worker = 0; worker < E2E_WORKERS; worker++) {
      stores[worker] = {};
    }
    for (const [role, file] of Object.entries(ROLE_FILES)) {
      const user = SEED_USERS[role as keyof typeof SEED_USERS];
      for (let worker = 0; worker < E2E_WORKERS; worker++) {
        const key = sessionKey(user.email);
        try {
          const session =
            (await reusableSession(previous[worker][key])) ??
            (await apiLoginNew(user));
          stores[worker][key] = session;
          // The storageState files are read-only in every spec that uses them
          // (none rotates its token), so one file per role is enough; worker
          // 0's session stands in for it.
          if (worker === 0) {
            fs.writeFileSync(
              path.join(authDir, `${file}.json`),
              JSON.stringify(buildStorageState(session), null, 2),
            );
          }
        } catch (error) {
          console.warn(
            `⚠️ Failed to pre-authenticate ${role} (worker ${worker}):`,
            error,
          );
        }
      }
      console.log(`✅ Saved sessions for ${role}`);
    }
    for (let worker = 0; worker < E2E_WORKERS; worker++) {
      fs.writeFileSync(
        sessionsFileFor(worker),
        JSON.stringify(stores[worker], null, 2),
      );
    }
  } else {
    console.log("⚠️ Skipping pre-authentication (backend unavailable).");
  }

  console.log("✅ Global Setup Complete\n");
}

export default globalSetup;
