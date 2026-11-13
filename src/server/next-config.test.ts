import { describe, expect, it } from "vitest";
import nextConfig, {
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  s3Origin,
} from "../../next.config";

const prod = { NODE_ENV: "production", S3_ENDPOINT: "https://s3.example.com/bucket-path" };
const dev = { NODE_ENV: "development", S3_ENDPOINT: "http://localhost:9100" };

function directive(csp: string, name: string): string {
  const found = csp.split("; ").find((d) => d === name || d.startsWith(`${name} `));
  if (!found) throw new Error(`directive ${name} missing in: ${csp}`);
  return found;
}

describe("s3Origin", () => {
  it("prefers S3_PUBLIC_ENDPOINT and reduces to the origin", () => {
    expect(
      s3Origin({ S3_ENDPOINT: "http://a:9000/x", S3_PUBLIC_ENDPOINT: "https://b.example/y" }),
    ).toBe("https://b.example");
    expect(s3Origin({ S3_ENDPOINT: "http://localhost:9100" })).toBe("http://localhost:9100");
  });

  it("tolerates unset, empty and invalid values", () => {
    expect(s3Origin({})).toBeNull();
    expect(s3Origin({ S3_ENDPOINT: "" })).toBeNull();
    expect(s3Origin({ S3_ENDPOINT: "not a url" })).toBeNull();
    expect(s3Origin({ S3_ENDPOINT: "javascript:alert(1)" })).toBeNull();
  });
});

describe("buildContentSecurityPolicy", () => {
  it("closes down embedding, plugins, base and forms", () => {
    const csp = buildContentSecurityPolicy(prod);
    expect(directive(csp, "default-src")).toBe("default-src 'self'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "base-uri")).toBe("base-uri 'self'");
    expect(directive(csp, "form-action")).toBe("form-action 'self'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
  });

  it("allows the S3 origin for images, media and uploads, and no eval in production", () => {
    const csp = buildContentSecurityPolicy(prod);
    for (const name of ["img-src", "media-src", "connect-src"]) {
      expect(directive(csp, name)).toContain("https://s3.example.com");
      expect(directive(csp, name)).not.toContain("/bucket-path");
    }
    expect(directive(csp, "script-src")).not.toContain("unsafe-eval");
    expect(csp).not.toContain("ws:");
  });

  it("falls back to https: when the S3 endpoint is unknown at production build time", () => {
    const csp = buildContentSecurityPolicy({ NODE_ENV: "production" });
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' https:");
  });

  it("allows eval and websockets only in development", () => {
    const csp = buildContentSecurityPolicy(dev);
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "connect-src")).toContain("ws:");
    expect(directive(csp, "img-src")).toContain("http://localhost:9100");
  });
});

describe("buildSecurityHeaders", () => {
  const byKey = (headers: { key: string; value: string }[]) =>
    Object.fromEntries(headers.map((h) => [h.key, h.value]));

  it("sets the standard hardening headers", () => {
    const h = byKey(buildSecurityHeaders(prod));
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["X-Frame-Options"]).toBe("DENY");
    expect(h["Permissions-Policy"]).toContain("camera=()");
    expect(h["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });

  it("sends HSTS in production only", () => {
    expect(byKey(buildSecurityHeaders(prod))["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
    expect(byKey(buildSecurityHeaders(dev))["Strict-Transport-Security"]).toBeUndefined();
  });
});

describe("next config", () => {
  it("hides X-Powered-By and applies the headers to every route", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const rules = await nextConfig.headers?.();
    expect(rules?.[0]?.source).toBe("/:path*");
    expect(rules?.[0]?.headers.some((h) => h.key === "Content-Security-Policy")).toBe(true);
  });
});
