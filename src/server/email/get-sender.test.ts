import { afterEach, describe, expect, it, vi } from "vitest";

const base = {
  DATABASE_URL: "postgresql://u:p@localhost:5432/d",
  BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters-ok",
  S3_ENDPOINT: "http://localhost:9100",
  S3_BUCKET: "b",
  S3_ACCESS_KEY_ID: "i",
  S3_SECRET_ACCESS_KEY: "k",
};

async function load(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries({ ...base, ...env })) vi.stubEnv(k, v);
  return import("./sender");
}

afterEach(() => vi.unstubAllEnvs());

describe("getEmailSender", () => {
  it("returns the console sender in development", async () => {
    const m = await load({ NODE_ENV: "development", EMAIL_TRANSPORT: "console" });
    expect(m.getEmailSender()).toBeInstanceOf(m.ConsoleEmailSender);
  });

  it("refuses the console transport in production", async () => {
    const m = await load({
      NODE_ENV: "production",
      EMAIL_TRANSPORT: "console",
      BETTER_AUTH_URL: "https://x.example.com",
    });
    expect(() => m.getEmailSender()).toThrow();
  });

  it("returns the SMTP sender for EMAIL_TRANSPORT=smtp", async () => {
    const m = await load({
      NODE_ENV: "development",
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
    });
    expect(m.getEmailSender()).toBeInstanceOf(m.SmtpEmailSender);
  });
});
