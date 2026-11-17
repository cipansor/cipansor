import type { PrivacyPolicyCurrentDTO } from "@cipansor/shared";
import { apiOriginForServer } from "@/lib/api-origin.server";

/**
 * How long the server waits for the policy before rendering without it.
 *
 * The policy page is one of the pages the Ad Grants reviewer and a prospective
 * parent may open; a connection that stays open without answering must not hold
 * the whole page. On expiry the request is aborted and the page degrades to
 * "not published yet", exactly as a network error does.
 */
export const POLICY_FETCH_TIMEOUT_MS = 3000;

/**
 * How long the server reuses a fetched policy, in seconds.
 *
 * A published version changes rarely (the foundation issues a new one, not an
 * edit), so one fetch serves every visitor in the window instead of one API
 * call per view.
 */
export const POLICY_REVALIDATE_SECONDS = 300;

/**
 * How long a single, immutable version may be cached, in seconds.
 *
 * A published version is never edited (that is the whole point of versioning),
 * so its text cannot go stale; one year is effectively "keep it".
 */
export const POLICY_VERSION_REVALIDATE_SECONDS = 31_536_000;

/**
 * The currently-effective Kebijakan Privasi, fetched on the server for the
 * public page and for the SPMB form's consent text.
 *
 * Why the server and not the client: the page is a server component, and the
 * consent link must point at a page that already says which version the reader
 * is consenting to. `null` means the foundation has not published a version
 * yet — the page says so, and the API refuses a consent that names no version.
 *
 * A failure — a network error, a non-OK response, or the deadline above — all
 * degrade to `null` rather than a crashed or stalled page.
 */
export async function fetchCurrentPrivacyPolicy(): Promise<PrivacyPolicyCurrentDTO | null> {
  return fetchPolicy(
    `${apiOriginForServer()}/api/privacy-policy/current`,
    POLICY_REVALIDATE_SECONDS,
  );
}

/**
 * One specific published version, fetched on the server for the public page when
 * the SPMB consent link pins a number (`/kebijakan-privasi?version=N`).
 *
 * The point is that the page a parent reads and the version the form records are
 * the same number. The current-version read above is cached for
 * `POLICY_REVALIDATE_SECONDS`, so right after a publication it can still serve
 * the previous text; a versioned read cannot — that text never changes. A
 * missing version (or any failure) degrades to `null`, exactly as above.
 */
export async function fetchPrivacyPolicyVersion(
  version: number,
): Promise<PrivacyPolicyCurrentDTO | null> {
  return fetchPolicy(
    `${apiOriginForServer()}/api/privacy-policy/versions/${version}`,
    // A published version is immutable, so it may be cached for a long time.
    POLICY_VERSION_REVALIDATE_SECONDS,
  );
}

async function fetchPolicy(
  url: string,
  revalidateSeconds: number,
): Promise<PrivacyPolicyCurrentDTO | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLICY_FETCH_TIMEOUT_MS);
  // Node timers carry `unref`; a pending deadline must not hold the process.
  (timer as unknown as { unref?: () => void }).unref?.();
  try {
    const response = await fetch(url, {
      next: { revalidate: revalidateSeconds },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      data?: PrivacyPolicyCurrentDTO | null;
    };
    return body.data ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
