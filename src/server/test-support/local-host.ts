/**
 * Which hosts count as "this machine or the local docker-compose stack". Shared by the test
 * global setup and the dev scripts so both refuse to touch a remote database or object store by
 * accident. Pure (no I/O) so it can be unit-tested.
 */

/** docker-compose service names (docker-compose.yml) and the usual host aliases. */
export const LOCAL_HOST_ALLOWLIST: readonly string[] = [
  "localhost",
  "127.0.0.1",
  "::1",
  "postgres",
  "minio",
  "host.docker.internal",
];

/** The host of a URL (brackets stripped from IPv6), or null when it does not parse. */
export function hostOfUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host.replace(/^\[(.*)\]$/, "$1");
  } catch {
    return null;
  }
}

export function isLocalHost(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/^\[(.*)\]$/, "$1");
  return LOCAL_HOST_ALLOWLIST.includes(h) || h.endsWith(".localhost");
}

export function isLocalUrl(url: string): boolean {
  return isLocalHost(hostOfUrl(url));
}
