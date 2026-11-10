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
