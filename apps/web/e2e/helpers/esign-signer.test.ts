import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AuthSession } from "./auth-api";
import { ensureSigner, SIGNER_PASSPHRASE } from "./esign-signer";

/**
 * `ensureSigner` reuses a warm key without ever writing to it, and must not
 * guess at a stored passphrase it cannot read.
 *
 * Two properties are pinned here, both of which a review has already caught:
 *
 *  - The helper makes no call to the passphrase endpoint. The stored passphrase
 *    is scrypt-sealed and unobservable, and the only endpoint that could check
 *    it rewrites the key material — a fixture must not mutate what it inspects.
 *  - When it cannot vouch for the key, it says what it actually knows. An
 *    EXPIRED/REVOKED key cannot sign regardless of passphrase, and the identity
 *    of such a key is not frozen (`saveMyIdentity` refuses only while the key is
 *    live), so a name mismatch there proves nothing — it must not be reported as
 *    "not sealed with SIGNER_PASSPHRASE".
 *
 * `apiRequest` resolves the whole `{ success, data }` envelope; the stub answers
 * with one.
 */

const session: AuthSession = {
  user: { id: "u-1", email: "superadmin@cipansor.or.id", role: "SUPER_ADMIN" },
  accessToken: "access-1",
  refreshToken: "refresh-1",
  csrfToken: "csrf-1",
};

const SIGNER_LEGAL_NAME = "Super Admin E2E";

/** Answer `GET /esign/me` with the given key state and identity name. */
function stubStatus(state: string | null, legalName: string | null): string[] {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${String(url)}`);
      const data = {
        hasKey: state !== null,
        state,
        approvedAwaitingActivation: false,
        pendingRequest: null,
        identity: { legalName },
      };
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data }),
      } as unknown as Response;
    }),
  );
  return calls;
}

describe("ensureSigner warm-key reuse", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses a live key without touching the passphrase endpoint", async () => {
    const calls = stubStatus("ACTIVE", SIGNER_LEGAL_NAME);

    const fixture = await ensureSigner(session);

    expect(fixture).toEqual({ session, userId: "u-1" });
    expect(calls).toHaveLength(1);
    expect(calls.some((c) => c.includes("/esign/me/passphrase"))).toBe(false);
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
  });

  it("reports an expired key as unable to sign, not as a passphrase fault", async () => {
    stubStatus("EXPIRED", SIGNER_LEGAL_NAME);

    await expect(ensureSigner(session)).rejects.toThrow(/EXPIRED/);
    await expect(ensureSigner(session)).rejects.toThrow(
      /cannot sign regardless of passphrase/,
    );
    await expect(ensureSigner(session)).rejects.not.toThrow(
      /not sealed with SIGNER_PASSPHRASE/,
    );
  });

  it("reports a revoked key as unable to sign, not as a passphrase fault", async () => {
    stubStatus("REVOKED", SIGNER_LEGAL_NAME);

    await expect(ensureSigner(session)).rejects.toThrow(/REVOKED/);
    await expect(ensureSigner(session)).rejects.toThrow(
      /cannot sign regardless of passphrase/,
    );
  });

  it("says the passphrase is unknown for a live key from elsewhere", async () => {
    stubStatus("ACTIVE", "Nama Lain");

    await expect(ensureSigner(session)).rejects.toThrow(
      /passphrase is not known to be SIGNER_PASSPHRASE/,
    );
    // It cannot claim the key is sealed with a different passphrase either.
    await expect(ensureSigner(session)).rejects.not.toThrow(
      /not sealed with SIGNER_PASSPHRASE/,
    );
  });

  it("still refuses a key left mid-enrolment", async () => {
    stubStatus("PENDING_APPROVAL", SIGNER_LEGAL_NAME);

    await expect(ensureSigner(session)).rejects.toThrow(/PENDING_APPROVAL/);
  });

  it("never sends the passphrase as a request body", async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.body) bodies.push(String(init.body));
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              success: true,
              data: {
                hasKey: true,
                state: "ACTIVE",
                approvedAwaitingActivation: false,
                pendingRequest: null,
                identity: { legalName: SIGNER_LEGAL_NAME },
              },
            }),
        } as unknown as Response;
      }),
    );

    await ensureSigner(session);

    expect(bodies.join(" ")).not.toContain(SIGNER_PASSPHRASE);
  });
});
