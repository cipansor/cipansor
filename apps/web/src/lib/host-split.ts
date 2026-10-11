/**
 * Which host serves which pages.
 *
 * The public site and the information system now live on separate hosts:
 *
 *   cipansor.or.id         — landing, profil, unit, berita, galeri, wakaf, kontak, verifikasi
 *   portal.cipansor.or.id  — login and everything behind it
 *
 * The split is enforced here rather than in nginx because the route table lives
 * in this codebase; nginx would have to be edited every time a page is added,
 * and the copy that drifts is the one that causes the outage.
 *
 * WHY SPLIT AT ALL. Whether a page is public is decided by `publicPrefixes` in
 * middleware.ts — a list maintained by hand. A page added under a new prefix
 * that nobody remembers to list bounces a prospective parent to the staff login
 * screen, which is what got the Ad Grants application rejected once already.
 * Serving the marketing site from a host that has no application on it makes
 * "public" the default there instead of something to remember.
 *
 * A CONSEQUENCE WORTH KNOWING. Sessions do not cross hosts: the token lives in
 * localStorage (per-origin) and the `auth-storage` cookie is host-only, with no
 * `domain=` attribute. So after the split the apex effectively only ever sees
 * signed-out visitors, and the portal holds the whole session. That is the
 * intended shape, and it is also why per-unit subdomains were rejected — a
 * bendahara holding roles in two units would have had to sign in twice.
 */

export const PUBLIC_HOST = "cipansor.or.id";
export const PORTAL_HOST = "portal.cipansor.or.id";

/**
 * Paths that belong to the public site. Kept in step with `publicPrefixes` in
 * middleware.ts — that list decides what may be read without a session, this
 * one decides which host serves it, and they describe the same set.
 */
export const PUBLIC_PATH_PREFIXES = [
  "/profil",
  "/program-unggulan",
  "/unit",
  "/campus",
  "/activities",
  "/berita",
  "/galeri",
  "/wakaf-infaq",
  "/kontak",
  /**
   * Where a letter's printed QR code used to point.
   *
   * Load-bearing in a way the others are not: the URLs are on paper already, in
   * the hands of dinas offices and wali santri. The page they opened has been
   * retired in favour of uploading the document itself, but the path must keep
   * resolving on the apex — now as a 308 to /public/verify-letter — for as long
   * as those letters exist. It can never migrate to the portal.
   */
  "/verifikasi",
  /**
   * Where a printed student ID card's QR points. It is a `/public/*` page, so
   * the middleware matcher already exempts it from the session wall AND from
   * the host split — `hostSplitActionFor` never runs on it. It is listed here
   * only to keep the two canonical lists in step (Flag 11): the lists describe
   * the same set of public pages, and a reader comparing them should not have
   * to know which entries the matcher makes redundant.
   */
  "/public/verify-card",
  /**
   * Where the public key-status page lives (AATL ICA7). Also a `/public/*`
   * page, so the middleware matcher already exempts it from the session wall —
   * but it must be classified here too, or `hostSplitActionFor` answers 404 on
   * `cipansor.or.id` (the host the verification pages are printed with) and the
   * page is served only behind the portal login. Flagged by review: the
   * anonymous Playwright test runs on localhost, which bypasses the host split,
   * so nothing else would have caught it.
   */
  "/public/verify-key",
  /**
   * Where a printed sanad/syahadah's QR points (`certificateVerificationUrl`).
   * Same as `/public/verify-card` above: matcher-exempt from both the session
   * wall and the host split, listed only so the two canonical lists stay in
   * step (Flag 11).
   */
  "/public/verify-sanad",
];

/** True when the request arrived on the portal, ignoring case and port. */
export function isPortalHost(host: string | null | undefined): boolean {
  return (host ?? "").split(":")[0].toLowerCase() === PORTAL_HOST;
}

/**
 * True when the request arrived on the public site (apex or www).
 *
 * Deliberately false for localhost and previews, so anything gated on this
 * keeps its single-host behaviour in development.
 */
export function isPublicSiteHost(host: string | null | undefined): boolean {
  const name = (host ?? "").split(":")[0].toLowerCase();
  return name === PUBLIC_HOST || name === `www.${PUBLIC_HOST}`;
}

