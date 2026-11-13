/**
 * Typed errors thrown by `runDami`. Every error carries the dami key and, once a `dami_run` row
 * exists, its id, so callers can link the failure to the stored run.
 */
export type DamiErrorCode =
  "invalid_input" | "config" | "api" | "invalid_output" | "refusal" | "truncated" | "aborted";

export class DamiError extends Error {
  readonly code: DamiErrorCode;
  readonly damiKey: string;
  /** The `dami_run` row id, or null when the run failed before a row was written. */
  runId: string | null;

  constructor(
    code: DamiErrorCode,
    damiKey: string,
    message: string,
    options?: { cause?: unknown; runId?: string | null },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.damiKey = damiKey;
    this.runId = options?.runId ?? null;
  }
}

/** The input did not match the dami's input schema. No row is written. */
export class DamiInputError extends DamiError {
  readonly issues: string[];
  constructor(damiKey: string, issues: string[]) {
    super(
      "invalid_input",
      damiKey,
      `Invalid input for dami "${damiKey}":\n- ${issues.join("\n- ")}`,
    );
    this.issues = issues;
  }
}

/** Missing or invalid configuration (for example no ANTHROPIC_API_KEY). No row is written. */
export class DamiConfigError extends DamiError {
  constructor(damiKey: string, message: string) {
    super("config", damiKey, message);
  }
}

/** The Claude API call failed: a non-transient error, or transient errors past the retry budget. */
export class DamiApiError extends DamiError {
  readonly transient: boolean;
  readonly status: number | null;
  constructor(
    damiKey: string,
    message: string,
    options: { cause: unknown; transient: boolean; status: number | null },
  ) {
    super("api", damiKey, message, { cause: options.cause });
    this.transient = options.transient;
    this.status = options.status;
  }
}

/** The model's output failed validation, including after the one corrective retry. */
export class DamiOutputError extends DamiError {
  readonly issues: string[];
  constructor(damiKey: string, issues: string[]) {
    super(
      "invalid_output",
      damiKey,
      `Dami "${damiKey}" returned invalid output after a corrective retry:\n- ${issues.join("\n- ")}`,
    );
    this.issues = issues;
  }
}

/** The model declined the request (`stop_reason: "refusal"`). Not retried. */
export class DamiRefusalError extends DamiError {
  readonly category: string | null;
  constructor(damiKey: string, category: string | null, explanation: string | null) {
    super(
      "refusal",
      damiKey,
      `Dami "${damiKey}" was declined by the model` +
        (category ? ` (category: ${category})` : "") +
        (explanation ? `: ${explanation}` : "."),
    );
    this.category = category;
  }
}

/** The output hit `max_tokens` and is incomplete. Not retried: the same budget would cut it again. */
export class DamiTruncatedError extends DamiError {
  constructor(damiKey: string, maxTokens: number) {
    super(
      "truncated",
      damiKey,
      `Dami "${damiKey}" output was cut off at max_tokens (${maxTokens}). Raise maxOutputTokens or reduce the input size.`,
    );
  }
}

/**
 * The run was stopped through `DamiRunContext.signal` (a stopping worker, a cancelled job). Never
 * retried; the run is stored as `aborted`, not `failed`. Handlers decide what to do via their own
 * signal: this only says the dami did not finish.
 */
export class DamiAbortedError extends DamiError {
  constructor(damiKey: string, options?: { cause?: unknown }) {
    super("aborted", damiKey, `Dami "${damiKey}" was aborted before it finished.`, options);
  }
}
