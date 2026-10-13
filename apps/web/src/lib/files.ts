/**
 * The API serves /uploads behind authentication (files hold student photos
 * and documents). Browser-native fetches — <img src>, <a href>, window.open,
 * <object data> — cannot send an Authorization header, and they cannot add a
 * header at all. They *do* send cookies, so the HttpOnly session cookie the
 * API issued authenticates them with no token in the URL.
 *
 * The helper remains as the one place an upload URL is routed through, but it
 * no longer reads or appends a token: there is none in JavaScript's reach, and
 * the API no longer accepts `?token=` (a token in a URL lands in the access
 * log). Non-upload URLs pass through untouched.
 */
export function authFileUrl(url: string | null | undefined): string {
  return url ?? "";
}

/**
 * Create a preview URL for a picked file, guaranteed to be a `blob:` URL.
 *
 * `URL.createObjectURL` is modelled as a taint step into an `<img src>` sink
 * (CodeQL js/xss-through-dom). Its result is always a `blob:` URL, so the value
 * is used as a URL and never as markup; the `blob:` check keeps it that way even
 * if that ever stops being true — CodeQL's `PrefixStringSanitizer` recognises
 * the guard, so the accepted value can be handed back unmodified.
 *
 * Do not re-encode the URL. A blob URL embeds the page origin; on an IPv6 host
 * the serialized host carries square brackets, and `encodeURI` would turn
 * `blob:http://[::1]:3000/abc` into `blob:http://%5B::1%5D:3000/abc`. The
 * browser registered the original spelling, so the altered one no longer names
 * the blob and the preview fails to resolve.
 */
export function objectUrlForFile(file: Blob): string {
  const url = URL.createObjectURL(file);
  return url.startsWith("blob:") ? url : "";
}

/**
 * Create a `blob:` URL for an already-fetched `Blob` (a downloaded export).
 *
 * Same guarantee and same CodeQL-sanitised shape as `objectUrlForFile`: the
 * result is a URL, never markup, and the `blob:` guard keeps it that way.
 */
export function objectUrlForBlob(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  return url.startsWith("blob:") ? url : "";
}

/**
 * Release a preview URL returned by `objectUrlForFile`. A blob URL pins the
 * file's bytes in memory until it is revoked, so a preview that is replaced or
 * discarded must be released explicitly; revoking twice is a no-op.
 */
export function releaseObjectUrl(url: string | null | undefined): void {
  if (!url || !url.startsWith("blob:")) return;
  URL.revokeObjectURL(url);
}
