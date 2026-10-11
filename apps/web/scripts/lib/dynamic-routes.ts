/**
 * The merge-and-account step of `resolve-dynamic-routes.ts`, kept pure and
 * importable so it can be unit-tested without a running stack.
 *
 * The resolver used to overwrite `dynamic-routes.json` with only the patterns
 * it resolved in that one run. A pattern it could not reach that day vanished
 * from the file, and with it every page only that entry reached — the map is
 * the sweep's coverage contract. So a pattern is kept even when this run could
 * not resolve it, with the last good URL.
 *
 * Keeping that URL is not free: after a reseed the id in it no longer exists,
 * and a sweep that visits it captures a 404 while believing the page is
 * covered. `staleIds` (the ids the previous map held that no longer exist in
 * the current data) is how the caller tells us which carried URLs are suspect.
 * A carried URL is reported as stale when it carries one of those ids — a
 * carried URL whose id is not known to be dead (e.g. the list request merely
 * failed, or the id is not a row id of any list) is reported as carried, not
 * stale, so a transient API failure does not read as a reseed.
 *
 * The caller's probe must be conservative for the same reason: `walkList`
 * only says `gone` once it has read the list to its end, and `unknown` on any
 * page it could not fetch, so a URL that is still live is never failed by a
 * probe that ran out of evidence.
 */

export interface MergeResult {
  /** Every pattern that has a URL (fresh this run, or carried from before). */
  merged: Record<string, string>;
  /** Patterns the run resolved to a fresh URL. */
  resolved: string[];
  /** Patterns that reused the previous map's URL. */
  carried: string[];
  /** Carried patterns whose URL carries an id known to no longer exist. */
  stale: string[];
  /** Patterns with no URL in either the fresh run or the previous map. */
  dropped: string[];
}

/**
 * The path segments of a concrete URL, without the query string.
 * `/counseling/abc/edit?x=1` -> `["counseling", "abc", "edit"]`.
 */
function concreteSegments(url: string): string[] {
  return url.split("?")[0].split("/").filter(Boolean);
}

/** The path segments of a `[param]` pattern. */
function patternSegments(pattern: string): string[] {
  return pattern.split("/").filter(Boolean);
}

/**
 * The concrete value of the pattern's *first* parameter in a URL that matches
 * its shape (`/counseling/abc` and `/counseling/abc/edit` both give `abc` for
 * `/counseling/[id]…`). This is the id a reseed replaces; the second and later
 * parameters of a multi-param pattern are not checked, but their first one is,
 * which is enough to catch a stale URL. Returns null when the URL does not
 * match the pattern at all.
 */
export function firstParamValue(url: string, pattern: string): string | null {
  const pathname = url.split("?")[0];
  if (!matchesDynamicPattern(pathname, pattern)) return null;
  const path = concreteSegments(pathname);
  const idx = patternSegments(pattern).findIndex((s) => s.startsWith("["));
  if (idx < 0 || idx >= path.length) return null;
  return path[idx];
}

/**
 * Carried patterns whose URL holds an id known to no longer exist. These are
 * the entries a reseed invalidates and the ones the caller must report as
 * failures (or refresh), because the sweep would otherwise visit an old id.
 */
export function staleCarriedPatterns(
  merged: Record<string, string>,
  carried: string[],
  staleIds: Set<string>,
): string[] {
  if (staleIds.size === 0) return [];
  return carried.filter((pattern) => {
    const id = firstParamValue(merged[pattern], pattern);
    return id !== null && staleIds.has(id);
  });
}

