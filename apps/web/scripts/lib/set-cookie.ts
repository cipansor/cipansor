/**
 * Split the `Set-Cookie` header(s) a login response carries.
 *
 * Node's `fetch` (undici) exposes repeated `Set-Cookie` fields through
 * `headers.get("set-cookie")` as one comma-and-space joined string — see
 * undici's `Headers.prototype.get` for `set-cookie`. Splitting that on every
 * comma also splits the `Expires=Wed, 07 Oct 2026 …` date, so the naive split
 * mangles the principal cookie and the sweep's authenticated pages bounce back
 * to `/login`.
 *
 * `getSetCookie()` is the correct API: undici returns one string per header,
 * with no joining to undo. It is the primary path; the string fallback below
 * exists only for a response object that predates it.
 */

/**
 * Split a comma-joined `Set-Cookie` string into its individual cookies.
 *
 * A boundary is a comma that starts the next `name=value` pair. Requiring the
 * name to follow the comma directly keeps the comma inside an `Expires` date
 * (which is followed by a space and a day number, not `name=`) from splitting.
 * Each piece still carries its own attributes; callers take the leading pair.
 */
export function splitSetCookieHeader(joined: string): string[] {
  return joined
    .split(/,(?=[^;=]+=)/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** A `Set-Cookie` value in the shape Playwright's `addCookies` accepts. */
export interface ParsedSetCookie {
  name: string;
  value: string;
}

/**
 * The name/value of every cookie a response set, in header order.
 *
 * `getSetCookie()` when the runtime offers it; the joined header otherwise.
 */
export function parseSetCookies(headers: {
  get(name: string): string | null;
  getSetCookie?(): string[];
}): ParsedSetCookie[] {
  const fields =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : splitSetCookieHeader(headers.get("set-cookie") ?? "");

  return fields
    .map((field) => field.split(";")[0].trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq <= 0) return null;
      return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1) };
    })
    .filter((c): c is ParsedSetCookie => c !== null);
}
