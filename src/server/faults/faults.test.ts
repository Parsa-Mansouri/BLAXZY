import { APIConnectionError, InternalServerError, RateLimitError } from "@anthropic-ai/sdk";
import { HeadObjectCommand, S3ServiceException } from "@aws-sdk/client-s3";
import { createTransport } from "nodemailer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DamiApiError } from "@/server/damis/framework/errors";
import { defineDami } from "@/server/damis/framework/define";
import { isTransientError } from "@/server/damis/framework/retry";
import { runDami } from "@/server/damis/framework/runner";
import { FakeClaudeClient, jsonResponse, testDeps } from "@/server/damis/test-utils";
import { ConsoleEmailSender, SmtpEmailSender } from "@/server/email/sender";
import { parseEnv } from "@/server/env";
import { ProviderError } from "@/server/providers/errors";
import { withProviderFaults } from "@/server/providers/faults";
import type { GenerationProvider } from "@/server/providers/types";
import { getS3 } from "@/server/storage/client";
import { claudeFaultError } from "./errors";
import {
  faultsEnabled,
  maybeFault,
  parseFaultInject,
  resetFaults,
  seededRandom,
  setFaultsForTest,
  type FaultRule,
} from "./index";

afterEach(() => {
  resetFaults();
  vi.restoreAllMocks();
});

const rule = (target: FaultRule["target"], kind: string, probability = 1): FaultRule => ({
  target,
  kind,
  probability,
});

/** A dice that returns the given values in turn (then 0.99, which never fires). */
const dice = (...values: number[]) => {
  const queue = [...values];
  return () => queue.shift() ?? 0.99;
};

