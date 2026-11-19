/**
 * The Sentry SDK behind the `Tracker` seam. Typed against the small part of the SDK it uses, so
 * the web server (`@sentry/nextjs`) and the worker (`@sentry/node`) share it, and tests can pass
 * a fake. The SDK itself is imported only by the callers, and only when a DSN is set.
 */
import { minimalDataCollection, scrubBreadcrumb, scrubEvent } from "@/lib/error-tracking";
import type { TrackingEnv } from "@/server/env";
import type { Severity, Tracker, TrackerEvent } from "./tracker";

export type SentryScopeLike = {
  setTags(tags: Record<string, string>): unknown;
  setExtras(extras: Record<string, unknown>): unknown;
  setUser(user: { id: string } | null): unknown;
  setFingerprint(fingerprint: string[]): unknown;
};

export type SentryLike = {
  withScope<T>(callback: (scope: SentryScopeLike) => T): T;
  captureException(exception: unknown): string;
  captureMessage(message: string, level?: Severity): string;
  flush(timeout?: number): PromiseLike<boolean>;
};

function apply(scope: SentryScopeLike, event: TrackerEvent): void {
  scope.setTags(event.tags);
  scope.setExtras(event.extra);
  if (event.userId) scope.setUser({ id: event.userId });
  if (event.fingerprint) scope.setFingerprint(event.fingerprint);
}

/** A `Tracker` that reports through `sdk` (already initialised). */
export function sentryTracker(sdk: SentryLike): Tracker {
  return {
    captureException(error, event) {
      sdk.withScope((scope) => {
        apply(scope, event);
        sdk.captureException(error);
      });
    },
    captureMessage(message, level, event) {
      sdk.withScope((scope) => {
        apply(scope, event);
        sdk.captureMessage(message, level);
      });
    },
    async flush(timeoutMs) {
      return await sdk.flush(timeoutMs);
    },
  };
}

/** `init` options shared by the web server and the worker. No PII: see `@/lib/error-tracking`. */
export function sentryOptions(env: TrackingEnv & { SENTRY_DSN: string }, service: string) {
  return {
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    dataCollection: minimalDataCollection(),
    // Messages without a synthetic stack: GlitchTip then titles them by their text.
    attachStacktrace: false,
    initialScope: { tags: { service } },
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
