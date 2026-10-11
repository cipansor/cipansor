import { apiLogin, apiRequest, SEED_USERS, type AuthSession } from "./auth-api";

/**
 * A real signing authority: enrol a key through the actual API chain.
 *
 * The verification spec used to mock `POST /esign/verify-pdf`, which proved
 * only that the page renders a JSON payload — not that the signed PDF and the
 * verification response agree, which is the whole claim of a signature. This
 * helper drives the real chain instead: identity → KTP upload → key request →
 * Super Admin approval → passphrase activation. Every step goes through the
 * same endpoints the UI calls, so the resulting key is one a person could
 * really have.
 *
 * The Super Admin's own account is the signer: it is seeded, it has the fixed
 * TOTP secret, and it is the only role that may approve the request it also
 * makes. Enrolment is idempotent — a key that already exists is reused — so the
 * spec can run repeatedly against a warm database without a fresh seed.
 */

const KTP_PNG = Buffer.from(
  // A 1×1 transparent PNG. The identity gate only checks the MIME type and
  // stores the bytes; it never decodes the image.
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** A valid Indonesian NIK whose embedded birth date matches `BIRTH_DATE`. */
const NIK = "3273010101900001";
const BIRTH_DATE = "1990-01-01";
export const SIGNER_PASSPHRASE = "passphrase-e2e-yang-panjang";

/**
 * The identity this fixture writes before it requests a key.
 *
 * Used as a read-only marker of a fixture-enrolled key: an account whose key
 * came from somewhere else carries a different legal name, and the spec can say
 * so plainly instead of failing at the signing step with a passphrase error
 * that reads like a product bug.
 */
const SIGNER_LEGAL_NAME = "Super Admin E2E";

export interface SignerFixture {
  session: AuthSession;
  userId: string;
}

/**
 * Enrol `session`'s user as a signer and return the activated session.
 *
 * If the account already holds a key, it is reused as-is. There is deliberately
 * no probe of the stored passphrase: the passphrase is sealed with scrypt and
 * is not observable from outside, so the only endpoint that could confirm it is
 * the one that *changes* it — which rewrites the stored key material and spends
 * a passphrase rate-limit slot on every run, even when the passphrase already
 * matches. The spec proves the passphrase the honest way: it signs a real
 * letter, and a key that was sealed with some other passphrase fails there with
 * the API's "Passphrase tanda tangan salah".
 *
 * A warm key that clearly cannot sign — expired, revoked, or left mid-enrolment
 * — is refused here with its own reason. A key that merely came from somewhere
 * else is refused with what can actually be known: its passphrase is not
 * guaranteed to be `SIGNER_PASSPHRASE`, because the identity that would show
 * this fixture wrote it is not.
 */
export async function ensureSigner(
  session: AuthSession,
): Promise<SignerFixture> {
  const userId = String(session.user.id);

  const status = await apiRequest<{
    data: {
      hasKey: boolean;
      state: string | null;
      approvedAwaitingActivation: boolean;
      pendingRequest: { id: string } | null;
      identity: { legalName: string | null };
    };
  }>(session, "GET", "/esign/me");

  if (status.data.hasKey) {
    if (status.data.state === "PENDING_APPROVAL") {
      throw new Error(
        `Signer key for ${userId} is PENDING_APPROVAL — an earlier run left it ` +
          "mid-enrolment. Re-seed the database to reset the e-sign state.",
      );
    }
    // A key that cannot sign regardless of passphrase: say so, and say why.
    // The identity of such a key is *not* frozen (saveMyIdentity only refuses
    // while the key is live), so the identity check below would misreport it.
    if (status.data.state === "EXPIRED" || status.data.state === "REVOKED") {
      throw new Error(
        `Signer key for ${userId} is ${status.data.state}, so it cannot sign ` +
          "regardless of passphrase. Re-seed the database " +
          "(ALLOW_DESTRUCTIVE_SEED=1 E2E_FIXED_2FA=1 pnpm --filter api db:seed) " +
          "to reset the e-sign state.",
      );
    }
    // Read-only check that this fixture sealed the key. A stored passphrase is
    // sealed with scrypt and cannot be read back, so this proves nothing about
    // it; what it proves is that the account carries a *different* identity
    // from the one this fixture writes, so the key came from elsewhere and its
    // passphrase is unknown. State it as unknown, not as wrong — a live key's
    // identity is frozen, but "not this fixture's key" still does not by itself
    // make the passphrase differ.
    if (status.data.identity?.legalName !== SIGNER_LEGAL_NAME) {
      throw new Error(
        `Signing key for ${userId} was not enrolled by this fixture ` +
          `(identity is "${status.data.identity?.legalName ?? "unset"}", not ` +
          `"${SIGNER_LEGAL_NAME}"), so its passphrase is not known to be ` +
          `SIGNER_PASSPHRASE. Re-seed the database ` +
          `(ALLOW_DESTRUCTIVE_SEED=1 E2E_FIXED_2FA=1 pnpm --filter api db:seed) ` +
          `to reset the e-sign state.`,
      );
    }
    return { session, userId };
  }

  // Identity first: the service refuses a key request until the record is
  // complete *and* a KTP file is on it.
  await apiRequest(session, "PUT", "/esign/me/identity", {
    legalName: SIGNER_LEGAL_NAME,
    nik: NIK,
    birthPlace: "Ciamis",
    birthDate: BIRTH_DATE,
  });

  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(KTP_PNG)], { type: "image/png" }),
    "ktp.png",
  );
  const ktpRes = await fetch(
    `${process.env.API_URL || "http://localhost:3001/api"}/esign/me/identity/ktp`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${session.accessToken}` },
      body: form,
    },
  );
  if (!ktpRes.ok) {
    throw new Error(
      `KTP upload failed: ${ktpRes.status} ${(await ktpRes.text()).slice(0, 200)}`,
    );
  }

  if (!status.data.approvedAwaitingActivation) {
    if (!status.data.pendingRequest) {
      await apiRequest(session, "POST", "/esign/me/request", {
        reason: "Enrolment for the signing-authority e2e flow.",
      });
    }

    // The same Super Admin account approves its own request. `identityVerification`
    // is required because the identity has never been verified, and it is the
    // act that records the KTP was opened and matched.
    //
    // `apiRequest` resolves the whole `{ success, data }` envelope, not the
    // array inside it — reading `requests.find` here failed on CI the moment a
    // fresh database reached this branch.
    const requests = await apiRequest<{
      data: Array<{ id: string; status: string; user: { id: string } }>;
    }>(session, "GET", "/esign/requests?status=PENDING");
    const pending = requests.data.find(
      (r) => r.user?.id === userId && r.status === "PENDING",
    );
    if (!pending) {
      throw new Error(
        "No pending signing-key request found for the signer — cannot approve.",
      );
    }

    await apiRequest(session, "POST", `/esign/requests/${pending.id}/decide`, {
      approve: true,
      grantedDays: 365,
      identityVerification: { note: "KTP diperiksa: data cocok (e2e)." },
    });
  }

  await apiRequest(session, "POST", "/esign/me/activate", {
    passphrase: SIGNER_PASSPHRASE,
  });

  const after = await apiRequest<{ data: { hasKey: boolean; state: string } }>(
    session,
    "GET",
    "/esign/me",
  );
  if (!after.data.hasKey || after.data.state !== "ACTIVE") {
    throw new Error(
      `Signer enrolment did not reach ACTIVE: ${JSON.stringify(after.data)}`,
    );
  }

  return { session, userId };
}

/** Enrol the seeded Super Admin as a signer. */
export async function ensureSuperAdminSigner(): Promise<SignerFixture> {
  const session = await apiLogin(SEED_USERS.superAdmin);
  return ensureSigner(session);
}
