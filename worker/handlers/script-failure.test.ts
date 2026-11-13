import { describe, expect, it, vi } from "vitest";
import { AssetInputError } from "../../src/server/assets";
import { InsufficientCreditsError } from "../../src/server/billing";
import {
  DamiAbortedError,
  DamiApiError,
  DamiConfigError,
  DamiInputError,
  DamiOutputError,
  DamiRefusalError,
  DamiTruncatedError,
} from "../../src/server/damis";
import { GenerationInputError } from "../../src/server/generation";
import { JobShutdownError, scriptWrite } from "../../src/server/jobs";
import { ProductionInputError } from "../../src/server/production";
import { ScriptInputError } from "../../src/server/script";
import { classifyAssetFailure } from "./asset-failure";
import { creditsMessage, handleFailure, TOOK_TOO_LONG } from "./failure";
import { classifyProductionFailure } from "./production-failure";
import { classifyFailure } from "./script-failure";

const ctx = (attempt: number, abort?: "expired" | "shutdown", retryLimit?: number) => {
  const controller = new AbortController();
  if (abort === "expired") controller.abort();
  if (abort === "shutdown") controller.abort(new JobShutdownError());
  return { jobId: "j", attempt, signal: controller.signal, retryLimit };
};
const transient = () =>
  new DamiApiError("script-writer", "overloaded", { cause: null, transient: true, status: 529 });
const permanent = () =>
  new DamiApiError("k", "bad", { cause: null, transient: false, status: 400 });
const last = scriptWrite.options.retryLimit + 1;

describe("classifyFailure", () => {
  it("maps dami errors to user text and retryability", () => {
    expect(classifyFailure(new DamiRefusalError("k", null, null))).toMatchObject({
      retryable: false,
      message: expect.stringMatching(/declined/),
    });
    expect(classifyFailure(new DamiTruncatedError("k", 10)).retryable).toBe(false);
    expect(classifyFailure(new DamiConfigError("k", "no key")).message).toMatch(/API key/);
    expect(classifyFailure(transient())).toMatchObject({ retryable: true });
    expect(classifyFailure(permanent()).retryable).toBe(false);
    expect(classifyFailure(new DamiOutputError("k", ["x"])).retryable).toBe(true);
    expect(classifyFailure(new ScriptInputError("This file is empty."))).toMatchObject({
      retryable: false,
      message: "This file is empty.",
    });
    expect(classifyFailure(new Error("db down")).retryable).toBe(true);
  });

  // The wording each area showed before the three mappers were folded into one.
  it("keeps every area's messages byte for byte", () => {
    const errors = {
      refusal: new DamiRefusalError("k", null, null),
      truncated: new DamiTruncatedError("k", 10),
      input: new DamiInputError("k", ["empty"]),
      config: new DamiConfigError("k", "no key"),
      output: new DamiOutputError("k", ["x"]),
      busy: transient(),
      failed: permanent(),
      other: new Error("x"),
    };
    const messages = (classify: (e: unknown) => { message: string }) =>
      Object.fromEntries(Object.entries(errors).map(([k, e]) => [k, classify(e).message]));
    const common = {
      output: "Claude's answer could not be used this time. Try again.",
      busy: "Claude is busy right now. Try again in a few minutes.",
      failed: "The request to Claude failed. Try again later.",
    };
    expect(messages(classifyFailure)).toEqual({
      ...common,
      refusal:
        "Claude declined this request. Rephrase the brief or the script so it stays clear of sensitive content, then try again.",
      truncated:
        "The result came out too long to finish in one go. Try a shorter duration or a shorter script.",
      input: "This script could not be processed: it is empty or too long. Check it and try again.",
      config:
        "Script writing is not set up on this server (the Claude API key is missing). Contact support.",
      other: "Something went wrong while preparing the script. Try again.",
    });
    expect(messages(classifyAssetFailure)).toEqual({
      ...common,
      refusal:
        "Claude declined to write this image prompt. Describe the asset differently, then try again.",
      truncated:
        "This description could not be turned into an image prompt. Shorten it and try again.",
      input: "This description could not be turned into an image prompt. Shorten it and try again.",
      config:
        "Image prompts cannot be written on this server (the Claude API key is missing). Contact support.",
      other: "Something went wrong while preparing this image. Try again.",
    });
    expect(messages(classifyProductionFailure)).toEqual({
      ...common,
      refusal:
        "Claude declined to write this shot's prompt. Change the shot (or its review), then try again.",
      truncated: "This shot could not be turned into a video prompt. Shorten it and try again.",
      input: "This shot could not be turned into a video prompt. Shorten it and try again.",
      config:
        "Video prompts cannot be written on this server (the Claude API key is missing). Contact support.",
      other: "Something went wrong while preparing this shot. Try again.",
    });
  });

  it("shows credits and input errors in the areas that have them", () => {
    const credits = new InsufficientCreditsError(1, 4);
    expect(classifyAssetFailure(credits)).toMatchObject({
      retryable: false,
      message: "You need 4 credits for this; you have 1.",
    });
    expect(classifyProductionFailure(credits).message).toBe(creditsMessage(credits));
    expect(classifyFailure(credits).retryable).toBe(true); // scripts spend no credits
    expect(classifyAssetFailure(new AssetInputError("Gone."))).toMatchObject({
      message: "Gone.",
      retryable: false,
    });
    expect(classifyAssetFailure(new GenerationInputError("Bad ref.")).message).toBe("Bad ref.");
    expect(classifyProductionFailure(new ProductionInputError("No style.")).message).toBe(
      "No style.",
    );
  });
});

