/**
 * Error tracking in the web server (Node.js runtime), started by `src/instrumentation.ts`.
 * The SDK is loaded only when `SENTRY_DSN` is set.
 */
import { stripQuery } from "@/lib/error-tracking";
import { getTrackingEnv } from "@/server/env";
import { logLine } from "@/server/log";
import { REQUEST_ID_HEADER } from "./request-id";
import { sentryOptions, sentryTracker } from "./sentry";
import { installTracker, isTracking } from "./tracker";

/** Initialises the SDK and installs the tracker, once per process; nothing without a DSN. */
export async function startWebTracking(): Promise<void> {
  const env = getTrackingEnv();
  const dsn = env.SENTRY_DSN;
  if (!dsn || isTracking()) return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init(sentryOptions({ ...env, SENTRY_DSN: dsn }, "web"));
  installTracker(sentryTracker(Sentry));
}

type RequestInfo = {
  path: string;
  method: string;
  headers: Record<string, string | string[] | undefined>;
};
type ErrorContext = { routePath: string; routeType: string };

/**
 * An error Next caught while rendering a page, running a route handler or a server action that
 * threw (`onRequestError`): logged with the request id and the digest the error page shows, and
 * reported.
 */
export function logRequestError(error: unknown, request: RequestInfo, context: ErrorContext): void {
  const header = request.headers[REQUEST_ID_HEADER];
  const requestId = Array.isArray(header) ? header[0] : header;
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest: unknown }).digest)
      : undefined;
  logLine("error", "request failed", {
    method: request.method,
    path: stripQuery(request.path),
    routePath: context.routePath,
    routeType: context.routeType,
    ...(requestId ? { requestId } : {}),
    ...(digest ? { digest } : {}),
    exception: error,
  });
}
