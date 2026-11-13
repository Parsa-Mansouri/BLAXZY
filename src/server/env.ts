import { isIP } from "node:net";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

/** `name=4,other.name=0` → `{ name: 4, "other.name": 0 }`. */
const concurrencyMap = z.string().transform((value, ctx) => {
  const result: Record<string, number> = {};
  for (const part of value.split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    const match = /^([\w.\-/]+)=(\d+)$/.exec(entry);
    if (!match?.[1] || !match[2]) {
      ctx.addIssue({ code: "custom", message: `expected name=count, got "${entry}"` });
      return z.NEVER;
    }
    result[match[1]] = Number(match[2]);
  }
  return result;
});

/** The `.env.example` development secret: fine locally, refused in production. */
export const DEV_AUTH_SECRET = "dev-only-secret-change-me-at-least-32-chars";

/** One address: `a@b.c` or `Display Name <a@b.c>`; no control characters. */
const ADDRESS_PART = String.raw`[^\s<>@,;"]+@[^\s<>@,;"]+`;
const FROM_ADDRESS = new RegExp(String.raw`^(?:[^<>@\r\n]*<${ADDRESS_PART}>|${ADDRESS_PART})$`);

/** True when `value` is one parseable sender address with no CR/LF (header injection). */
export function isValidFromAddress(value: string): boolean {
  if (/[\r\n\0]/.test(value)) return false;
  return FROM_ADDRESS.test(value.trim());
}

/** `10.0.0.0/8`, `192.168.1.5`, `fd00::/8`: an IP address with an optional prefix length. */
function isCidr(value: string): boolean {
  const [address, prefix, ...rest] = value.split("/");
  if (rest.length > 0 || !address) return false;
  const version = isIP(address);
  if (version === 0) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (version === 4 ? 32 : 128);
}

/** `10.0.0.0/8, fd00::/8` → `["10.0.0.0/8", "fd00::/8"]`; empty → `[]`. */
const cidrList = z.string().transform((value, ctx) => {
  const result: string[] = [];
  for (const part of value.split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    if (!isCidr(entry)) {
      ctx.addIssue({ code: "custom", message: `expected an IP address or CIDR, got "${entry}"` });
      return z.NEVER;
    }
    result.push(entry);
  }
  return result;
});