export function mergeResolved(
  patterns: string[],
  resolved: Record<string, string>,
  previous: Record<string, string>,
  staleIds: Set<string> = new Set(),
): MergeResult {
  const merged: Record<string, string> = {};
  const resolvedPatterns: string[] = [];
  const carried: string[] = [];
  const dropped: string[] = [];
  for (const pattern of patterns) {
    const fresh = resolved[pattern];
    if (fresh) {
      merged[pattern] = fresh;
      resolvedPatterns.push(pattern);
      continue;
    }
    const carriedUrl = previous[pattern];
    if (carriedUrl) {
      merged[pattern] = carriedUrl;
      carried.push(pattern);
    } else {
      dropped.push(pattern);
    }
  }
  return {
    merged,
    resolved: resolvedPatterns,
    carried,
    stale: staleCarriedPatterns(merged, carried, staleIds),
    dropped,
  };
}

/**
 * What a liveness probe learned about one saved id.
 *
 * - `live` — a page of the list returned the id; the URL is still good.
 * - `gone` — the list was read to its end and never returned the id; the row
 *   is gone (a reseed replaced it) and the URL would 404.
 * - `unknown` — a page could not be fetched, so nothing may be concluded; the
 *   id stays carried rather than failed. This is the case that keeps a list
 *   outage, or a probe that does not understand the endpoint, from reading as a
 *   reseed.
 */
export type ProbeVerdict = "live" | "gone" | "unknown";

/**
 * Whether a row holds `value` as any of its own primitive fields. The URL
 * parameter is not always the row's `id` — `/hr/employees/[id]` holds a
 * `userId`, a certificate URL holds a `certificateNumber` — so a probe that
 * only looked at `r.id` would call those live URLs gone. Comparing against
 * every scalar the row carries is the general answer, and it cannot invent a
 * match: only a real field value counts.
 */
export function rowHasValue(row: unknown, value: string): boolean {
  if (typeof row === "string") return row === value;
  if (!row || typeof row !== "object") return false;
  for (const v of Object.values(row)) {
    if (typeof v === "string" && v === value) return true;
    if (typeof v === "number" && String(v) === value) return true;
  }
  return false;
}

/** One page a `walkList` read: the ids on it, and whether it failed or was last. */
export interface PageProbe {
  ids: string[];
  /** A non-OK response: the page could not be read. */
  failed?: boolean;
  /** The list reported no further page. */
  last: boolean;
}

/**
 * Walk a paginated list for one id, one page at a time, and say what that
 * proves. The walk stops as soon as the id appears (`live`) or the last page is
 * reached (`gone`); a failed page or the page cap leaves it `unknown`, never
 * `gone`, so a row that sits beyond the pages the walk could read — the exact
 * case of a PENDING permit that drifted past the first page — is not declared
 * dead.
 */
export async function walkList(
  id: string,
  readPage: (page: number) => Promise<PageProbe>,
  maxPages = 50,
): Promise<ProbeVerdict> {
  for (let page = 1; page <= maxPages; page++) {
    const probe = await readPage(page);
    if (probe.failed) return "unknown";
    if (probe.ids.includes(id)) return "live";
    if (probe.last) return "gone";
  }
  return "unknown";
}

/** The dropped patterns that `dynamic-routes.unresolved.json` does not name. */
export function unaccountedPatterns(
  dropped: string[],
  allowlisted: Record<string, unknown>,
): string[] {
  return dropped.filter((pattern) => !(pattern in allowlisted));
}

/**
 * Whether a concrete route path is an instance of a `[param]` pattern.
 * `[param]` matches exactly one path segment; every other segment is literal.
 *
 * One definition, used by `screenshot-all.ts` (to decide what the sweep still
 * needs to reach) and by `dynamic-routes.guard.test.ts` (to check each resolved
 * URL). Two copies would drift, and a mismatch there is invisible until a page
 * silently leaves the gallery.
 */
export function matchesDynamicPattern(
  routePath: string,
  pattern: string,
): boolean {
  const rx = new RegExp(
    "^" +
      pattern
        .split("/")
        .map((seg) =>
          /^\[.*\]$/.test(seg)
            ? "[^/]+"
            : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
        )
        .join("/") +
      "/?$",
  );
  return rx.test(routePath);
}
