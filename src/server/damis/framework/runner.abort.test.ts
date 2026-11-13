import { APIUserAbortError, BadRequestError, OverloadedError } from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { Semaphore } from "./concurrency";
import { defineDami } from "./define";
import { DamiAbortedError, DamiApiError, DamiError, DamiInputError } from "./errors";
import { ImageUnusableError, MAX_PROMPT_IMAGES, type ImageResolver } from "./images";
import { runDami } from "./runner";

const echo = defineDami({
  key: "test-abort",
  version: "0.0.1",
  description: "Test dami",
  input: z.object({ word: z.string().min(1) }),
  output: z.object({ upper: z.string() }),
  model: "claude-opus-5-5",
  effort: "low",
  maxOutputTokens: 1000,
  build: (input) => ({
    system: [{ text: "Base prompt", cache: true }],
    messages: [{ role: "user", content: [{ text: `Word: ${input.word}` }] }],
  }),
});

const looker = defineDami({
  key: "test-abort-looker",
  version: "0.0.1",
  description: "Test dami with images",
  input: z.object({ fileIds: z.array(z.string()).min(1) }),
  output: z.object({ seen: z.number().int() }),
  model: "claude-opus-5-5",
  effort: "low",
  maxOutputTokens: 1000,
  build: (input) => ({
    system: [{ text: "Base prompt", cache: true }],
    messages: [
      {
        role: "user",
        content: [...input.fileIds.map((fileId) => ({ image: { fileId } })), { text: "Look." }],
      },
    ],
  }),
});

const overloaded = () => new OverloadedError(529, { type: "error" }, "busy", new Headers());

