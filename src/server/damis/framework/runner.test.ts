import {
  APIConnectionError,
  APIError,
  BadRequestError,
  OverloadedError,
  RateLimitError,
} from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { waitFor } from "../../test-support/wait-for";
import { FakeClaudeClient, fakeResponse, jsonResponse, testDeps } from "../test-utils";
import { Semaphore } from "./concurrency";
import { defineDami } from "./define";
import {
  DamiApiError,
  DamiConfigError,
  DamiInputError,
  DamiOutputError,
  DamiRefusalError,
  DamiTruncatedError,
} from "./errors";
import { computeCostUsd } from "./pricing";
import { backoffDelayMs, isTransientError } from "./retry";
import { runDami } from "./runner";

const echo = defineDami({
  key: "test-echo",
  version: "0.0.1",
  description: "Test dami",
  input: z.object({ word: z.string().min(1) }),
  output: z.object({ upper: z.string(), length: z.number().int().min(1) }),
  model: "claude-opus-5-5",
  effort: "low",
  maxOutputTokens: 1000,
  build: (input) => ({
    system: [
      { text: "Base prompt", cache: true },
      { text: "Module", cache: true },
    ],
    messages: [{ role: "user", content: [{ text: `Word: ${input.word}` }] }],
  }),
  check: (output, input) =>
    output.upper === input.word.toUpperCase()
      ? []
      : [`upper must be "${input.word.toUpperCase()}"`],
  finalize: (output) => ({ ...output, finalized: true as const }),
});

const headers = () => new Headers({ "retry-after": "0" });

