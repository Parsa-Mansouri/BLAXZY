import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  InternalServerError,
  RateLimitError,
  RequestTimeoutError,
} from "@anthropic-ai/sdk";

/** Error `type` values the API sends in mid-stream SSE `error` events that are worth retrying. */
const TRANSIENT_STREAM_ERROR_TYPES = new Set(["overloaded_error", "api_error", "rate_limit_error"]);

/** Low-level network failures that can surface outside the SDK's own error classes. */
const TRANSIENT_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

function networkCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
  const code = (error as { code: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * True for rate limits (429), overloads (529) and other 5xx, request timeouts (408), connection
 * failures and their mid-stream equivalents. Everything else (400, 401, 403, 404, 413, aborts,
 * our own validation errors) is not retried.
 */
export function isTransientError(error: unknown): boolean {
  if (error instanceof APIUserAbortError) return false;
  if (error instanceof RateLimitError) return true;
  if (error instanceof InternalServerError) return true; // >= 500, includes 529 overloaded
  if (error instanceof RequestTimeoutError) return true;
  if (error instanceof APIConnectionError) return true; // includes connection timeouts
  if (error instanceof APIError) {
    return error.status === undefined && TRANSIENT_STREAM_ERROR_TYPES.has(error.type ?? "");
  }
  const code = networkCode(error) ?? networkCode((error as { cause?: unknown } | null)?.cause);
  return code !== undefined && TRANSIENT_NETWORK_CODES.has(code);
}

export function errorStatus(error: unknown): number | null {
  return error instanceof APIError && typeof error.status === "number" ? error.status : null;
}

export type BackoffOptions = {
  baseDelayMs: number;
  maxDelayMs: number;
  random: () => number;
};

export const DEFAULT_BACKOFF: Omit<BackoffOptions, "random"> = {
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
};

function retryAfterMs(error: unknown): number | null {
  if (!(error instanceof APIError) || !error.headers) return null;
  const header = error.headers.get("retry-after");
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/**
 * Delay before retry number `retry` (1-based): the server's `retry-after` when present (capped),
 * otherwise exponential backoff with "equal jitter" (half fixed, half random).
 */
export function backoffDelayMs(retry: number, error: unknown, options: BackoffOptions): number {
  const hinted = retryAfterMs(error);
  if (hinted !== null) return Math.min(hinted, options.maxDelayMs * 2);
  const ceiling = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (retry - 1));
  return Math.round(ceiling / 2 + options.random() * (ceiling / 2));
}
