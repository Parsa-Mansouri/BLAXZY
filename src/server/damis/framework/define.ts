import type { z } from "zod";

/**
 * One piece of prompt text. `cache: true` puts a prompt-cache breakpoint after it: everything
 * up to and including this block is cached and reused by later requests with the same prefix.
 */
export type PromptText = { text: string; cache?: boolean };

/**
 * An image from object storage, by file id only (so `dami_run.input` stays small). In live mode the
 * runner loads, downscales and base64-encodes it before the request is built; sample mode never
 * reads it. `cache: true` puts a prompt-cache breakpoint after it, like `PromptText`.
 */
export type PromptImage = { image: { fileId: string }; cache?: boolean };

/** One block of a message: text or an image. */
export type PromptPart = PromptText | PromptImage;

export function isPromptImage(part: PromptPart): part is PromptImage {
  return "image" in part;
}

export type DamiMessage = { role: "user" | "assistant"; content: PromptPart[] };

/**
 * What a dami's `build` returns. Order matters for caching: stable text first (the dami's base
 * prompt, then the genre/style modules), per-request content last.
 */
export type DamiPrompt = { system: PromptText[]; messages: DamiMessage[] };

export type DamiEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type DamiConfig<I extends z.ZodType, O extends z.ZodType, R> = {
  /** Stable identifier, also stored in `dami_run.dami_key`. */
  key: string;
  /** Bump on any prompt or schema change; stored in `dami_run.dami_version` and on reviews. */
  version: string;
  description: string;
  input: I;
  /** The schema the model must produce (sent as the structured-output JSON schema). */
  output: O;
  /** Default model; see `resolveModel` for overrides. */
  model?: string;
  /**
   * Model of the corrective retry (the second call, after a failed validation), when it should
   * differ from `model` (e.g. Sonnet first, Opus to fix). Overrides apply as for `model`: an
   * explicit run model or DAMI_DEFAULT_MODEL replaces both. Default: the first call's model.
   */
  retryModel?: string;
  /** `output_config.effort`. Set explicitly: defaults differ per model. */
  effort?: DamiEffort;
  /** `max_tokens`. Thinking tokens count against it, so leave headroom. */
  maxOutputTokens: number;
  /** Stream the call (default: when maxOutputTokens > 16000, to avoid HTTP timeouts). */
  streaming?: boolean;
  build(input: z.output<I>): DamiPrompt;
  /**
   * Semantic checks the JSON schema cannot express (quotes exist in the script, ranges cover a
   * segment, names are unique). Returned messages are treated like schema errors: fed back to the
   * model once, then the run fails.
   */
  check?(output: z.output<O>, input: z.output<I>): string[];
  /** Maps the validated model output to the dami's public result (default: identity). */
  finalize?(output: z.output<O>, input: z.output<I>): R;
};

export type DamiDefinition<I extends z.ZodType, O extends z.ZodType, R> = {
  readonly key: string;
  readonly version: string;
  readonly description: string;
  readonly input: I;
  readonly output: O;
  readonly model: string | undefined;
  readonly retryModel: string | undefined;
  readonly effort: DamiEffort | undefined;
  readonly maxOutputTokens: number;
  readonly streaming: boolean;
  build(input: z.output<I>): DamiPrompt;
  check(output: z.output<O>, input: z.output<I>): string[];
  finalize(output: z.output<O>, input: z.output<I>): R;
};

/** Any dami, for registries and the CLI. */
export type AnyDami = DamiDefinition<z.ZodType, z.ZodType, unknown>;

/** The type callers pass to `runDami` (before schema defaults/transforms). */
export type DamiInput<D> =
  D extends DamiDefinition<infer I, z.ZodType, unknown> ? z.input<I> : never;
/** The dami's public result type. */
export type DamiResult<D> = D extends DamiDefinition<z.ZodType, z.ZodType, infer R> ? R : never;

const KEY_PATTERN = /^[a-z][a-z0-9-]*$/;
/** Calls with a larger `max_tokens` stream by default, to avoid HTTP timeouts. */
export const STREAMING_THRESHOLD_TOKENS = 16_000;

/** A config without `finalize`: the public result is the validated output itself. */
export type DamiConfigIdentity<I extends z.ZodType, O extends z.ZodType> = DamiConfig<
  I,
  O,
  z.output<O>
> & { finalize?: undefined };

/** A config with `finalize`, which alone decides the public result type `R`. */
export type DamiConfigFinalized<I extends z.ZodType, O extends z.ZodType, R> = DamiConfig<
  I,
  O,
  R
> & { finalize: NonNullable<DamiConfig<I, O, R>["finalize"]> };

export function defineDami<I extends z.ZodType, O extends z.ZodType>(
  config: DamiConfigIdentity<I, O>,
): DamiDefinition<I, O, z.output<O>>;
export function defineDami<I extends z.ZodType, O extends z.ZodType, R>(
  config: DamiConfigFinalized<I, O, R>,
): DamiDefinition<I, O, R>;
export function defineDami<I extends z.ZodType, O extends z.ZodType>(
  config: DamiConfig<I, O, unknown>,
): DamiDefinition<I, O, unknown> {
  if (!KEY_PATTERN.test(config.key)) {
    throw new Error(`Invalid dami key "${config.key}": use lower-case words joined by hyphens`);
  }
  if (!Number.isInteger(config.maxOutputTokens) || config.maxOutputTokens < 1) {
    throw new Error(`Dami "${config.key}": maxOutputTokens must be a positive integer`);
  }
  const { check, finalize } = config;
  return {
    key: config.key,
    version: config.version,
    description: config.description,
    input: config.input,
    output: config.output,
    model: config.model,
    retryModel: config.retryModel,
    effort: config.effort,
    maxOutputTokens: config.maxOutputTokens,
    streaming: config.streaming ?? config.maxOutputTokens > STREAMING_THRESHOLD_TOKENS,
    build: (input) => config.build(input),
    check: (output, input) => (check ? check(output, input) : []),
    // Without `finalize` the overloads make the result type z.output<O>: the output is returned as is.
    finalize: (output, input) => (finalize ? finalize(output, input) : output),
  };
}

/** The text of a prompt part ("" for an image or a missing part). */
export function partText(part: PromptPart | undefined): string {
  return part && !isPromptImage(part) ? part.text : "";
}
