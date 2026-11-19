import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { APIUserAbortError } from "@anthropic-ai/sdk";
import type { z } from "zod";
import { getEnv } from "@/server/env";
import { logLine } from "@/server/log";
import {
  getDefaultClaudeClient,
  type ClaudeClient,
  type ClaudeRequest,
  type ClaudeResponse,
  withClaudeFaults,
} from "./client";
import { getProcessClaudeLimiter, Semaphore } from "./concurrency";
import { STREAMING_THRESHOLD_TOKENS, type DamiDefinition, type DamiEffort } from "./define";
import {
  DamiAbortedError,
  DamiApiError,
  DamiConfigError,
  DamiError,
  DamiInputError,
  DamiOutputError,
  DamiRefusalError,
  DamiTruncatedError,
} from "./errors";
import {
  isUnusableImageError,
  resolvePromptImages,
  storageImageResolver,
  type ImageResolver,
  type ResolvedImage,
} from "./images";
import { resolveDamiMode, SAMPLE_MODEL, warnSampleModeInProduction, type DamiMode } from "./mode";
import { resolveModel } from "./models";
import { addUsage, computeCostUsd, ZERO_USAGE, type TokenUsage } from "./pricing";
import { buildClaudeRequest, replayAssistantContent, responseText } from "./request";
import { backoffDelayMs, DEFAULT_BACKOFF, errorStatus, isTransientError } from "./retry";
import { createDrizzleDamiRunStore, type DamiRunStore } from "./store";
import { createSampleClaudeClient } from "../sample/client";

/** Who the run is for. Both ids are optional so damis can run outside a project (CLI, Pro tools). */
export type DamiRunContext = {
  userId?: string | null;
  projectId?: string | null;
  /** Explicit model for this run; overrides DAMI_DEFAULT_MODEL and the dami default. */
  model?: string;
  /** `output_config.effort` for this run; overrides the dami's `effort`. */
  effort?: DamiEffort;
  /** `max_tokens` for this run; overrides the dami's `maxOutputTokens`. */
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export type DamiRuntimeConfig = {
  apiKey: string | undefined;
  /** Workspace to bill when the key is not scoped to one (`ANTHROPIC_WORKSPACE_ID`). */
  workspaceId?: string;
  defaultModel: string | undefined;
  maxConcurrency: number;
  maxRetries: number;
  /** `sample` answers with generated output when no client is injected (see `getDamiMode`). */
  mode: DamiMode;
  /** Artificial latency of one sample-mode call. */
  sampleDelayMs: number;
};

/** Injection points. Production code passes nothing; tests pass fakes. */
export type DamiRunnerDeps = {
  client?: ClaudeClient;
  store?: DamiRunStore;
  limiter?: Semaphore;
  /** Values given here are used instead of the environment. */
  config?: Partial<DamiRuntimeConfig>;
  /** Waits between retries. `signal` aborts the wait (the runner also stops waiting on its own). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  backoff?: { baseDelayMs: number; maxDelayMs: number };
  /** Loads prompt images (live mode only). Default: object storage, downscaled with sharp. */
  resolveImage?: ImageResolver;
};

export type DamiRunResult<R> = {
  runId: string;
  output: R;
  model: string;
  /** API attempts, including transient retries and the corrective retry. */
  attempts: number;
  usage: TokenUsage;
  costUsd: number | null;
};

const MAX_REPORTED_ISSUES = 20;

function resolveConfig(deps: DamiRunnerDeps): DamiRuntimeConfig {
  const given = deps.config ?? {};
  const complete =
    "apiKey" in given &&
    "defaultModel" in given &&
    given.maxConcurrency !== undefined &&
    given.maxRetries !== undefined;
  const env = complete ? undefined : getEnv();
  const apiKey = "apiKey" in given ? given.apiKey : env?.ANTHROPIC_API_KEY;
  return {
    apiKey,
    workspaceId: "workspaceId" in given ? given.workspaceId : env?.ANTHROPIC_WORKSPACE_ID,
    defaultModel: "defaultModel" in given ? given.defaultModel : env?.DAMI_DEFAULT_MODEL,
    maxConcurrency: given.maxConcurrency ?? env?.DAMI_MAX_CONCURRENCY ?? 4,
    maxRetries: given.maxRetries ?? env?.DAMI_MAX_RETRIES ?? 4,
    mode: given.mode ?? resolveDamiMode(env?.DAMI_MODE ?? "auto", apiKey),
    sampleDelayMs: given.sampleDelayMs ?? env?.DAMI_SAMPLE_DELAY_MS ?? 0,
  };
}

function usageOf(response: ClaudeResponse): TokenUsage {
  const u = response.usage;
  return {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
}

function formatIssues(issues: z.core.$ZodIssue[]): string[] {
  return issues
    .slice(0, MAX_REPORTED_ISSUES)
    .map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);
}

type Validation<T> = { ok: true; value: T } | { ok: false; issues: string[] };

function validateOutput<I extends z.ZodType, O extends z.ZodType, R>(
  dami: DamiDefinition<I, O, R>,
  text: string,
  input: z.output<I>,
): Validation<z.output<O>> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      issues: [`The response is not valid JSON: ${error instanceof Error ? error.message : ""}`],
    };
  }
  const parsed = dami.output.safeParse(json);
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error.issues) };
  const semantic = dami.check(parsed.data, input).slice(0, MAX_REPORTED_ISSUES);
  if (semantic.length > 0) return { ok: false, issues: semantic };
  return { ok: true, value: parsed.data };
}

