/**
 * Auth values shared by the better-auth config and the route-protection proxy. This file must
 * stay free of env, database and Node-only imports: the proxy imports it.
 */

/** Cookie names become `<prefix>.session_token` (with `__Secure-` in front over HTTPS). */
export const AUTH_COOKIE_PREFIX = "blaxzy";

/** Where better-auth's handler is mounted (`src/app/api/auth/[...all]/route.ts`). */
export const AUTH_BASE_PATH = "/api/auth";

/** Request header the proxy sets so server code knows the path being rendered. */
export const PATHNAME_HEADER = "x-blaxzy-pathname";

/** The readiness endpoint (`src/app/api/health/route.ts`). */
export const HEALTH_PATH = "/api/health";
/** The liveness endpoint (`src/app/api/health/live/route.ts`). */
export const HEALTH_LIVE_PATH = "/api/health/live";

export const LOGIN_PATH = "/login";
export const VERIFY_EMAIL_PATH = "/verify-email";

export const FORGOT_PASSWORD_PATH = "/forgot-password";

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;
/** Longest display name accepted at sign-up and on update-user. */
export const MAX_NAME_LENGTH = 100;

/** Pages reachable without a session. Everything else under the app redirects to login. */
const PUBLIC_PAGES = new Set([
  "/",
  LOGIN_PATH,
  "/signup",
  VERIFY_EMAIL_PATH,
  FORGOT_PASSWORD_PATH,
  "/reset-password",
]);

function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** True when `pathname` can be served without a session cookie. */
export function isPublicPath(pathname: string, isDevelopment: boolean): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (PUBLIC_PAGES.has(normalized)) return true;
  if (isUnder(normalized, AUTH_BASE_PATH)) return true;
  // Probed by load balancers and the container health check, which carry no session.
  if (normalized === HEALTH_PATH || normalized === HEALTH_LIVE_PATH) return true;
  if (isDevelopment && isUnder(normalized, "/dev")) return true;
  return false;
}

/** Request header the change-password call carries the emailed code in. */
export const PASSWORD_CHANGE_CODE_HEADER = "x-password-change-code";