/** A promise the test resolves by hand, so ordering never depends on a timer. */
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("runDami", () => {
  it("runs, validates, finalizes and records a successful run", async () => {
    const client = new FakeClaudeClient([
      jsonResponse(
        { upper: "HELLO", length: 5 },
        { usage: { input: 1000, output: 200, cacheRead: 3000, cacheWrite: 400 } },
      ),
    ]);
    const { deps, store } = testDeps(client);
    const result = await runDami(echo, { word: "hello" }, { userId: "u1", projectId: "p1" }, deps);

    expect(result.output).toEqual({ upper: "HELLO", length: 5, finalized: true });
    expect(result.attempts).toBe(1);
    expect(result.model).toBe("claude-opus-5-5");
    expect(result.usage).toEqual({
      inputTokens: 1000,
      outputTokens: 200,
      cacheReadTokens: 3000,
      cacheWriteTokens: 400,
    });
    // 1000*4 + 200*20 + 3000*0.2 + 400*5 = 10600 per million
    expect(result.costUsd).toBeCloseTo(0.0106, 6);

    const [run] = store.runs;
    expect(run).toMatchObject({
      damiKey: "test-echo",
      damiVersion: "0.0.1",
      model: "claude-opus-5-5",
      userId: "u1",
      projectId: "p1",
      input: { word: "hello" },
    });
    expect(run?.finish).toMatchObject({ status: "succeeded", attempts: 1, costUsd: 0.0106 });

    const request = client.requests[0];
    expect(request?.model).toBe("claude-opus-5-5");
    expect(request?.max_tokens).toBe(1000);
    expect(request?.output_config?.effort).toBe("low");
    expect(request?.output_config?.format?.type).toBe("json_schema");
    expect(request?.output_config?.format?.schema).toMatchObject({
      type: "object",
      additionalProperties: false,
    });
    expect(request?.system).toEqual([
      { type: "text", text: "Base prompt", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Module", cache_control: { type: "ephemeral" } },
    ]);
    expect(client.methods).toEqual(["create"]);
  });

  it("feeds validation errors back once and succeeds on the corrected output", async () => {
    const client = new FakeClaudeClient([
      jsonResponse({ upper: "HELLO", length: 0 }),
      jsonResponse({ upper: "HELLO", length: 5 }),
    ]);
    const { deps, store } = testDeps(client);
    const result = await runDami(echo, { word: "hello" }, {}, deps);

    expect(result.attempts).toBe(2);
    expect(result.usage.inputTokens).toBe(200);
    const retry = client.requests[1];
    expect(retry?.messages).toHaveLength(3);
    expect(retry?.messages[1]).toEqual({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "", signature: "sig_fake" },
        { type: "text", text: '{"upper":"HELLO","length":0}' },
      ],
    });
    expect(retry?.messages[2]?.role).toBe("user");
    expect(JSON.stringify(retry?.messages[2]?.content)).toContain("length");
    expect(store.runs[0]?.finish?.status).toBe("succeeded");
  });

  it("runs the corrective retry on retryModel, replaying the text only, and prices each call by its model", async () => {
    const cheapFirst = defineDami({
      key: "test-retry-model",
      version: "0.0.1",
      description: "Sonnet first, Opus to fix",
      input: z.object({ word: z.string().min(1) }),
      output: z.object({ upper: z.string() }),
      model: "claude-sonnet-5-5",
      retryModel: "claude-opus-5-5",
      maxOutputTokens: 1000,
      build: (input) => ({
        system: [{ text: "Base" }],
        messages: [{ role: "user", content: [{ text: input.word }] }],
      }),
      check: (output, input) => (output.upper === input.word.toUpperCase() ? [] : ["wrong"]),
    });
    const usage = { input: 1_000_000, output: 0 };
    const client = new FakeClaudeClient([
      jsonResponse({ upper: "HELO" }, { usage }),
      jsonResponse({ upper: "HELLO" }, { usage }),
    ]);
    const { deps, store } = testDeps(client);
    const result = await runDami(cheapFirst, { word: "hello" }, {}, deps);
    expect(client.requests.map((r) => r.model)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(client.requests[1]?.messages[1]).toEqual({
      role: "assistant",
      content: [{ type: "text", text: '{"upper":"HELO"}' }],
    });
    expect(result.model).toBe("claude-opus-5-5");
    // 1M input tokens on Sonnet ($2) + 1M on Opus ($4)
    expect(result.costUsd).toBe(6);
    expect(store.runs[0]?.model).toBe("claude-sonnet-5-5");
    expect(store.runs[0]?.finish?.costUsd).toBe(6);

    // An explicit run model replaces both calls' models.
    const pinned = new FakeClaudeClient([
      jsonResponse({ upper: "X" }),
      jsonResponse({ upper: "HI" }),
    ]);
    await runDami(cheapFirst, { word: "hi" }, { model: "claude-haiku-5-5" }, testDeps(pinned).deps);
    expect(pinned.requests.map((r) => r.model)).toEqual(["claude-haiku-5-5", "claude-haiku-5-5"]);
    // Same model on both calls: the thinking block is replayed.
    expect(JSON.stringify(pinned.requests[1]?.messages[1])).toContain("thinking");
  });

  it("treats semantic check failures like schema errors", async () => {
    const client = new FakeClaudeClient([
      jsonResponse({ upper: "HELO", length: 5 }),
      jsonResponse({ upper: "HELLO", length: 5 }),
    ]);
    const { deps } = testDeps(client);
    await runDami(echo, { word: "hello" }, {}, deps);
    expect(JSON.stringify(client.requests[1]?.messages[2]?.content)).toContain("upper must be");
  });

  it("fails after one corrective retry and records the failure", async () => {
    const client = new FakeClaudeClient([fakeResponse("not json"), jsonResponse({ upper: 1 })]);
    const { deps, store } = testDeps(client);
    const error = await runDami(echo, { word: "hello" }, {}, deps).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DamiOutputError);
    expect((error as DamiOutputError).runId).toBe("run-1");
    expect(client.requests).toHaveLength(2);
    expect(store.runs[0]?.finish).toMatchObject({ status: "failed", attempts: 2 });
    const finish = store.runs[0]?.finish;
    expect(finish?.status === "failed" && finish.error).toContain("DamiOutputError");
    expect(finish?.usage?.inputTokens).toBe(200);
  });

  it("retries transient errors with backoff", async () => {
    const client = new FakeClaudeClient([
      new RateLimitError(429, { error: { type: "rate_limit_error" } }, "rate limited", headers()),
      new OverloadedError(
        529,
        { error: { type: "overloaded_error" } },
        "overloaded",
        new Headers(),
      ),
      new APIConnectionError({ message: "socket hang up" }),
      jsonResponse({ upper: "HI", length: 2 }),
    ]);
    const { deps, sleeps } = testDeps(client);
    const result = await runDami(echo, { word: "hi" }, {}, deps);
    expect(result.attempts).toBe(4);
    expect(sleeps).toHaveLength(3);
    expect(sleeps[0]).toBe(0); // retry-after: 0
  });

  it("retries a mid-stream overloaded error", async () => {
    const midStream = new APIError(
      undefined,
      { error: { type: "overloaded_error" } },
      undefined,
      new Headers(),
      "overloaded_error",
    );
    expect(isTransientError(midStream)).toBe(true);
    const client = new FakeClaudeClient([midStream, jsonResponse({ upper: "HI", length: 2 })]);
    const { deps } = testDeps(client);
    expect((await runDami(echo, { word: "hi" }, {}, deps)).attempts).toBe(2);
  });

  it("does not retry non-transient errors", async () => {
    const client = new FakeClaudeClient([
      new BadRequestError(400, { error: { type: "invalid_request_error" } }, "bad", new Headers()),
    ]);
    const { deps, store, sleeps } = testDeps(client);
    const error = await runDami(echo, { word: "hi" }, {}, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DamiApiError);
    expect((error as DamiApiError).transient).toBe(false);
    expect((error as DamiApiError).status).toBe(400);
    expect(sleeps).toHaveLength(0);
    expect(store.runs[0]?.finish).toMatchObject({ status: "failed", attempts: 1, usage: null });
  });

  it("gives up after the retry budget", async () => {
    const overloaded = () =>
      new OverloadedError(529, { error: { type: "overloaded_error" } }, "busy", new Headers());
    const client = new FakeClaudeClient([overloaded(), overloaded(), overloaded(), overloaded()]);
    const { deps } = testDeps(client);
    const error = await runDami(echo, { word: "hi" }, {}, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DamiApiError);
    expect((error as DamiApiError).transient).toBe(true);
    expect(client.requests).toHaveLength(4); // maxRetries 3 + the first try
  });

  it("throws a typed error on refusal and on truncation, without retrying", async () => {
    const refused = fakeResponse("", { stopReason: "refusal" });
    refused.stop_details = { type: "refusal", category: "general_harms", explanation: "no" };
    const a = testDeps(new FakeClaudeClient([refused]));
    await expect(runDami(echo, { word: "hi" }, {}, a.deps)).rejects.toBeInstanceOf(
      DamiRefusalError,
    );
    expect(a.store.runs[0]?.finish?.status).toBe("failed");

    const b = testDeps(
      new FakeClaudeClient([fakeResponse('{"upper":', { stopReason: "max_tokens" })]),
    );
    await expect(runDami(echo, { word: "hi" }, {}, b.deps)).rejects.toBeInstanceOf(
      DamiTruncatedError,
    );
  });

  it("rejects invalid input before writing a run", async () => {
    const { deps, store } = testDeps(new FakeClaudeClient([]));
    await expect(runDami(echo, { word: "" }, {}, deps)).rejects.toBeInstanceOf(DamiInputError);
    expect(store.runs).toHaveLength(0);
  });

  it("fails clearly when no API key is configured", async () => {
    const { deps, store } = testDeps(new FakeClaudeClient([]), { client: undefined });
    const error = await runDami(echo, { word: "hi" }, {}, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DamiConfigError);
    expect((error as Error).message).toContain("ANTHROPIC_API_KEY");
    expect(store.runs).toHaveLength(0);
  });

  it("resolves the model: explicit, then DAMI_DEFAULT_MODEL, then the dami default", async () => {
    const response = () => jsonResponse({ upper: "HI", length: 2 });
    const client = new FakeClaudeClient([response(), response()]);
    const { deps } = testDeps(client, {
      config: {
        apiKey: undefined,
        defaultModel: "claude-haiku-5-5",
        maxConcurrency: 4,
        maxRetries: 0,
      },
    });
    const overridden = await runDami(echo, { word: "hi" }, {}, deps);
    expect(overridden.model).toBe("claude-haiku-5-5");
    expect(overridden.costUsd).toBeNull(); // no confirmed price
    const explicit = await runDami(echo, { word: "hi" }, { model: "claude-sonnet-5-5" }, deps);
    expect(explicit.model).toBe("claude-sonnet-5-5");
    expect(client.requests.map((r) => r.model)).toEqual(["claude-haiku-5-5", "claude-sonnet-5-5"]);
  });

  it("streams damis with large output budgets", async () => {
    const long = defineDami({
      ...echo,
      key: "test-long",
      maxOutputTokens: 64_000,
      streaming: undefined, // derive it from the budget
    });
    expect(long.streaming).toBe(true);
    const client = new FakeClaudeClient([jsonResponse({ upper: "HI", length: 2 })]);
    await runDami(long, { word: "hi" }, {}, testDeps(client).deps);
    expect(client.methods).toEqual(["stream"]);
  });

  it("respects the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    let started = 0;
    // Each call holds its slot until the test releases it.
    const gates = Array.from({ length: 6 }, deferred);
    const slow = (gate: ReturnType<typeof deferred>) => async () => {
      active++;
      started++;
      peak = Math.max(peak, active);
      await gate.promise;
      active--;
      return jsonResponse({ upper: "HI", length: 2 });
    };
    const client = new FakeClaudeClient(gates.map(slow));
    const limiter = new Semaphore(2);
    const { deps } = testDeps(client, { limiter });
    const runs = Array.from({ length: 6 }, () => runDami(echo, { word: "hi" }, {}, deps));

    // Two calls hold the slots and the other four wait for them: nothing else may start.
    await waitFor(() => limiter.active === 2 && limiter.pending === 4, {
      description: "two running calls and four waiting",
    });
    expect(started).toBe(2);
    expect(active).toBe(2);

    // Freeing one slot lets exactly one more call in.
    gates[0]?.release();
    await waitFor(() => started === 3, { description: "a third call to start" });
    await waitFor(() => limiter.pending === 3);
    expect(active).toBe(2);

    for (const gate of gates) gate.release();
    await Promise.all(runs);
    expect(peak).toBe(2);
    expect(started).toBe(6);
    expect(client.requests).toHaveLength(6);
  });
});

