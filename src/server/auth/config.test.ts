import { afterEach, describe, expect, it, vi } from "vitest";
import { existingAccountEmail } from "@/server/email/templates";
import { parseEnv } from "@/server/env";
import { ipAddressOptions } from "./config";

const production = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://u:p@db.example.com:5432/blaxzy",
  BETTER_AUTH_SECRET: "a-production-secret-that-is-long-enough-123",
  BETTER_AUTH_URL: "https://app.example.com",
  S3_ENDPOINT: "https://s3.example.com",
  S3_BUCKET: "blaxzy",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
  EMAIL_TRANSPORT: "smtp",
  EMAIL_FROM: "BLAXZY <no-reply@example.com>",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
};

describe("ipAddressOptions", () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  afterEach(() => logged.mockClear());

  it("warns loudly in production when clients cannot be identified", () => {
    const options = ipAddressOptions(parseEnv(production));
    expect(options).toEqual({ trustedProxies: [] });
    expect(logged).toHaveBeenCalledOnce();
    expect(String(logged.mock.calls[0]?.[0])).toContain(
      "AUTH RATE LIMITING CANNOT IDENTIFY CLIENTS",
    );
  });

  it("passes the trusted proxies and the client-address header to better-auth", () => {
    const options = ipAddressOptions(
      parseEnv({
        ...production,
        AUTH_TRUSTED_PROXIES: "10.0.0.0/8, 192.0.2.10",
        AUTH_IP_HEADER: "X-Real-IP",
      }),
    );
    expect(options).toEqual({
      ipAddressHeaders: ["x-real-ip"],
      trustedProxies: ["10.0.0.0/8", "192.0.2.10"],
    });
    expect(logged).not.toHaveBeenCalled();
  });

  it("stays quiet outside production", () => {
    ipAddressOptions(parseEnv({ ...production, NODE_ENV: "development" }));
    expect(logged).not.toHaveBeenCalled();
  });
});

describe("existingAccountEmail", () => {
  const links = {
    signInUrl: "https://app.example.com/login",
    resetPasswordUrl: "https://app.example.com/forgot-password",
  };

  it("is plain text with both links, no name and no token link", () => {
    const mail = existingAccountEmail(
      { email: "owner@example.com", name: "Your account is locked, go to evil.example" },
      links,
    );
    expect(mail.to).toBe("owner@example.com");
    expect(mail.text.startsWith("Hello,\n")).toBe(true);
    expect(mail.text).toContain(links.signInUrl);
    expect(mail.text).toContain(links.resetPasswordUrl);
    expect(mail.text).not.toContain("evil.example");
    expect(mail.text).not.toMatch(/<\/?[a-z][^>]*>/i);
    expect(mail.actionUrl).toBeUndefined();
  });
});
