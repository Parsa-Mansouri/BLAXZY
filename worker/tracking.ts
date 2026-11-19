/**
 * Error tracking in the worker process: `@sentry/node` behind the shared seam
 * (src/server/observability/tracker.ts). The SDK is loaded only when `SENTRY_DSN` is set.
 */
import { getTrackingEnv } from "../src/server/env";
import { sentryOptions, sentryTracker } from "../src/server/observability/sentry";
import { installTracker, isTracking } from "../src/server/observability/tracker";

/** The SDK's own process handlers, replaced by the worker's. */
const PROCESS_HANDLERS = new Set(["OnUncaughtException", "OnUnhandledRejection"]);

export async function startWorkerTracking(): Promise<void> {
  const env = getTrackingEnv();
  const dsn = env.SENTRY_DSN;
  if (!dsn || isTracking()) return;
  const Sentry = await import("@sentry/node");
  Sentry.init({
    ...sentryOptions({ ...env, SENTRY_DSN: dsn }, "worker"),
    // worker/index.ts handles these itself (log, report, flush, graceful shutdown, exit 1).
    integrations: (defaults) => defaults.filter((i) => !PROCESS_HANDLERS.has(i.name)),
  });
  installTracker(sentryTracker(Sentry));
}
