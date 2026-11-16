/** Input the user (or the calling service) can fix. `message` is safe to show. */
export class GenerationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationInputError";
  }
}

/** A failure while running a generation. `message` is safe to show. */
export class GenerationRunError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GenerationRunError";
  }
}

export const PRICE_CHANGED_MESSAGE = "The price changed. Check the new total, then confirm again.";

/**
 * The price the user confirmed is not the current one (or nothing was confirmed): nothing was
 * created. The screen shows the new quote and asks again. `code` identifies it (see
 * `isPriceChanged`); `message` is safe to show.
 */
export class PriceChangedError extends GenerationInputError {
  readonly code = "price_changed" as const;
  constructor(message: string = PRICE_CHANGED_MESSAGE) {
    super(message);
    this.name = "PriceChangedError";
  }
}

/** Whether `error` is a "the price changed" refusal (this module's or Production's own class). */
export function isPriceChanged(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === "price_changed";
}
