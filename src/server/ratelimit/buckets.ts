/**
 * Named rate-limit buckets for server actions and file reads. Every limit counts requests per
 * user per fixed window of `RATE_LIMIT_WINDOW_SECONDS`.
 *
 * `failOpen`: what happens when the counter cannot be read (database error). Open lets the
 * request through (logged); closed refuses it. Anything that spends credits or model time fails
 * closed.
 */
export const RATE_LIMIT_WINDOW_SECONDS = 60;

export const RATE_LIMIT_BUCKETS = {
  /** Ordinary writes: rename, review decisions that start nothing, removals. */
  mutate: { limit: 60, failOpen: true },
  /** Upload-ticket creation (a database row and a presigned URL each). */
  upload: { limit: 30, failOpen: false },
  /** Anything that enqueues model or generation work or spends credits. */
  expensive: { limit: 20, failOpen: false },
  /**
   * Background polls. Several pollers run per screen every 2-10 s plus the 4.5 s global
   * watcher, so this must never trip in normal use.
   */
  poll: { limit: 600, failOpen: true },
  /** Pagination loads and one-off reads. */
  read: { limit: 240, failOpen: true },
  /**
   * `/api/files/[id]`: every stored picture on a screen is one request, so a gallery page costs
   * dozens at once. High enough for that, low enough to stop bulk scraping of presigned links.
   */
  file: { limit: 1200, failOpen: true },
  /**
   * Email verification code guesses, keyed by the email address (not a user id) so a guesser
   * gets no more tries by rotating IPs. A person retyping a code never needs more.
   */
  otp: { limit: 5, failOpen: false },
  /** Emails a signed-in user can ask for (the password change code): each one is a sent mail. */
  codeSend: { limit: 3, failOpen: false },
} as const satisfies Record<string, { limit: number; failOpen: boolean }>;

export type RateLimitBucket = keyof typeof RATE_LIMIT_BUCKETS;

/** Windows older than this are deleted by `pruneRateLimits` (the `ratelimit.prune` job). */
export const RATE_LIMIT_RETENTION_MINUTES = 10;
