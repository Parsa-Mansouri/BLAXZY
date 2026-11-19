/**
 * What the code running now belongs to: a request (its id, the signed-in user) or a job attempt.
 * Kept in AsyncLocalStorage, so it is per request or per attempt and never shared between them
 * (web processes stay stateless). `logLine` adds the request id to its lines and the tracker tags
 * its events with all of it.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type RequestScope = { kind: "request"; requestId: string; userId?: string };
export type JobScope = { kind: "job"; job: string; jobId: string; attempt: number };
export type Scope = RequestScope | JobScope;

const storage = new AsyncLocalStorage<Scope>();

/** Runs `fn` as part of the request `requestId`. */
export function withRequestScope<T>(requestId: string, fn: () => T): T {
  return storage.run({ kind: "request", requestId }, fn);
}

/** Runs `fn` as part of one attempt of a job. */
export function withJobScope<T>(
  job: { job: string; jobId: string; attempt: number },
  fn: () => T,
): T {
  return storage.run({ kind: "job", ...job }, fn);
}

/** The scope of the code running now, if any. */
export function currentScope(): Scope | undefined {
  return storage.getStore();
}

/** The current request's id, if the code runs inside a request scope. */
export function currentRequestId(): string | undefined {
  const scope = storage.getStore();
  return scope?.kind === "request" ? scope.requestId : undefined;
}

/** Records the signed-in user (id only) on the current request scope. */
export function setScopeUser(userId: string): void {
  const scope = storage.getStore();
  if (scope?.kind === "request") scope.userId = userId;
}

/** Tags for a tracker event raised now (request id and user id, or job name, id and attempt). */
export function scopeTags(): { tags: Record<string, string>; userId?: string } {
  const scope = storage.getStore();
  if (!scope) return { tags: {} };
  if (scope.kind === "request") {
    return { tags: { requestId: scope.requestId }, userId: scope.userId };
  }
  return { tags: { job: scope.job, jobId: scope.jobId, attempt: String(scope.attempt) } };
}