describe("parseFaultInject", () => {
  it("parses rules with and without a probability", () => {
    expect(parseFaultInject("claude:429:0.3, provider:5xx, s3:error:0.1 ,email:fail:1")).toEqual({
      ok: true,
      rules: [
        rule("claude", "429", 0.3),
        rule("provider", "5xx", 1),
        rule("s3", "error", 0.1),
        rule("email", "fail", 1),
      ],
    });
    expect(parseFaultInject("")).toEqual({ ok: true, rules: [] });
  });

  it.each([
    ["claude", /target:kind/],
    ["db:error", /unknown target/],
    ["claude:boom", /unknown kind/],
    ["claude:429:1.5", /probability/],
    ["claude:429:abc", /probability/],
    ["claude:429:0.5:x", /target:kind/],
  ])("rejects %s", (raw, message) => {
    const result = parseFaultInject(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(message);
  });
});

describe("FAULT_INJECT in the environment", () => {
  const valid = {
    DATABASE_URL: "postgresql://blaxzy:blaxzy@localhost:5432/blaxzy",
    BETTER_AUTH_SECRET: "test-secret-with-at-least-32-characters-ok",
    S3_ENDPOINT: "http://localhost:9100",
    S3_BUCKET: "blaxzy",
    S3_ACCESS_KEY_ID: "id",
    S3_SECRET_ACCESS_KEY: "key",
  };

  it("is empty by default and parsed when set", () => {
    expect(parseEnv(valid).FAULT_INJECT).toEqual([]);
    expect(parseEnv({ ...valid, FAULT_INJECT: "claude:429:0.3", FAULT_SEED: "7" })).toMatchObject({
      FAULT_INJECT: [rule("claude", "429", 0.3)],
      FAULT_SEED: 7,
    });
  });

  it("rejects an invalid value", () => {
    expect(() => parseEnv({ ...valid, FAULT_INJECT: "claude:nope" })).toThrow(/FAULT_INJECT/);
  });

  it("rejects any rule in production", () => {
    const production = {
      ...valid,
      NODE_ENV: "production",
      BETTER_AUTH_SECRET: "a-production-secret-that-is-long-enough-123",
      BETTER_AUTH_URL: "https://app.example.com",
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "587",
    };
    expect(() => parseEnv(production)).not.toThrow();
    expect(() => parseEnv({ ...production, FAULT_INJECT: "email:fail:1" })).toThrow(/FAULT_INJECT/);
  });
});

describe("maybeFault", () => {
  it("returns null when nothing is configured", () => {
    setFaultsForTest([]);
    expect(maybeFault("claude")).toBeNull();
    expect(faultsEnabled("claude")).toBe(false);
  });

  it("only fires rules of its own target, in order, by probability", () => {
    setFaultsForTest([rule("claude", "429", 0.5), rule("claude", "5xx", 1)], dice(0.1, 0.9));
    expect(faultsEnabled("claude")).toBe(true);
    expect(faultsEnabled("s3")).toBe(false);
    expect(maybeFault("claude")).toBe("429"); // 0.1 < 0.5
    expect(maybeFault("claude")).toBe("5xx"); // 0.9 misses the first rule, the second is certain
    expect(maybeFault("s3")).toBeNull();
  });

  it("is repeatable with a seed", () => {
    const run = () => {
      const random = seededRandom(42);
      return Array.from({ length: 5 }, () => random());
    };
    expect(run()).toEqual(run());
  });
});

describe("claude hook", () => {
  const echo = defineDami({
    key: "fault-echo",
    version: "0.0.1",
    description: "Test dami",
    input: z.object({ word: z.string() }),
    output: z.object({ upper: z.string() }),
    model: "claude-opus-5-5",
    effort: "low",
    maxOutputTokens: 1000,
    build: (input) => ({
      system: [{ text: "Base prompt", cache: true }],
      messages: [{ role: "user", content: [{ text: `Word: ${input.word}` }] }],
    }),
    check: () => [],
    finalize: (output) => output,
  });

  it("builds the SDK's own error classes", () => {
    const limited = claudeFaultError("429", 7);
    expect(limited).toBeInstanceOf(RateLimitError);
    expect((limited as RateLimitError).headers?.get("retry-after")).toBe("7");
    expect(claudeFaultError("5xx")).toBeInstanceOf(InternalServerError);
    const overloaded = claudeFaultError("529");
    expect(overloaded).toBeInstanceOf(InternalServerError);
    expect((overloaded as InternalServerError).status).toBe(529);
    expect(claudeFaultError("connection")).toBeInstanceOf(APIConnectionError);
    for (const kind of ["429", "5xx", "529", "connection"] as const) {
      expect(isTransientError(claudeFaultError(kind))).toBe(true);
    }
  });

  it("retries a 429 by the existing rules (retry-after, attempt limit) and then fails transient", async () => {
    setFaultsForTest([rule("claude", "429")]);
    const client = new FakeClaudeClient([]);
    const { deps, sleeps } = testDeps(client);
    const error = await runDami(echo, { word: "a" }, {}, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DamiApiError);
    expect(error).toMatchObject({ transient: true, status: 429 });
    expect(client.requests).toHaveLength(0); // never reached the (fake) API
    expect(sleeps).toEqual([1000, 1000, 1000]); // maxRetries 3, each waiting the retry-after
  });

  it("recovers when the fault fires once", async () => {
    setFaultsForTest([rule("claude", "5xx", 0.5)], dice(0.1, 0.9));
    const client = new FakeClaudeClient([jsonResponse({ upper: "A" })]);
    const { deps } = testDeps(client);
    const result = await runDami(echo, { word: "a" }, {}, deps);
    expect(result.attempts).toBe(2);
    expect(result.output).toEqual({ upper: "A" });
  });

  it("sends malformed output down the corrective-retry path", async () => {
    setFaultsForTest([rule("claude", "malformed", 0.5)], dice(0.1, 0.9));
    const client = new FakeClaudeClient([
      jsonResponse({ upper: "A" }),
      jsonResponse({ upper: "A" }),
    ]);
    const { deps } = testDeps(client);
    const result = await runDami(echo, { word: "a" }, {}, deps);
    expect(result.attempts).toBe(2);
    expect(JSON.stringify(client.requests[1]?.messages)).toContain("did not pass validation");
  });
});

describe("provider hook", () => {
  const inner: GenerationProvider = {
    id: "stub",
    price: () => Promise.resolve(1),
    create: () => Promise.resolve({ providerJobId: "job" }),
    getStatus: () => Promise.resolve({ state: "succeeded" }),
    fetchResult: () => Promise.resolve({ mimeType: "image/png", bytes: new Uint8Array() }),
  };
  const request = {} as Parameters<GenerationProvider["create"]>[0];
  const options = { idempotencyKey: "k" };

  it("passes through when disabled", () => {
    expect(withProviderFaults(inner, false)).toBe(inner);
  });

  it("throws retryable and non-retryable ProviderErrors from create", async () => {
    const provider = withProviderFaults(inner, true);
    expect(provider.id).toBe("stub");
    for (const [kind, retryable] of [
      ["5xx", true],
      ["429", true],
      ["timeout", true],
      ["fatal", false],
    ] as const) {
      setFaultsForTest([rule("provider", kind)]);
      const error = await provider.create(request, options).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).retryable).toBe(retryable);
    }
  });

  it("answers 429 with retryAfterMs and a lost job as a permanent failure from getStatus", async () => {
    const provider = withProviderFaults(inner, true);
    setFaultsForTest([rule("provider", "429")]);
    expect(await provider.getStatus("job")).toMatchObject({ state: "running" });
    expect(await provider.getStatus("job")).toHaveProperty("retryAfterMs");
    setFaultsForTest([rule("provider", "lost")]);
    expect(await provider.getStatus("job")).toMatchObject({ state: "failed", retryable: false });
    setFaultsForTest([rule("provider", "5xx")]);
    await expect(provider.getStatus("job")).rejects.toBeInstanceOf(ProviderError);
  });

  it("fails fetchResult for a lost job without retry", async () => {
    const provider = withProviderFaults(inner, true);
    setFaultsForTest([rule("provider", "lost")]);
    const error = await provider.fetchResult("job").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).retryable).toBe(false);
    setFaultsForTest([]);
    expect(await provider.fetchResult("job")).toHaveProperty("mimeType", "image/png");
  });
});

describe("s3 hook", () => {
  it("throws the SDK's service error inside the SDK's retries", async () => {
    let rolls = 0;
    setFaultsForTest([rule("s3", "error")], () => {
      rolls++;
      return 0;
    });
    const error = await getS3()
      .send(new HeadObjectCommand({ Bucket: "b", Key: "k" }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(S3ServiceException);
    expect((error as S3ServiceException).$metadata.httpStatusCode).toBe(500);
    // probability 1 never rolls the dice, so count attempts through the error instead
    expect(rolls).toBe(0);
    expect((error as { $metadata: { attempts?: number } }).$metadata.attempts).toBeGreaterThan(1);
  });
});

describe("email hook", () => {
  const message = { to: "user@example.com", subject: "Hi", text: "body" };

  it("fails the console and SMTP senders", async () => {
    setFaultsForTest([rule("email", "fail")]);
    await expect(new ConsoleEmailSender("a@b.c").send(message)).rejects.toThrow(/Injected fault/);
    const transport = createTransport({ jsonTransport: true });
    const sendMail = vi.spyOn(transport, "sendMail");
    const sender = new SmtpEmailSender(
      { from: "BLAXZY <no-reply@example.com>", host: "smtp.example.com", port: 587 },
      transport,
    );
    await expect(sender.send(message)).rejects.toThrow(/Injected fault/);
    expect(sendMail).not.toHaveBeenCalled();
  });
});
