/**
 * The one wrapper every server action goes through: authentication, the per-user rate limit and
 * the mapping of errors to user-readable failures. Not a `"use server"` file: actions import it.
 *
 * - `userAction` (user-initiated actions): `requireUser()` runs before anything is caught, so its
 *   redirect to /login is never swallowed.
 * - `pollAction` (background polls): never redirects. Signed out, rate limited or failing, it
 *   returns the poll's quiet value, so a background tab is not sent to the sign-in page.
 */
import { AssetInputError } from "@/server/assets";
import { getSession, requireUser, type AuthUser } from "@/server/auth";
import { BillingInputError, InsufficientCreditsError } from "@/server/billing";
import { BlocksInputError } from "@/server/blocks";
import { errorMessage, logLine } from "@/server/jobs/log";
import { ProductionInputError } from "@/server/production";
import { ProjectInputError } from "@/server/projects";
import { checkRateLimit, type RateLimitBucket } from "@/server/ratelimit";
import { ScriptInputError } from "@/server/script";
import { StorageError } from "@/server/storage";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };
export type ActionFailure = { ok: false; error: string };

export const SERVER_PROBLEM = "The server had a problem. Try again in a moment.";
export const TOO_MANY_REQUESTS = "Too many requests; try again in a moment.";
export const SIGNED_OUT = "You are signed out. Sign in again to continue.";
export const TOO_MANY_UPLOADS =
  "Too many uploads are still finishing. Wait a few minutes, then try again.";

/** An error class whose instances carry a message that is safe to show the user. */
export type UserErrorClass = abstract new (...args: never[]) => Error;

/** The services' input errors: their messages are written for the user. */
export const USER_FACING_ERRORS: readonly UserErrorClass[] = [
  AssetInputError,
  ScriptInputError,
  BlocksInputError,
  ProductionInputError,
  ProjectInputError,
  InsufficientCreditsError,
  BillingInputError,
];

export interface ActionOptions {
  /** Error classes whose message is shown as is (default `USER_FACING_ERRORS`). */
  userErrors?: readonly UserErrorClass[];
  /** Checked first: a user-readable message for this error, or null to fall through. */
  mapError?: (error: unknown) => string | null;
}

/** The message to show for `error`, or null when it is unexpected (logged, SERVER_PROBLEM). */
export function userMessage(error: unknown, options: ActionOptions = {}): string | null {
  const mapped = options.mapError?.(error);
  if (mapped) return mapped;
  if (error instanceof StorageError && error.code === "too_many_uploads") return TOO_MANY_UPLOADS;
  const classes = options.userErrors ?? USER_FACING_ERRORS;
  if (error instanceof Error && classes.some((c) => error instanceof c)) return error.message;
  return null;
}

/** Logs an unexpected error of the action `tag` (with its stack, never the arguments). */
export function logActionError(tag: string, error: unknown): void {
  logLine("error", "server action failed", {
    action: tag,
    error: errorMessage(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
}

/** The failure for a caught error: its user-readable message, or SERVER_PROBLEM (logged). */
export function failureFor(
  tag: string,
  error: unknown,
  options: ActionOptions = {},
): ActionFailure {
  const message = userMessage(error, options);
  if (message !== null) return { ok: false, error: message };
  logActionError(tag, error);
  return { ok: false, error: SERVER_PROBLEM };
}

/** Buckets for user-initiated actions (`poll` belongs to `pollAction`). */
export type ActionBucket = Exclude<RateLimitBucket, "poll">;

/**
 * Runs a user-initiated action: the signed-in, verified user (or the redirect to /login), the
 * rate limit of `bucket`, then `fn`. A thrown error becomes `{ ok: false, error }`.
 */
export async function userAction<R>(
  bucket: ActionBucket,
  tag: string,
  fn: (user: AuthUser) => Promise<R>,
  options: ActionOptions = {},
): Promise<R | ActionFailure> {
  // Outside the try: requireUser() redirects by throwing, which must reach Next.
  const user = await requireUser();
  const limit = await checkRateLimit({ userId: user.id, bucket });
  if (!limit.ok) {
    return { ok: false, error: limit.reason === "limited" ? TOO_MANY_REQUESTS : SERVER_PROBLEM };
  }
  try {
    return await fn(user);
  } catch (error) {
    return failureFor(tag, error, options);
  }
}

export type QuietReason = "signed_out" | "limited" | "failed";

/** The quiet value of a poll that answers with an `ActionResult`: a failure with the message. */
export const pollFailure = (_reason: QuietReason, message: string): ActionFailure => ({
  ok: false,
  error: message,
});

/** The quiet value of a poll that answers null when there is nothing to report. */
export const pollNull = (): null => null;

/**
 * Runs a background poll. Never redirects: signed out (or unverified), over the `poll` limit or
 * failing, it returns `quiet(reason, message)`. Unexpected errors are logged.
 */
export async function pollAction<R, Q>(
  tag: string,
  quiet: (reason: QuietReason, message: string) => Q,
  fn: (user: AuthUser) => Promise<R>,
  options: ActionOptions = {},
): Promise<R | Q> {
  let user: AuthUser;
  try {
    const session = await getSession();
    if (!session?.user.emailVerified) return quiet("signed_out", SIGNED_OUT);
    user = session.user;
  } catch (error) {
    logActionError(tag, error);
    return quiet("failed", SERVER_PROBLEM);
  }
  const limit = await checkRateLimit({ userId: user.id, bucket: "poll" });
  if (!limit.ok) {
    return quiet("limited", limit.reason === "limited" ? TOO_MANY_REQUESTS : SERVER_PROBLEM);
  }
  try {
    return await fn(user);
  } catch (error) {
    return quiet("failed", failureFor(tag, error, options).error);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True for a UUID. Checked before a client-sent id goes into a path (`revalidatePath`) or a
 * query that would otherwise fail on the cast.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/**
 * A count sent by the client (how many items it shows), clamped to `[min, max]`. Anything that
 * is not a finite number reads as `min`.
 */
export function clampCount(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : min;
  return Math.max(min, Math.min(n, max));
}
