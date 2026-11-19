/**
 * Error tracking in the browser. On only when `NEXT_PUBLIC_SENTRY_DSN` was set at build time;
 * otherwise nothing is loaded and nothing is sent. The SDK is loaded lazily (it stays out of the
 * first page load) and reports through the same-origin tunnel `/api/monitoring`, so the
 * Content-Security-Policy needs no extra origin. No PII: see `./error-tracking`.
 */
import { minimalDataCollection, scrubBreadcrumb, scrubEvent } from "./error-tracking";

type BrowserSdk = typeof import("@sentry/nextjs");

/** Read as a literal so Next inlines it at build time. */
const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const ENVIRONMENT = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || process.env.NODE_ENV;
export const TUNNEL_PATH = "/api/monitoring";

let sdk: Promise<BrowserSdk | null> | undefined;

/** Starts tracking once (from `src/instrumentation-client.ts`). A no-op without a DSN. */
export function startBrowserTracking(): void {
  if (!DSN || sdk) return;
  sdk = import("@sentry/nextjs")
    .then((Sentry) => {
      Sentry.init({
        dsn: DSN,
        tunnel: TUNNEL_PATH,
        environment: ENVIRONMENT,
        dataCollection: minimalDataCollection(),
        initialScope: { tags: { service: "browser" } },
        beforeSend: scrubEvent,
        beforeBreadcrumb: scrubBreadcrumb,
      });
      return Sentry;
    })
    .catch(() => null);
}

/**
 * Reports an error an error boundary caught. `digest` is the server error's id (Next sets it on
 * errors from Server Components); the server's report carries the same tag.
 */
export function reportClientError(error: unknown, digest?: string): void {
  if (!sdk) return;
  void sdk.then((Sentry) => {
    if (!Sentry) return;
    Sentry.withScope((scope) => {
      scope.setTag("boundary", "true");
      if (digest) scope.setTag("digest", digest);
      Sentry.captureException(error);
    });
  });
}

/** The `digest` of an error from a Server Component, if it has one. */
export function errorDigest(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("digest" in error)) return undefined;
  const digest = (error as { digest: unknown }).digest;
  return typeof digest === "string" && digest !== "" ? digest : undefined;
}