describe("Semaphore", () => {
  it("runs at most max tasks and keeps FIFO order", async () => {
    const semaphore = new Semaphore(1);
    const order: number[] = [];
    const gates = [1, 2, 3].map(deferred);
    const runs = [1, 2, 3].map((n) =>
      semaphore.run(async () => {
        order.push(n);
        await gates[n - 1]?.promise;
      }),
    );
    // Each task starts only after the previous one finished, in the order they asked.
    for (const n of [1, 2, 3]) {
      await waitFor(() => order.length === n, { description: `task ${n} to start` });
      expect(order).toEqual([1, 2, 3].slice(0, n));
      expect(semaphore.active).toBe(1);
      expect(semaphore.pending).toBe(3 - n);
      gates[n - 1]?.release();
    }
    await Promise.all(runs);
    expect(order).toEqual([1, 2, 3]);
    expect(semaphore.active).toBe(0);
  });
});

describe("retry policy", () => {
  it("backs off exponentially with jitter, capped", () => {
    const options = { baseDelayMs: 1000, maxDelayMs: 8000, random: () => 1 };
    expect([1, 2, 3, 4, 5].map((n) => backoffDelayMs(n, new Error("x"), options))).toEqual([
      1000, 2000, 4000, 8000, 8000,
    ]);
    expect(backoffDelayMs(3, new Error("x"), { ...options, random: () => 0 })).toBe(2000);
  });

  it("classifies errors", () => {
    expect(isTransientError(new Error("boom"))).toBe(false);
    expect(isTransientError(Object.assign(new Error("reset"), { code: "ECONNRESET" }))).toBe(true);
  });
});

describe("computeCostUsd", () => {
  it("returns null for models without a confirmed price", () => {
    const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(computeCostUsd("claude-haiku-5-5", usage)).toBeNull();
    expect(computeCostUsd("claude-sonnet-5-5", { ...usage, inputTokens: 1_000_000 })).toBe(2.00001);
  });
});