describe("handleFailure", () => {
  it("rethrows a retryable error before the last attempt without recording", async () => {
    const record = vi.fn(async () => undefined);
    await expect(
      handleFailure(transient(), scriptWrite, ctx(1), record, classifyFailure),
    ).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });

  it("records and rethrows on the last attempt", async () => {
    const record = vi.fn(async () => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      handleFailure(transient(), scriptWrite, ctx(last), record, classifyFailure),
    ).rejects.toThrow();
    expect(record).toHaveBeenCalledOnce();
  });

  it("records a non-retryable error and completes", async () => {
    const record = vi.fn(async () => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await handleFailure(
      new DamiRefusalError("k", null, null),
      scriptWrite,
      ctx(1),
      record,
      classifyFailure,
    );
    expect(record).toHaveBeenCalledOnce();
  });

  it("rethrows an expired attempt so it is retried", async () => {
    const record = vi.fn(async () => undefined);
    await expect(
      handleFailure(
        new DamiRefusalError("k", null, null),
        scriptWrite,
        ctx(1, "expired"),
        record,
        classifyFailure,
      ),
    ).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });

  // Regression: an attempt aborted on its last try used to rethrow before recording anything,
  // leaving the domain row pending forever.
  it("records 'took too long' when the last attempt expired, then rethrows", async () => {
    const record = vi.fn(async () => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      handleFailure(
        new Error("aborted"),
        scriptWrite,
        ctx(last, "expired"),
        record,
        classifyFailure,
      ),
    ).rejects.toThrow("aborted");
    expect(record).toHaveBeenCalledWith({ message: TOOK_TOO_LONG, retryable: true, runId: null });
  });

  it("never records an attempt interrupted by a shutdown, even the last one", async () => {
    const record = vi.fn(async () => undefined);
    await expect(
      handleFailure(new Error("x"), scriptWrite, ctx(last, "shutdown"), record, classifyFailure),
    ).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });

  it("uses the delivered job's retry limit (an attempt given back at a shutdown)", async () => {
    const record = vi.fn(async () => undefined);
    // Attempt `last` of a job whose limit was raised by one is not its last.
    await expect(
      handleFailure(transient(), scriptWrite, ctx(last, undefined, last), record, classifyFailure),
    ).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });

  it("treats an aborted dami like an expired attempt, and never records it at a shutdown", async () => {
    const record = vi.fn(async () => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const aborted = () => new DamiAbortedError("script-writer");
    await expect(
      handleFailure(aborted(), scriptWrite, ctx(1), record, classifyFailure),
    ).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
    await expect(
      handleFailure(aborted(), scriptWrite, ctx(last, "shutdown"), record, classifyFailure),
    ).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
    await expect(
      handleFailure(aborted(), scriptWrite, ctx(last), record, classifyFailure),
    ).rejects.toThrow();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ message: TOOK_TOO_LONG }));
    expect(classifyFailure(aborted())).toMatchObject({ message: TOOK_TOO_LONG, retryable: true });
  });
});
