import { z } from "zod";

const booleanString = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

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
