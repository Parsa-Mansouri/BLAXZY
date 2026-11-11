/**
 * A provider call failed. `message` is safe to show to the user; `retryable` says whether trying
 * the same call again later can succeed (rate limit, timeout, provider outage).
 */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ProviderError";
  }
}

/** The selected provider cannot be used on this server (missing credentials or not built yet). */
export class ProviderNotConfiguredError extends ProviderError {
  constructor(readonly providerId: string) {
    super(
      `Image and video generation (${providerId}) is not configured on this server. Contact support.`,
      false,
    );
    this.name = "ProviderNotConfiguredError";
  }
}