function correctionMessage(issues: string[]): string {
  return [
    "Your previous response did not pass validation:",
    ...issues.map((i) => `- ${i}`),
    "",
    "Return the complete corrected JSON object, not a diff. Fix exactly what these errors require and keep everything else as it was.",
  ].join("\n");
}

/** True when the run was stopped through its signal, however the failure surfaced. */
function isAbort(error: unknown, signal: AbortSignal | undefined): boolean {
  return (
    signal?.aborted === true ||
    error instanceof APIUserAbortError ||
    (error instanceof Error && error.name === "AbortError")
  );
}

/** Waits `ms`, but stops waiting (and rejects with the signal's reason) when `signal` aborts. */
async function abortableWait(
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>,
  ms: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  if (!signal) return sleep(ms);
  signal.throwIfAborted();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    await Promise.race([
      sleep(ms, controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? ` (cause: ${error.cause.message})` : "";
    return `${error.name}: ${error.message}${cause}`;
  }
  return String(error);
}

/**
 * Runs a dami: validates input, records a `dami_run`, calls Claude with schema-constrained output,
 * validates (with one corrective retry), and records the outcome, tokens and cost.
 * Throws a `DamiError` subclass on failure.
 */
export async function runDami<I extends z.ZodType, O extends z.ZodType, R>(
  dami: DamiDefinition<I, O, R>,
  input: z.input<I>,
  ctx: DamiRunContext = {},
  deps: DamiRunnerDeps = {},
): Promise<DamiRunResult<R>> {
  const parsedInput = dami.input.safeParse(input);
  if (!parsedInput.success) {
    throw new DamiInputError(dami.key, formatIssues(parsedInput.error.issues));
  }
  const validInput: z.output<I> = parsedInput.data;

  const config = resolveConfig(deps);
  // Sample mode applies only when no client is injected (tests inject fakes and keep real models).
  const sample = !deps.client && config.mode === "sample";
  const model = sample
    ? SAMPLE_MODEL
    : resolveModel(dami.model ?? "", config.defaultModel, ctx.model);
  if (!model) throw new DamiConfigError(dami.key, `Dami "${dami.key}" has no model configured`);
  const baseClient =
    deps.client ??
    (sample
      ? createSampleClaudeClient({ delayMs: config.sampleDelayMs })
      : getDefaultClaudeClient(config.apiKey, config.workspaceId));
  // Fault injection (dev/QA only); the client itself when FAULT_INJECT has no claude rule.
  const client = baseClient && withClaudeFaults(baseClient);
  if (!client) {
    throw new DamiConfigError(
      dami.key,
      "ANTHROPIC_API_KEY is not set: damis cannot call Claude. Add it to the environment (see .env.example).",
    );
  }
  const limiter = deps.limiter ?? getProcessClaudeLimiter(config.maxConcurrency);
  const store = deps.store ?? createDrizzleDamiRunStore();
  const sleep = deps.sleep ?? defaultSleep;
  const backoff = { ...DEFAULT_BACKOFF, ...deps.backoff, random: deps.random ?? Math.random };

  const maxTokens = ctx.maxOutputTokens ?? dami.maxOutputTokens;
  if (!Number.isInteger(maxTokens) || maxTokens < 1) {
    throw new DamiConfigError(
      dami.key,
      `Dami "${dami.key}": maxOutputTokens must be a positive integer`,
    );
  }
  const prompt = dami.build(validInput);
  const streaming = dami.streaming || maxTokens > STREAMING_THRESHOLD_TOKENS;
  const callOptions = { signal: ctx.signal, dami: { key: dami.key, input: validInput } };

  const runId = await store.start({
    damiKey: dami.key,
    damiVersion: dami.version,
    model,
    userId: ctx.userId ?? null,
    projectId: ctx.projectId ?? null,
    input: validInput,
  });

  if (sample) warnSampleModeInProduction();

  let attempts = 0;
  let usage: TokenUsage | null = null;

  const call = async (req: ClaudeRequest): Promise<ClaudeResponse> => {
    for (let retry = 0; ; retry++) {
      if (ctx.signal?.aborted) throw new DamiAbortedError(dami.key, { cause: ctx.signal.reason });
      attempts++;
      try {
        const response = await limiter.run(
          () =>
            streaming
              ? client.streamMessage(req, callOptions)
              : client.createMessage(req, callOptions),
          ctx.signal,
        );
        usage = addUsage(usage ?? ZERO_USAGE, usageOf(response));
        return response;
      } catch (error) {
        if (isAbort(error, ctx.signal)) throw new DamiAbortedError(dami.key, { cause: error });
        const transient = isTransientError(error);
        if (transient && retry < config.maxRetries) {
          try {
            await abortableWait(sleep, backoffDelayMs(retry + 1, error, backoff), ctx.signal);
          } catch (waitError) {
            if (isAbort(waitError, ctx.signal)) {
              throw new DamiAbortedError(dami.key, { cause: waitError });
            }
            throw waitError;
          }
          continue;
        }
        throw new DamiApiError(
          dami.key,
          transient
            ? `Claude call failed after ${retry + 1} attempts: ${describeError(error)}`
            : `Claude call failed: ${describeError(error)}`,
          { cause: error, transient, status: errorStatus(error) },
        );
      }
    }
  };

  try {
    // Sample mode never reads storage: images become text stand-ins. Loaded after the run row
    // exists so a failure here is recorded on it.
    let images: Map<string, ResolvedImage> | undefined;
    if (!sample) {
      try {
        images = await resolvePromptImages(
          prompt,
          deps.resolveImage ?? storageImageResolver,
          ctx.signal,
        );
      } catch (error) {
        if (isAbort(error, ctx.signal)) throw new DamiAbortedError(dami.key, { cause: error });
        if (isUnusableImageError(error)) {
          throw new DamiInputError(dami.key, [
            `An image could not be used: ${describeError(error)}`,
          ]);
        }
        // Storage or network trouble: the job may be retried later.
        throw new DamiApiError(dami.key, `An image could not be loaded: ${describeError(error)}`, {
          cause: error,
          transient: true,
          status: null,
        });
      }
    }
    const request = buildClaudeRequest(prompt, {
      model,
      maxTokens,
      effort: ctx.effort ?? dami.effort,
      outputSchema: dami.output,
      images,
    });
    const messages: MessageParam[] = [...request.messages];
    let correctionsLeft = 1;
    for (;;) {
      const response = await call({ ...request, messages });
      if (response.stop_reason === "refusal") {
        throw new DamiRefusalError(
          dami.key,
          response.stop_details?.category ?? null,
          response.stop_details?.explanation ?? null,
        );
      }
      if (response.stop_reason === "max_tokens") {
        throw new DamiTruncatedError(dami.key, maxTokens);
      }
      const result = validateOutput(dami, responseText(response.content), validInput);
      if (result.ok) {
        let output: R;
        try {
          output = dami.finalize(result.value, validInput);
        } catch (error) {
          throw new DamiOutputError(dami.key, [`finalize failed: ${describeError(error)}`]);
        }
        const finalUsage: TokenUsage = usage ?? ZERO_USAGE;
        const costUsd = computeCostUsd(model, finalUsage);
        // Bookkeeping must never discard a paid, valid output (a retry would pay again).
        try {
          await store.finish(runId, { status: "succeeded", output, attempts, usage, costUsd });
        } catch (storeError) {
          logLine("error", "could not record a dami run's result", {
            dami: dami.key,
            runId,
            outcome: "succeeded",
            exception: storeError,
            alert: true,
          });
        }
        return { runId, output, model, attempts, usage: finalUsage, costUsd };
      }
      if (correctionsLeft === 0) throw new DamiOutputError(dami.key, result.issues);
      correctionsLeft--;
      messages.push(
        { role: "assistant", content: replayAssistantContent(response.content) },
        { role: "user", content: correctionMessage(result.issues) },
      );
    }
  } catch (error) {
    const typed =
      error instanceof DamiError
        ? error
        : new DamiApiError(dami.key, describeError(error), {
            cause: error,
            transient: false,
            status: null,
          });
    typed.runId = runId;
    const finalUsage: TokenUsage | null = usage;
    try {
      await store.finish(runId, {
        status: typed instanceof DamiAbortedError ? "aborted" : "failed",
        error: describeError(typed),
        attempts,
        usage: finalUsage,
        costUsd: finalUsage ? computeCostUsd(model, finalUsage) : null,
      });
    } catch (storeError) {
      logLine("error", "could not record a dami run's result", {
        dami: dami.key,
        runId,
        outcome: typed instanceof DamiAbortedError ? "aborted" : "failed",
        exception: storeError,
        alert: true,
      });
    }
    throw typed;
  }
}
