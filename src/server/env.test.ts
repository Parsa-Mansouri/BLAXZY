import { describe, expect, it } from "vitest";
import { parseEnv } from "@/server/env";

const valid = {
  DATABASE_URL: "postgresql://blaxzy:blaxzy@localhost:5432/blaxzy",
  BETTER_AUTH_SECRET: "secret",
  S3_ENDPOINT: "http://localhost:9100",
  S3_BUCKET: "blaxzy",
  S3_ACCESS_KEY_ID: "id",
  S3_SECRET_ACCESS_KEY: "key",
};

describe("parseEnv", () => {
  it("parses valid input and applies defaults", () => {
    const env = parseEnv(valid);
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.S3_REGION).toBe("us-east-1");
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:3000");
    expect(env.EMAIL_TRANSPORT).toBe("console");
    expect(env.SMTP_HOST).toBeUndefined();
    expect(env.DAMI_MAX_CONCURRENCY).toBe(4);
    expect(env.DAMI_MAX_RETRIES).toBe(4);
    expect(env.DAMI_DEFAULT_MODEL).toBeUndefined();
  });

  it("rejects a non-positive DAMI_MAX_CONCURRENCY", () => {
    expect(() => parseEnv({ ...valid, DAMI_MAX_CONCURRENCY: "0" })).toThrow(/DAMI_MAX_CONCURRENCY/);
  });

  it("rejects an unknown EMAIL_TRANSPORT", () => {
    expect(() => parseEnv({ ...valid, EMAIL_TRANSPORT: "carrier-pigeon" })).toThrow(
      /EMAIL_TRANSPORT/,
    );
  });

  it("applies job queue and worker defaults", () => {
    const env = parseEnv(valid);
    expect(env.JOBS_SCHEMA).toBe("pgboss");
    expect(env.JOBS_WEB_POOL_MAX).toBe(2);
    expect(env.WORKER_CONCURRENCY_DEFAULT).toBe(2);
    expect(env.WORKER_CONCURRENCY).toEqual({});
    expect(env.S3_PUBLIC_ENDPOINT).toBeUndefined();
  });

  it("parses per job type worker concurrency", () => {
    const env = parseEnv({ ...valid, WORKER_CONCURRENCY: " script.generate=4, video.render=0 ," });
    expect(env.WORKER_CONCURRENCY).toEqual({ "script.generate": 4, "video.render": 0 });
    expect(() => parseEnv({ ...valid, WORKER_CONCURRENCY: "script.generate" })).toThrow(
      /WORKER_CONCURRENCY/,
    );
  });

  it("rejects an unsafe JOBS_SCHEMA", () => {
    expect(() => parseEnv({ ...valid, JOBS_SCHEMA: "pgboss; drop" })).toThrow(/JOBS_SCHEMA/);
  });

  it("fails when DATABASE_URL is missing", () => {
    const rest: Record<string, string | undefined> = { ...valid, DATABASE_URL: undefined };
    expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/);
  });
});
