import { describe, expect, it } from "vitest";
import { DEV_AUTH_SECRET, parseEnv } from "@/server/env";

const valid = {
  DATABASE_URL: "postgresql://blaxzy:blaxzy@localhost:5432/blaxzy",
  BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters-ok",
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

  it("requires a BETTER_AUTH_SECRET of at least 32 characters", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: "short" })).toThrow(/BETTER_AUTH_SECRET/);
    expect(parseEnv({ ...valid, BETTER_AUTH_SECRET: DEV_AUTH_SECRET }).NODE_ENV).toBe(
      "development",
    );
  });

  it("accepts the example development values outside production", () => {
    expect(() => parseEnv({ ...valid, BETTER_AUTH_SECRET: DEV_AUTH_SECRET })).not.toThrow();
  });

  it("defaults AUTH_TRUSTED_PROXIES to empty and AUTH_IP_HEADER to unset", () => {
    const env = parseEnv(valid);
    expect(env.AUTH_TRUSTED_PROXIES).toEqual([]);
    expect(env.AUTH_IP_HEADER).toBeUndefined();
    expect(parseEnv({ ...valid, AUTH_IP_HEADER: "" }).AUTH_IP_HEADER).toBeUndefined();
  });

  it("parses AUTH_TRUSTED_PROXIES into a list and rejects bad entries", () => {
    const env = parseEnv({ ...valid, AUTH_TRUSTED_PROXIES: " 10.0.0.0/8, fd00::/8 ,192.168.1.5" });
    expect(env.AUTH_TRUSTED_PROXIES).toEqual(["10.0.0.0/8", "fd00::/8", "192.168.1.5"]);
    for (const bad of ["10.0.0.0/33", "not-an-ip", "10.0.0.0/8/8", "::1/129", "10.0.0.0/x"]) {
      expect(() => parseEnv({ ...valid, AUTH_TRUSTED_PROXIES: bad })).toThrow(
        /AUTH_TRUSTED_PROXIES/,
      );
    }
  });

  it("lower-cases AUTH_IP_HEADER and validates it as a header token", () => {
    expect(parseEnv({ ...valid, AUTH_IP_HEADER: "X-Real-IP" }).AUTH_IP_HEADER).toBe("x-real-ip");
    expect(() => parseEnv({ ...valid, AUTH_IP_HEADER: "bad header" })).toThrow(/AUTH_IP_HEADER/);
    expect(() => parseEnv({ ...valid, AUTH_IP_HEADER: "x:y" })).toThrow(/AUTH_IP_HEADER/);
  });

  describe("EMAIL_TRANSPORT=smtp", () => {
    const smtp = {
      ...valid,
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
    };

    it("accepts a complete configuration", () => {
      expect(parseEnv(smtp).SMTP_PORT).toBe(587);
    });

    it("requires SMTP_HOST and SMTP_PORT", () => {
      expect(() => parseEnv({ ...smtp, SMTP_HOST: undefined })).toThrow(/SMTP_HOST/);
      expect(() => parseEnv({ ...smtp, SMTP_PORT: undefined })).toThrow(/SMTP_PORT/);
    });

    it("requires EMAIL_FROM to be one address without line breaks", () => {
      expect(parseEnv({ ...smtp, EMAIL_FROM: "no-reply@example.com" }).EMAIL_FROM).toBeTruthy();
      expect(
        parseEnv({ ...smtp, EMAIL_FROM: "BLAXZY <no-reply@example.com>" }).EMAIL_FROM,
      ).toBeTruthy();
      for (const bad of [
        "not an address",
        "a@b.c\r\nBcc: victim@example.com",
        "a@b.c\nBcc: x@y.z",
        "a@b.c, d@e.f",
        "Name <a@b.c",
      ]) {
        expect(() => parseEnv({ ...smtp, EMAIL_FROM: bad })).toThrow(/EMAIL_FROM/);
      }
    });
  });

  describe("NODE_ENV=production", () => {
    const prod = {
      ...valid,
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "x".repeat(40),
      BETTER_AUTH_URL: "https://blaxzy.example.com",
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
    };

    it("accepts a complete production configuration", () => {
      expect(parseEnv(prod).NODE_ENV).toBe("production");
    });

    it("refuses the example development secret", () => {
      expect(() => parseEnv({ ...prod, BETTER_AUTH_SECRET: DEV_AUTH_SECRET })).toThrow(
        /development secret/,
      );
    });

    it("requires BETTER_AUTH_URL to be set explicitly and to be https", () => {
      expect(() => parseEnv({ ...prod, BETTER_AUTH_URL: undefined })).toThrow(/BETTER_AUTH_URL/);
      expect(() => parseEnv({ ...prod, BETTER_AUTH_URL: "http://blaxzy.example.com" })).toThrow(
        /https/,
      );
    });

    it("refuses the console email transport", () => {
      expect(() => parseEnv({ ...prod, EMAIL_TRANSPORT: "console" })).toThrow(/EMAIL_TRANSPORT/);
    });

    it("does not touch the sample defaults for damis and generation", () => {
      const env = parseEnv(prod);
      expect(env.DAMI_MODE).toBe("sample");
      expect(env.GENERATION_PROVIDER).toBe("sample");
    });
  });
});
