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
