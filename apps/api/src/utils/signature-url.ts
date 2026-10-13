import { config } from '../config';

/**
 * Where a certificate's signature image may be loaded from.
 *
 * `signatureUrl` is rendered by the certificate detail page as `<img src>`, so
 * an attacker-supplied value is a stored-SSRF / request-to-attacker-host vector
 * (and an IP-leak beacon for whoever opens the page). The field is free text on
 * a create form, so it must be constrained to hosts the yayasan itself serves —
 * the two application hosts and stored uploads on them.
 *
 * Same-site absolute URLs (`/uploads/…`) are accepted too: they resolve against
 * whichever host renders the page and cannot point anywhere else.
 *
 * The rule is by host, not by scheme, because both application hosts may be
 * reached over http in development and https in production; only the host
 * decides where a request lands.
 */
const ALLOWED_SIGNATURE_HOSTS: readonly string[] = (() => {
  const hosts = new Set<string>();
  for (const base of [config.publicSiteUrl, config.portalUrl]) {
    try {
      hosts.add(new URL(base).host);
    } catch {
      // A malformed configured URL simply contributes no host.
    }
  }
  // The local development hosts (web :3000, API :3001) so a signature picked
  // from a dev upload previews without weakening the production rule.
  hosts.add('localhost:3000');
  hosts.add('localhost:3001');
  hosts.add('127.0.0.1:3000');
  hosts.add('127.0.0.1:3001');
  return [...hosts];
})();

/**
 * True when `url` may be stored as a certificate signature image: a
 * root-relative path, or an absolute http(s) URL on an allowed host.
 */
export function isAllowedSignatureUrl(url: string): boolean {
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  return ALLOWED_SIGNATURE_HOSTS.includes(parsed.host);
}