describe("success bookkeeping", () => {
  it("returns the paid output when recording the success fails, and never calls the model again", async () => {
    const client = new FakeClaudeClient([jsonResponse({ upper: "HI" })]);
    const { deps, store } = testDeps(client);
    const finish = vi.spyOn(store, "finish").mockRejectedValueOnce(new Error("db down"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await runDami(echo, { word: "hi" }, {}, deps);
    expect(result.output).toEqual({ upper: "HI" });
    expect(client.requests).toHaveLength(1);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain(result.runId);
    log.mockRestore();
  });
});

describe("abort handling", () => {
  it("stops waiting for a retry backoff when the signal aborts, and stores the run as aborted", async () => {
    const controller = new AbortController();
    const client = new FakeClaudeClient([overloaded(), jsonResponse({ upper: "HI" })]);
    const { deps, store } = testDeps(client, {
      // A backoff that would never end on its own.
      sleep: () => new Promise<void>(() => undefined),
    });
    const caught = runDami(echo, { word: "hi" }, { signal: controller.signal }, deps).catch(
      (e: unknown) => e,
    );
    await vi.waitFor(() => expect(client.requests).toHaveLength(1));
    controller.abort();
    const error = await caught;
    expect(error).toBeInstanceOf(DamiAbortedError);
    expect(error).toBeInstanceOf(DamiError);
    expect(client.requests).toHaveLength(1);
    expect(store.runs[0]?.finish).toMatchObject({ status: "aborted", attempts: 1 });
  });

  it("does not let a queued call of an aborted run take a slot", async () => {
    const controller = new AbortController();
    const limiter = new Semaphore(1);
    let release: () => void = () => undefined;
    const held = limiter.run(() => new Promise<void>((r) => (release = r)));
    const client = new FakeClaudeClient([jsonResponse({ upper: "HI" })]);
    const { deps, store } = testDeps(client, { limiter });
    const caught = runDami(echo, { word: "hi" }, { signal: controller.signal }, deps).catch(
      (e: unknown) => e,
    );
    await vi.waitFor(() => expect(limiter.pending).toBe(1));
    controller.abort();
    expect(await caught).toBeInstanceOf(DamiAbortedError);
    expect(limiter.pending).toBe(0);
    expect(client.requests).toHaveLength(0);
    expect(store.runs[0]?.finish).toMatchObject({ status: "aborted", attempts: 1 });
    release();
    await held;
    expect(limiter.active).toBe(0);
  });

  it("maps an SDK abort error to DamiAbortedError and does not retry it", async () => {
    const client = new FakeClaudeClient([new APIUserAbortError(), jsonResponse({ upper: "HI" })]);
    const { deps, store, sleeps } = testDeps(client);
    const error = await runDami(echo, { word: "hi" }, {}, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DamiAbortedError);
    expect(client.requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expect(store.runs[0]?.finish).toMatchObject({ status: "aborted" });
  });

  it("checks the signal at the top of each retry iteration", async () => {
    const controller = new AbortController();
    const client = new FakeClaudeClient([overloaded(), jsonResponse({ upper: "HI" })]);
    // The injected sleep resolves, but aborts the signal while "sleeping".
    const { deps, store } = testDeps(client, {
      sleep: async () => {
        controller.abort();
      },
    });
    const error = await runDami(echo, { word: "hi" }, { signal: controller.signal }, deps).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DamiAbortedError);
    expect(client.requests).toHaveLength(1);
    expect(store.runs[0]?.finish?.status).toBe("aborted");
  });

  it("still stores real API failures as failed", async () => {
    const client = new FakeClaudeClient([
      new BadRequestError(400, { error: { type: "invalid_request_error" } }, "bad", new Headers()),
    ]);
    const { deps, store } = testDeps(client);
    const error = await runDami(echo, { word: "hi" }, {}, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DamiApiError);
    expect(store.runs[0]?.finish?.status).toBe("failed");
  });
});

describe("Semaphore with a signal", () => {
  it("rejects a queued waiter on abort without leaking the slot", async () => {
    const sem = new Semaphore(1);
    let release: () => void = () => undefined;
    const first = sem.run(() => new Promise<void>((r) => (release = r)));
    const controller = new AbortController();
    const queued = sem.run(async () => "ran", controller.signal);
    controller.abort(new Error("stop"));
    await expect(queued).rejects.toThrow("stop");
    expect(sem.pending).toBe(0);
    release();
    await first;
    expect(sem.active).toBe(0);
    await expect(sem.run(async () => "ok")).resolves.toBe("ok");
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const sem = new Semaphore(2);
    await expect(sem.run(async () => 1, AbortSignal.abort())).rejects.toBeDefined();
    expect(sem.active).toBe(0);
  });
});

describe("image loading in the runner", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `f${i}`);
  const png: ImageResolver = async (id) => ({ mediaType: "image/png", data: `b64-${id}` });

  it("records an image failure on the run row, after the row exists", async () => {
    const client = new FakeClaudeClient([jsonResponse({ seen: 1 })]);
    const { deps, store } = testDeps(client, {
      resolveImage: async () => {
        throw new ImageUnusableError("Unsupported image format svg");
      },
    });
    const error = await runDami(looker, { fileIds: ["x"] }, {}, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DamiInputError);
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0]?.finish?.status).toBe("failed");
    expect((error as DamiInputError).runId).toBe(store.runs[0]?.id);
    expect(client.requests).toHaveLength(0);
  });

  it("turns a storage or network failure into a transient API error", async () => {
    const client = new FakeClaudeClient([jsonResponse({ seen: 1 })]);
    const { deps, store } = testDeps(client, {
      resolveImage: async () => {
        throw Object.assign(new Error("connect ECONNRESET"), { code: "ECONNRESET" });
      },
    });
    const error = await runDami(looker, { fileIds: ["x"] }, {}, deps).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DamiApiError);
    expect((error as DamiApiError).transient).toBe(true);
    expect(store.runs[0]?.finish?.status).toBe("failed");
  });

  it("treats a storage not-found as a genuine input problem", async () => {
    const client = new FakeClaudeClient([]);
    const { deps } = testDeps(client, {
      resolveImage: async () => {
        throw Object.assign(new Error("File not found"), { name: "StorageError" });
      },
    });
    await expect(runDami(looker, { fileIds: ["x"] }, {}, deps)).rejects.toBeInstanceOf(
      DamiInputError,
    );
  });

  it("rejects more than the maximum number of images without loading any", async () => {
    const calls: string[] = [];
    const client = new FakeClaudeClient([]);
    const { deps } = testDeps(client, {
      resolveImage: async (id) => {
        calls.push(id);
        return png(id);
      },
    });
    const error = await runDami(looker, { fileIds: ids(MAX_PROMPT_IMAGES + 1) }, {}, deps).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DamiInputError);
    expect(calls).toEqual([]);
  });

  it("rejects images past the total byte budget", async () => {
    const client = new FakeClaudeClient([]);
    const { deps } = testDeps(client, {
      resolveImage: async () => ({ mediaType: "image/png", data: "x".repeat(8 * 1024 * 1024) }),
    });
    await expect(runDami(looker, { fileIds: ids(4) }, {}, deps)).rejects.toBeInstanceOf(
      DamiInputError,
    );
  });

  it("loads at most three images at a time", async () => {
    let active = 0;
    let peak = 0;
    const client = new FakeClaudeClient([jsonResponse({ seen: 10 })]);
    const { deps } = testDeps(client, {
      resolveImage: async (id) => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return png(id);
      },
    });
    await runDami(looker, { fileIds: ids(10) }, {}, deps);
    expect(peak).toBe(3);
  });

  it("maps an abort during image loading to DamiAbortedError", async () => {
    const controller = new AbortController();
    const client = new FakeClaudeClient([]);
    const { deps, store } = testDeps(client, {
      resolveImage: async () => {
        controller.abort();
        throw controller.signal.reason;
      },
    });
    const error = await runDami(
      looker,
      { fileIds: ["x"] },
      { signal: controller.signal },
      deps,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DamiAbortedError);
    expect(store.runs[0]?.finish?.status).toBe("aborted");
  });
});
