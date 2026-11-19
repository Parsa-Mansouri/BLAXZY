import { getRedirectUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { PATHNAME_HEADER } from "@/server/auth/constants";
import { config, proxy } from "./proxy";

const ORIGIN = "http://localhost:3000";
const SESSION_COOKIE = "blaxzy.session_token=abc.def";

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`${ORIGIN}${path}`, cookie ? { headers: { cookie } } : undefined);
}

/** The request headers `NextResponse.next({ request: { headers } })` passes on. */
function forwardedHeader(response: Response, name: string): string | null {
  return response.headers.get(`x-middleware-request-${name}`);
}

describe("proxy", () => {
  it("sends a request without a session cookie to login with the path and query", () => {
    const response = proxy(request("/projects/p1/script?tab=versions&x=1"));
    expect(response.status).toBe(307);
    const target = new URL(getRedirectUrl(response) ?? "");
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("next")).toBe("/projects/p1/script?tab=versions&x=1");
  });

  it("passes a request with a session cookie on, telling the server the path", () => {
    const response = proxy(request("/dashboard?page=2", SESSION_COOKIE));
    expect(getRedirectUrl(response)).toBeNull();
    expect(forwardedHeader(response, PATHNAME_HEADER)).toBe("/dashboard?page=2");
  });

  it.each(["/api/health", "/api/health/live", "/login", "/signup", "/api/auth/sign-in/email", "/"])(
    "lets %s through without a cookie",
    (path) => {
      const response = proxy(request(path));
      expect(getRedirectUrl(response)).toBeNull();
      expect(forwardedHeader(response, PATHNAME_HEADER)).toBe(path);
    },
  );

  it("gives every request an id, keeping a well-formed incoming one, and answers with it", () => {
    const fresh = proxy(request("/dashboard", SESSION_COOKIE));
    const id = forwardedHeader(fresh, "x-request-id");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(fresh.headers.get("x-request-id")).toBe(id);

    const kept = proxy(
      new NextRequest(`${ORIGIN}/dashboard`, {
        headers: { cookie: SESSION_COOKIE, "x-request-id": "lb-0123456789" },
      }),
    );
    expect(forwardedHeader(kept, "x-request-id")).toBe("lb-0123456789");

    const bad = proxy(
      new NextRequest(`${ORIGIN}/dashboard`, {
        headers: { cookie: SESSION_COOKIE, "x-request-id": "no spaces allowed" },
      }),
    );
    expect(forwardedHeader(bad, "x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(proxy(request("/dashboard")).headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("lets browser error reports through without a cookie", () => {
    expect(getRedirectUrl(proxy(request("/api/monitoring")))).toBeNull();
  });

  it("protects API routes that are not public", () => {
    expect(getRedirectUrl(proxy(request("/api/files/abc")))).not.toBeNull();
  });
});

describe("proxy matcher", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it.each(["/", "/dashboard", "/projects/p1/script", "/api/health", "/api/files/abc", "/login"])(
    "runs for %s",
    (url) => {
      expect(matches(url)).toBe(true);
    },
  );

  it.each([
    "/_next/static/chunks/main.js",
    "/_next/image",
    "/_next/data/build/page.json",
    "/favicon.ico",
    "/images/logo.png",
  ])("skips %s", (url) => {
    expect(matches(url)).toBe(false);
  });
});
