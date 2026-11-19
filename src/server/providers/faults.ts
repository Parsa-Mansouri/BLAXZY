/**
 * Fault injection for providers (`FAULT_INJECT=provider:...`, development and QA only): wraps any
 * provider and fails its calls the way a real backend would, so the generation engine's retry and
 * classification code runs.
 *
 * - `create`: `5xx`, `429`, `timeout` throw a retryable `ProviderError`; `fatal` a non-retryable
 *   one; `lost` does not apply.
 * - `getStatus`: the same throws, except `429` answers `running` with `retryAfterMs` and `lost`
 *   answers `failed` (not retryable): the provider no longer knows the job.
 * - `fetchResult`: throws like `create`; `lost` throws a non-retryable "job not found".
 */
import { maybeFault } from "@/server/faults";
import { providerFaultError } from "@/server/faults/errors";
import { ProviderError } from "./errors";
import type {
  CreateOptions,
  GenerationProvider,
  GenerationRequest,
  ProviderJobStatus,
  ProviderResult,
} from "./types";

export const FAULT_RETRY_AFTER_MS = 2_000;

class FaultyProvider implements GenerationProvider {
  constructor(private readonly inner: GenerationProvider) {}

  get id(): string {
    return this.inner.id;
  }

  price(request: Omit<GenerationRequest, "references">): Promise<number> {
    return this.inner.price(request);
  }

  async create(
    request: GenerationRequest,
    options: CreateOptions,
  ): Promise<{ providerJobId: string }> {
    const fault = maybeFault("provider");
    if (fault && fault !== "lost") throw providerFaultError(fault);
    return this.inner.create(request, options);
  }

  async getStatus(
    providerJobId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ProviderJobStatus> {
    const fault = maybeFault("provider");
    if (fault === "429") return { state: "running", retryAfterMs: FAULT_RETRY_AFTER_MS };
    if (fault === "lost") {
      return {
        state: "failed",
        reason: "Injected fault: the provider no longer knows this job",
        retryable: false,
      };
    }
    if (fault) throw providerFaultError(fault);
    return this.inner.getStatus(providerJobId, options);
  }

  async fetchResult(
    providerJobId: string,
    options?: { signal?: AbortSignal },
  ): Promise<ProviderResult> {
    const fault = maybeFault("provider");
    if (fault === "lost") {
      throw new ProviderError("Injected fault: the provider job was not found", false);
    }
    if (fault) throw providerFaultError(fault);
    return this.inner.fetchResult(providerJobId, options);
  }
}

/** The provider itself when no provider rule is configured. */
export function withProviderFaults(
  provider: GenerationProvider,
  enabled: boolean,
): GenerationProvider {
  return enabled ? new FaultyProvider(provider) : provider;
}
