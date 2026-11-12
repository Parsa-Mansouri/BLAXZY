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

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  BETTER_AUTH_SECRET: z.string().min(1),
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
});

export type Env = z.infer<typeof envSchema>;

/** Parse an arbitrary source (throws a readable error on failure). */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
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
