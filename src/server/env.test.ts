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
  });

  it("fails when DATABASE_URL is missing", () => {
    const rest: Record<string, string | undefined> = { ...valid, DATABASE_URL: undefined };
    expect(() => parseEnv(rest)).toThrow(/DATABASE_URL/);
  });
});
