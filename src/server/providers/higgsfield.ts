/**
 * Higgsfield (images and video). Not wired yet: every call throws `ProviderNotConfiguredError`.
 * When it is built: credentials from env, `create` sends the request (with an idempotency key if
 * the API offers one), `getStatus` maps Higgsfield's states (return `retryAfterMs` when it says),
 * and `fetchResult` downloads the output. Keep no per-job state in memory.
 */
import { ProviderNotConfiguredError } from "./errors";
import type { GenerationProvider, ProviderJobStatus, ProviderResult } from "./types";

export const HIGGSFIELD_PROVIDER_ID = "higgsfield";

export class HiggsfieldProvider implements GenerationProvider {
  readonly id = HIGGSFIELD_PROVIDER_ID;

  async price(): Promise<number> {
    throw new ProviderNotConfiguredError(this.id);
  }

  async create(): Promise<{ providerJobId: string }> {
    throw new ProviderNotConfiguredError(this.id);
  }

  async getStatus(): Promise<ProviderJobStatus> {
    throw new ProviderNotConfiguredError(this.id);
  }

  async fetchResult(): Promise<ProviderResult> {
    throw new ProviderNotConfiguredError(this.id);
  }
}
