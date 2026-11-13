import type { Readable } from "node:stream";
import type { GenerationKind, GenerationPurpose } from "@/server/db/schema";

/** A reference image (or other file) sent along with a request, in attachment order. */
export type GenerationReference = { bytes: Uint8Array; mimeType: string; name: string };

/** What the platform asks a provider to make. Built from a `generation` row. */
export type GenerationRequest = {
  kind: GenerationKind;
  purpose: GenerationPurpose;
  model: string;
  prompt: string;
  /**
   * From `pickModel`: `aspectRatio` always; for video also `durationSeconds` (1..15),
   * `resolution` ("480p" draft, "1080p" final) and `sound`.
   */
  params: Record<string, unknown>;
  references: GenerationReference[];
  /** Shown on sample output only. */
  label?: string;
  /**
   * `block_final` only: the provider job of the accepted draft, so the provider finishes that
   * exact video in final quality.
   */
  draftProviderJobId?: string;
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

/** An output file: in memory, or a stream of known length (large media). */
export type ProviderFile = { mimeType: string } & (
  { bytes: Uint8Array } | { stream: Readable; sizeBytes: number }
);

/**
 * The output of a finished job. Video may come with a poster (a still of the clip). Call
 * `dispose` once the result has been consumed or abandoned: it releases temporary files and open
 * streams.
 */
export type ProviderResult = ProviderFile & {
  poster?: { bytes: Uint8Array; mimeType: string };
  dispose?: () => Promise<void>;
};

export type CreateOptions = { idempotencyKey: string; signal?: AbortSignal };

/**
 * A generation backend. Implementations keep no per-job state in memory: anything needed later
 * lives in the provider job id or at the provider, so any process can poll any job.
 */
export interface GenerationProvider {
  /** "sample" | "higgsfield" */
  readonly id: string;
  /** The price in credits. Creates nothing. */
  price(request: Omit<GenerationRequest, "references">): Promise<number>;
  /**
   * Starts the job. `idempotencyKey` is the generation id: a provider whose API takes an
   * idempotency key must send it, so a create repeated after a crash (the platform never calls
   * `create` twice at once for one generation) returns the same provider job instead of a new,
   * paid one. `signal` aborts the request.
   */
  create(request: GenerationRequest, options: CreateOptions): Promise<{ providerJobId: string }>;
  getStatus(providerJobId: string, options?: { signal?: AbortSignal }): Promise<ProviderJobStatus>;
  fetchResult(providerJobId: string, options?: { signal?: AbortSignal }): Promise<ProviderResult>;
}

/** What `pickModel` decides for a purpose: the platform's choice, never the user's. */
export type ModelChoice = {
  kind: GenerationKind;
  model: string;
  params: Record<string, unknown>;
};
