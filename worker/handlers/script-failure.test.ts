import { describe, expect, it, vi } from "vitest";
import {
  DamiApiError,
  DamiConfigError,
  DamiOutputError,
  DamiRefusalError,
  DamiTruncatedError,
} from "../../src/server/damis";
import { scriptWrite } from "../../src/server/jobs";
import { ScriptInputError } from "../../src/server/script";
import { classifyFailure, handleFailure } from "./script-failure";

const ctx = (attempt: number, aborted = false) => {
  const controller = new AbortController();
  if (aborted) controller.abort();
  return { jobId: "j", attempt, signal: controller.signal };
};
const transient = () =>
  new DamiApiError("script-writer", "overloaded", { cause: null, transient: true, status: 529 });

describe("classifyFailure", () => {
  it("maps dami errors to user text and retryability", () => {
    expect(classifyFailure(new DamiRefusalError("k", null, null))).toMatchObject({
      retryable: false,
      message: expect.stringMatching(/declined/),
    });
    expect(classifyFailure(new DamiTruncatedError("k", 10)).retryable).toBe(false);
    expect(classifyFailure(new DamiConfigError("k", "no key")).message).toMatch(/API key/);
    expect(classifyFailure(transient())).toMatchObject({ retryable: true });
    expect(
      classifyFailure(new DamiApiError("k", "bad", { cause: null, transient: false, status: 400 }))
        .retryable,
    ).toBe(false);
    expect(classifyFailure(new DamiOutputError("k", ["x"])).retryable).toBe(true);
    expect(classifyFailure(new ScriptInputError("This file is empty."))).toMatchObject({
      retryable: false,
      message: "This file is empty.",
    });
    expect(classifyFailure(new Error("db down")).retryable).toBe(true);
  });
});

describe("handleFailure", () => {
  it("rethrows a retryable error before the last attempt without recording", async () => {
    const record = vi.fn(async () => undefined);
    await expect(handleFailure(transient(), scriptWrite, ctx(1), record)).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });

  it("records and rethrows on the last attempt", async () => {
    const record = vi.fn(async () => undefined);
    const last = scriptWrite.options.retryLimit + 1;
    await expect(handleFailure(transient(), scriptWrite, ctx(last), record)).rejects.toThrow();
    expect(record).toHaveBeenCalledOnce();
  });

  it("records a non-retryable error and completes", async () => {
    const record = vi.fn(async () => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await handleFailure(new DamiRefusalError("k", null, null), scriptWrite, ctx(1), record);
    expect(record).toHaveBeenCalledOnce();
  });

  it("rethrows an aborted attempt so it is retried", async () => {
    const record = vi.fn(async () => undefined);
    await expect(
      handleFailure(new DamiRefusalError("k", null, null), scriptWrite, ctx(1, true), record),
    ).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });
});
