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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), POLICY_FETCH_TIMEOUT_MS);
  // Node timers carry `unref`; a pending deadline must not hold the process.
  (timer as unknown as { unref?: () => void }).unref?.();
  try {
    const origin = apiOriginForServer();
    const response = await fetch(`${origin}/api/privacy-policy/current`, {
      next: { revalidate: POLICY_REVALIDATE_SECONDS },
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
