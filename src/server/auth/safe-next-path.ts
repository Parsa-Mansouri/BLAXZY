const MAX_LENGTH = 2048;
const PLACEHOLDER_ORIGIN = "http://blaxzy.invalid";

/**
 * Returns `value` when it is a same-origin relative path (`/projects/1?tab=a#b`), otherwise
 * `fallback`. Use it on every user-supplied redirect target (`?next=`) to prevent open redirects.
 *
 * Rejected: absolute URLs, protocol-relative `//host`, backslashes (browsers read `\` as `/`),
 * control characters and whitespace (stripped by URL parsers, so `/\t/host` becomes `//host`),
 * and anything that does not resolve to the same origin.
 */
export function safeNextPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) {
    return fallback;
  }
  if (!value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f\s]/.test(value)) return fallback;

  let url: URL;
  try {
    url = new URL(value, PLACEHOLDER_ORIGIN);
  } catch {
    return fallback;
  }
  if (url.origin !== PLACEHOLDER_ORIGIN) return fallback;

  const path = `${url.pathname}${url.search}${url.hash}`;
  // Normalisation (for example `/./%2e/` segments) must not turn it into `//host`.
  return path.startsWith("//") ? fallback : path;
}