/** A header name (RFC 9110 token), lower-cased; empty counts as unset. */
const headerName = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[!#$%&'*+.^_`|~0-9a-z-]+$/, "expected an HTTP header name such as x-real-ip")
    .optional(),
);

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  BETTER_AUTH_SECRET: z.string().min(32, "at least 32 characters (openssl rand -base64 32)"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3000"),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /**
   * Needed only when the API key is not scoped to a workspace (a user key from the Console):
   * the workspace to bill, sent as the `anthropic-workspace-id` header.
   */
  ANTHROPIC_WORKSPACE_ID: z.string().min(1).optional(),
  /** Overrides every dami's default Claude model (e.g. a cheaper model on staging). */
  DAMI_DEFAULT_MODEL: z.string().min(1).optional(),
  /** Per-process limit on concurrent Claude API calls made by damis. */
  DAMI_MAX_CONCURRENCY: z.coerce.number().int().positive().default(4),
  /** Retries per Claude call for rate limits, overloads and network errors (not counting the first try). */
  DAMI_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(4),
  /**
   * `live` calls Claude; `sample` answers every dami with sample output generated from its input
   * (no API key, no cost); `auto` is `sample` when ANTHROPIC_API_KEY is unset, `live` otherwise.
   * Defaults to `sample` during the testing phase, so an API key alone never starts real (paid) calls.
   */
  DAMI_MODE: z.enum(["auto", "live", "sample"]).default("sample"),
  /** Artificial latency of one sample-mode dami call, so the flow feels real. */
  DAMI_SAMPLE_DELAY_MS: z.coerce.number().int().min(0).max(600_000).default(3000),
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: booleanString.default(true),
  /**
   * Endpoint the browser uses for presigned URLs, when it differs from `S3_ENDPOINT` (for example
   * the server reaches the store over a container network). Used only for presigning.
   */
  S3_PUBLIC_ENDPOINT: z.string().url().optional(),
  /** Postgres schema that holds the job queue tables (pg-boss). */
  JOBS_SCHEMA: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/, "lower-case letters, digits and underscores")
    .default("pgboss"),
  /** Queue connection pool per web process (send only, keep small). */
  JOBS_WEB_POOL_MAX: z.coerce.number().int().positive().default(2),
  /** Queue connection pool per worker process (polling + completion). */
  JOBS_WORKER_POOL_MAX: z.coerce.number().int().positive().default(10),
  /** Jobs each worker process runs at once per job type, unless overridden below. */
  WORKER_CONCURRENCY_DEFAULT: z.coerce.number().int().nonnegative().default(2),
  /** Per job type overrides, e.g. `script.generate=4,video.render=0` (0 = not on this worker). */
  WORKER_CONCURRENCY: concurrencyMap.default({}),
  WORKER_POLL_INTERVAL_SECONDS: z.coerce.number().min(0.5).default(2),
  /** How long shutdown waits for in-flight jobs before they are failed (and retried elsewhere). */
  WORKER_SHUTDOWN_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(25),
  /** Image and video generation provider. `sample` renders placeholder images locally (no cost). */
  GENERATION_PROVIDER: z.enum(["sample", "higgsfield"]).default("sample"),
  /** How long a sample-provider job takes to finish, so the flow feels real (`0` in tests). */
  GENERATION_SAMPLE_DELAY_MS: z.coerce.number().int().min(0).max(600_000).default(3000),
  /** Generations one user may have running at once; extra jobs wait (rescheduled, not failed). */
  GENERATION_MAX_PER_USER: z.coerce.number().int().positive().max(100).default(3),
  /**
   * A generation still queued or running this long after it was created (or started) is failed
   * and refunded by the `generation.sweep` job.
   */
  GENERATION_STUCK_AFTER_MINUTES: z.coerce.number().int().min(10).max(100_000).default(120),
  /**
   * The ffmpeg binary that renders sample video. Unset: the `ffmpeg-static` package when it is
   * installed, else `ffmpeg` on the PATH. The worker Docker image sets it.
   */
  FFMPEG_PATH: z.string().min(1).optional(),
  /** `console` prints emails to the server log (development); `smtp` sends them. */
  EMAIL_TRANSPORT: z.enum(["console", "smtp"]).default("console"),
  EMAIL_FROM: z.string().min(1).default("BLAXZY <no-reply@blaxzy.local>"),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().min(1).optional(),
  SMTP_PASSWORD: z.string().min(1).optional(),
  SMTP_SECURE: booleanString.optional(),
  /**
   * Proxies whose forwarded client address the auth rate limiter may trust: comma-separated IPs
   * or CIDRs. Empty = trust no forwarded header.
   */
  AUTH_TRUSTED_PROXIES: cidrList.default([]),
  /**
   * A header the reverse proxy always overwrites with the client address (for example
   * `x-real-ip`), read by the auth rate limiter. Lower-cased; unset = none.
   */
  AUTH_IP_HEADER: headerName,
});

export const envSchema = baseSchema.superRefine((env, ctx) => {
  const fail = (path: string, message: string) =>
    ctx.addIssue({ code: "custom", path: [path], message });

  if (env.EMAIL_TRANSPORT === "smtp") {
    if (!env.SMTP_HOST) fail("SMTP_HOST", "required when EMAIL_TRANSPORT=smtp");
    if (!env.SMTP_PORT) fail("SMTP_PORT", "required when EMAIL_TRANSPORT=smtp");
    if (!isValidFromAddress(env.EMAIL_FROM)) {
      fail("EMAIL_FROM", "must be one address (`a@b.c` or `Name <a@b.c>`) without line breaks");
    }
  }

  if (env.NODE_ENV === "production") {
    if (env.BETTER_AUTH_SECRET === DEV_AUTH_SECRET) {
      fail("BETTER_AUTH_SECRET", "is the development secret from .env.example; generate your own");
    }
    if (!env.BETTER_AUTH_URL.startsWith("https://")) {
      fail("BETTER_AUTH_URL", "must be an https:// URL in production");
    }
    if (env.EMAIL_TRANSPORT === "console") {
      fail("EMAIL_TRANSPORT", "`console` logs links with tokens; use smtp in production");
    }
  }
});

export type Env = z.infer<typeof envSchema>;

/** Parse an arbitrary source (throws a readable error on failure). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  // Defaults hide whether BETTER_AUTH_URL was given, so production checks the raw source.
  const missingUrl = source.NODE_ENV === "production" && !source.BETTER_AUTH_URL?.trim();
  if (!result.success || missingUrl) {
    const issues = [
      ...(result.success
        ? []
        : result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)),
      ...(missingUrl
        ? ["  - BETTER_AUTH_URL: must be set explicitly in production (the public https:// origin)"]
        : []),
    ].join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return result.data;
}

let cached: Env | undefined;

/**
 * Lazily parsed, cached environment. Call at runtime (never at module top level)
 * so `next build` does not require runtime-only variables.
 */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
