import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import {
  AUTH_COOKIE_PREFIX,
  isPublicPath,
  LOGIN_PATH,
  PATHNAME_HEADER,
} from "@/server/auth/constants";

/**
 * Optimistic route protection: only checks that a session cookie is present (no database call).
 * Real authorization happens in `requireUser()` / `requireAdmin()` on the server.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (
    !isPublicPath(pathname, process.env.NODE_ENV === "development") &&
    !getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX })
  ) {
    const login = new URL(LOGIN_PATH, request.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }

  // Tell server code which path is being rendered (used for `?next=` in requireUser()).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATHNAME_HEADER, `${pathname}${search}`);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    // Everything except Next internals and files with an extension (static assets).
    "/((?!_next/static|_next/image|_next/data|.*\\.[\\w]+$).*)",
  ],
};