/**
 * Whether this host should ship the PWA — manifest, service worker, install
 * banner.
 *
 * One build serves both hosts, so anything in the root layout's `<head>` is
 * emitted on the marketing site too unless it is asked to stop. Before this,
 * the apex advertised itself as an installable app: `<link rel="manifest">` on
 * every page, `/sw.js` registered on first visit, and a floating "Pasang
 * aplikasi Cipansor" banner shown to prospective parents reading /profil.
 *
 * Three reasons that is wrong, in order of how much they cost:
 *
 *  1. What gets installed is the brochure. `start_url` is "/", which on the
 *     apex is the landing page, and all three manifest `shortcuts` — /dashboard,
 *     /attendance, /students — answer 404 there. The visitor installs an icon
 *     that opens a website and a menu of three dead links.
 *  2. Sessions do not cross hosts (see the note at the top of this file), so an
 *     app installed from the apex could never sign anyone in even if the routes
 *     existed. The application is at portal.cipansor.or.id; that is the only
 *     origin where an installed app means anything.
 *  3. sw.js intercepts navigations and serves static assets cache-first. On the
 *     marketing site — the one Google's reviewers actually visit — that puts a
 *     cache in front of the pages whose freshness we are being judged on.
 *
 * NOTE THE POLARITY. This is "off on the public site", not "on for the portal".
 * `isPublicSiteHost` is deliberately false for localhost and previews, so the
 * PWA keeps working in `pnpm dev` and anywhere else; only the two marketing
 * names turn it off. Written the other way round, every developer would lose
 * the ability to test the install flow locally.
 */
export function pwaEnabledForHost(host: string | null | undefined): boolean {
  return !isPublicSiteHost(host);
}

/**
 * Whether search engines should index this host.
 *
 * The public site is the whole point of being indexed. The portal is a sign-in
 * screen guarding an internal system: indexing it duplicates nothing useful and
 * puts the staff login form in search results next to the pesantren's own
 * pages. middleware.ts already calls the portal "a noindex host" in a comment
 * explaining why "/" is not rendered there — this is the code that makes the
 * comment true.
 *
 * Same polarity argument as above: unknown hosts (localhost, previews) are
 * indexable here, which costs nothing because nothing crawls them.
 */
export function indexableHost(host: string | null | undefined): boolean {
  return !isPortalHost(host);
}

/** Matches on segment boundaries, so "/unit" never also grants "/units". */
function underPublicPrefix(pathname: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * What to do with a request, decided by the host it arrived on.
 *
 *   { kind: "redirect", host }  send it to the other host
 *   { kind: "notFound" }        answer 404 here
 *   null                        answer it here, normally
 *
 * `null` for any host that is not one of the two production names — localhost,
 * preview deployments and the container's own healthcheck all keep today's
 * single-host behaviour, so `pnpm dev` is unaffected.
 */
export type HostSplitAction =
  { kind: "redirect"; host: string } | { kind: "notFound" };

export function hostSplitActionFor(
  host: string | null | undefined,
  pathname: string,
): HostSplitAction | null {
  // Strip the port: `localhost:3000` and a Host header carrying one must still
  // compare cleanly against the bare names above.
  const name = (host ?? "").split(":")[0].toLowerCase();

  const isPortal = name === PORTAL_HOST;
  const isPublic = name === PUBLIC_HOST || name === `www.${PUBLIC_HOST}`;
  if (!isPortal && !isPublic) return null;

  const isPublicPath = pathname === "/" || underPublicPrefix(pathname);

  // The application asked for on the public host: 404. The apex has no
  // application on it, and saying so is the honest answer.
  //
  // It used to redirect to the portal. Two reasons that was wrong. It implied
  // the application also lives at cipansor.or.id — the exact assumption the
  // split exists to remove — and it protected nothing, because nothing has ever
  // linked here: the site has never been in production, so there is no bookmark
  // and no habit to catch.
  //
  // NOTE for anyone tempted to just delete this branch: deleting it does not
  // produce a 404. Control falls through to the auth check below in
  // middleware.ts, which redirects an anonymous visitor to `/login` — and
  // `/login` is in `publicRoutes`, so the apex would serve the login form
  // again. The 404 has to be explicit or the form comes back through the side
  // door.
  if (isPublic && !isPublicPath) return { kind: "notFound" };

  // Marketing pages asked for on the portal — send them to the canonical host,
  // so there is one indexable address per page rather than two.
  //
  // "/" is deliberately excluded: on the portal the root is the way in to the
  // application, and middleware.ts turns it into the dashboard or the login
  // screen. Redirecting it to the apex would strand anyone who typed the portal
  // name on the marketing site instead.
  //
  // This direction stays a redirect rather than a 404: the page genuinely
  // exists, it just belongs to the other host, and there is exactly one address
  // that should be indexed for it.
  if (isPortal && pathname !== "/" && isPublicPath) {
    return { kind: "redirect", host: PUBLIC_HOST };
  }

  return null;
}
