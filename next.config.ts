import type { NextConfig } from "next";

type EnvSource = Record<string, string | undefined>;

/** Origin (scheme + host + port) of the S3 endpoint browsers talk to, or null when unset/invalid. */
export function s3Origin(env: EnvSource): string | null {
  const raw = (env.S3_PUBLIC_ENDPOINT || env.S3_ENDPOINT || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * A static Content-Security-Policy (no nonces: a nonce needs the proxy plus dynamic rendering of
 * every page, see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 *
 * `'unsafe-inline'` stays for scripts (Next's inline bootstrap/flight scripts) and styles (React
 * `style=` attributes). Everything else is closed down. The S3 origin is read when the config is
 * loaded, and headers are baked into the build: set S3_PUBLIC_ENDPOINT (or S3_ENDPOINT) at
 * `next build` time (Docker: `--build-arg S3_PUBLIC_ENDPOINT=...`). If it is unset in a
 * production build the policy falls back to any https: origin for images, media and connections.
 */
export function buildContentSecurityPolicy(env: EnvSource): string {
  const dev = env.NODE_ENV === "development";
  const s3 = s3Origin(env);
  const external = s3 ? [s3] : dev ? [] : ["https:"];
  const sources = (...extra: string[]) => ["'self'", ...extra].join(" ");
  const directives: string[] = [
    "default-src 'self'",
    `script-src ${sources("'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []))}`,
    `style-src ${sources("'unsafe-inline'")}`,
    `img-src ${sources(...external)}`,
    `media-src ${sources(...external)}`,
    `font-src ${sources()}`,
    `connect-src ${sources(...external, ...(dev ? ["ws:", "wss:"] : []))}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  return directives.join("; ");
}

export function buildSecurityHeaders(env: EnvSource): { key: string; value: string }[] {
  const production = env.NODE_ENV === "production";
  return [
    ...(production
      ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
      : []),
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value:
        "accelerometer=(), autoplay=(self), camera=(), display-capture=(), geolocation=(), gyroscope=(), " +
        "magnetometer=(), microphone=(), midi=(), payment=(), usb=(), interest-cohort=()",
    },
    { key: "Content-Security-Policy", value: buildContentSecurityPolicy(env) },
  ];
}

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: buildSecurityHeaders(process.env) }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
