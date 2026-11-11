import type { GenerationKind, GenerationPurpose } from "@/server/db/schema";

/** A reference image (or other file) sent along with a request, in attachment order. */
export type GenerationReference = { bytes: Uint8Array; mimeType: string; name: string };

/** What the platform asks a provider to make. Built from a `generation` row. */
export type GenerationRequest = {
  kind: GenerationKind;
  purpose: GenerationPurpose;
  model: string;
  prompt: string;
  /** aspectRatio, resolution, durationSeconds, ... (from `pickModel`). */
  params: Record<string, unknown>;
  references: GenerationReference[];
  /** Shown on sample output only. */
  label?: string;
};

/**
 * - `running`: not finished yet, ask again later (after `retryAfterMs` when the provider says).
 * - `succeeded`: `fetchResult` returns the output.
 * - `failed`: `retryable` means the same provider job may still be asked again later (a transient
 *   problem on the provider's side); a provider whose job is permanently dead returns `false`.
 */
export type ProviderJobStatus =
  | { state: "running"; retryAfterMs?: number }
  | { state: "succeeded" }
  | { state: "failed"; reason: string; retryable: boolean };

export type ProviderResult = { bytes: Uint8Array; mimeType: string };

/**
 * A generation backend. Implementations keep no per-job state in memory: anything needed later
 * lives in the provider job id or at the provider, so any process can poll any job.
 */
export interface GenerationProvider {
  /** "sample" | "higgsfield" */
  readonly id: string;
  /** The price in credits. Creates nothing. */
  price(request: Omit<GenerationRequest, "references">): Promise<number>;
  create(request: GenerationRequest): Promise<{ providerJobId: string }>;
  getStatus(providerJobId: string): Promise<ProviderJobStatus>;
  fetchResult(providerJobId: string): Promise<ProviderResult>;
}

/** What `pickModel` decides for a purpose: the platform's choice, never the user's. */
export type ModelChoice = {
  kind: GenerationKind;
  model: string;
  params: Record<string, unknown>;
};
