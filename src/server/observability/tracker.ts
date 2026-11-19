/**
 * The one seam between the app and error tracking (the Sentry SDK, sending to a self-hosted
 * GlitchTip). Code reports through `reportError` / `reportMessage`, or simply logs:
 *
 *   logLine("error", msg, fields)                  → reported as an error
 *   logLine("warn" | "error", msg, { alert: true }) → raises an alert (warning, or error)
 *
 * The tracker is installed once per process at startup (`installTracker`: the web server's
 * instrumentation, the worker's entry) and only when `SENTRY_DSN` is set. Without it every call
 * here is a no-op: no SDK loaded, no network, no warning (tests and local development).
 *
 * The installed tracker is process configuration, not request state. It lives on `globalThis`
 * because Next bundles the instrumentation hook and the routes separately, and both must see it.
 */
import { scrubFields } from "@/lib/error-tracking";
import { scopeTags } from "./scope";

export type Severity = "error" | "warning";

export type ReportContext = {
  /** Short, searchable values (job name, action tag, ...). */
  tags?: Record<string, string | number | boolean | undefined>;
  /** Anything else worth seeing on the event (sensitive-looking keys are dropped). */
  fields?: Record<string, unknown>;
  /** Groups events: by default an error groups by its stack, a message by its text. */
  fingerprint?: string[];
};

/** What the SDK adapter provides (see `sentry.ts`). Every method must never throw. */
export interface Tracker {
  captureException(error: unknown, event: TrackerEvent): void;
  captureMessage(message: string, level: Severity, event: TrackerEvent): void;
  /** Sends what is queued; resolves false when `timeoutMs` ran out first. */
  flush(timeoutMs: number): Promise<boolean>;
}

/** A report with the scope's tags (request id, job) merged in. */
export type TrackerEvent = {
  tags: Record<string, string>;
  extra: Record<string, unknown>;
  userId?: string;
  fingerprint?: string[];
};

const KEY = Symbol.for("blaxzy.observability.tracker");
type Holder = { [KEY]?: Tracker };

/** Installs the process's tracker (once, at startup). `null` turns tracking off again (tests). */
export function installTracker(tracker: Tracker | null): void {
  const holder = globalThis as Holder;
  if (tracker) holder[KEY] = tracker;
  else delete holder[KEY];
}

/** True when a tracker is installed. */
export function isTracking(): boolean {
  return (globalThis as Holder)[KEY] !== undefined;
}

function tracker(): Tracker | undefined {
  return (globalThis as Holder)[KEY];
}

function toEvent(context: ReportContext): TrackerEvent {
  const scope = scopeTags();
  const tags: Record<string, string> = { ...scope.tags };
  for (const [key, value] of Object.entries(context.tags ?? {})) {
    if (value !== undefined) tags[key] = String(value).slice(0, 200);
  }
  return {
    tags,
    extra: scrubFields(context.fields ?? {}),
    ...(scope.userId ? { userId: scope.userId } : {}),
    ...(context.fingerprint ? { fingerprint: context.fingerprint } : {}),
  };
}

/** Reports an unexpected error (with its stack). A no-op when tracking is off. */
export function reportError(error: unknown, context: ReportContext = {}): void {
  const current = tracker();
  if (!current) return;
  try {
    current.captureException(error, toEvent(context));
  } catch {
    // Reporting must never break the code that reports.
  }
}

/** Reports a message at `level` (an alert, or an error without an Error object). */
export function reportMessage(message: string, level: Severity, context: ReportContext = {}): void {
  const current = tracker();
  if (!current) return;
  try {
    current.captureMessage(message, level, toEvent(context));
  } catch {
    // Reporting must never break the code that reports.
  }
}

/** Sends queued events, waiting at most `timeoutMs` (true when everything was sent). */
export async function flushTracker(timeoutMs: number): Promise<boolean> {
  const current = tracker();
  if (!current) return true;
  try {
    return await current.flush(timeoutMs);
  } catch {
    return false;
  }
}

/** Log fields used as tags (short values worth filtering by); the rest become extra data. */
const TAG_FIELDS = [
  "job",
  "action",
  "dami",
  "outcome",
  "requestId",
  "digest",
  "routePath",
  "routeType",
] as const;

/**
 * Forwards one log line to the tracker (`logLine` calls it): level "error" lines and lines with
 * `alert: true`. An `exception` field (the original error) is reported with its stack; otherwise
 * the message is, grouped by the message and its job/action tag rather than by its text.
 */
export function forwardLogLine(
  level: "info" | "warn" | "error",
  msg: string,
  fields: Record<string, unknown>,
  exception: unknown,
): void {
  const alert = fields.alert === true;
  if (level !== "error" && !alert) return;
  if (!tracker()) return;
  const tags: Record<string, string | undefined> = {};
  for (const name of TAG_FIELDS) {
    const value = fields[name];
    if (typeof value === "string" || typeof value === "number") tags[name] = String(value);
  }
  if (alert) tags.alert = "true";
  const rest = { ...fields };
  delete rest.alert;
  const context: ReportContext = { tags, fields: { msg, ...rest } };
  const severity: Severity = level === "error" ? "error" : "warning";
  if (exception !== undefined && severity === "error") {
    reportError(exception, context);
    return;
  }
  const detail = typeof fields.error === "string" ? `: ${fields.error}` : "";
  const discriminator = tags.job ?? tags.action ?? tags.dami ?? "";
  reportMessage(`${msg}${detail}`, severity, {
    ...context,
    fingerprint: [msg, discriminator],
  });
}
