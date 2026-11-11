/**
 * The sample provider: no network, no cost. Jobs finish after `GENERATION_SAMPLE_DELAY_MS` and
 * produce a deterministic placeholder PNG. All job state is in the job id (see `job-id.ts`).
 *
 * Test switches in the prompt: `[[fail]]` fails for good; `[[flaky]]` reports one transient
 * (retryable) failure right after it is ready, then succeeds when asked again a moment later.
 */
import { createHash } from "node:crypto";
import type { GenerationPurpose } from "@/server/db/schema";
import { getEnv } from "@/server/env";
import { ProviderError } from "../errors";
import type {
  GenerationProvider,
  GenerationRequest,
  ProviderJobStatus,
  ProviderResult,
} from "../types";
import {
  decodeSampleJobId,
  encodeSampleJobId,
  MAX_LABEL_LENGTH,
  type SampleJob,
  type SampleOutcome,
} from "./job-id";
import { renderSampleImage } from "./render";

export const SAMPLE_PROVIDER_ID = "sample";

/** Made-up prices in credits. */
export const SAMPLE_PRICES: Readonly<Record<GenerationPurpose, number>> = {
  asset_look: 4,
  asset_sheet: 6,
  block_draft: 20,
  block_final: 60,
};

/** How long a `[[flaky]]` job keeps reporting its transient failure after it is ready. */
export const FLAKY_WINDOW_MS = 1_000;

/** JSON with sorted object keys, so equal values always hash the same (jsonb reorders keys). */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A short digest of everything that defines the request (references by content). */
export function requestDigest(request: GenerationRequest): string {
  const hash = createHash("sha256");
  hash.update(
    stableJson({
      kind: request.kind,
      purpose: request.purpose,
      model: request.model,
      prompt: request.prompt,
      params: request.params,
      label: request.label ?? null,
      references: request.references.map((r) => ({
        name: r.name,
        mimeType: r.mimeType,
        sha256: createHash("sha256").update(r.bytes).digest("hex"),
      })),
    }),
  );
  return hash.digest("hex").slice(0, 16);
}

function outcomeOf(prompt: string): SampleOutcome {
  if (prompt.includes("[[fail]]")) return "fail";
  if (prompt.includes("[[flaky]]")) return "flaky";
  return "ok";
}

function labelOf(request: GenerationRequest): string {
  const raw = (request.label ?? request.prompt.replace(/\[\[\w+\]\]/g, "")).trim();
  const text = raw.replace(/\s+/g, " ") || "Untitled";
  return text.length > MAX_LABEL_LENGTH ? `${text.slice(0, MAX_LABEL_LENGTH - 1)}…` : text;
}

export class SampleProvider implements GenerationProvider {
  readonly id = SAMPLE_PROVIDER_ID;

  constructor(
    private readonly clock: { now: () => number } = Date,
    private readonly delayMs: () => number = () => getEnv().GENERATION_SAMPLE_DELAY_MS,
  ) {}

  async price(request: Omit<GenerationRequest, "references">): Promise<number> {
    const price = SAMPLE_PRICES[request.purpose];
    if (price === undefined)
      throw new ProviderError("This kind of generation has no price.", false);
    return price;
  }

  async create(request: GenerationRequest): Promise<{ providerJobId: string }> {
    if (request.kind !== "image") {
      throw new ProviderError("Sample video is not available yet.", false);
    }
    const created = this.clock.now();
    const job: SampleJob = {
      v: 1,
      c: created,
      r: created + this.delayMs(),
      o: outcomeOf(request.prompt),
      k: request.kind,
      p: request.purpose,
      a: request.params.aspectRatio === "9:16" ? "9:16" : "16:9",
      l: labelOf(request),
      d: requestDigest(request),
    };
    return { providerJobId: encodeSampleJobId(job) };
  }

  async getStatus(providerJobId: string): Promise<ProviderJobStatus> {
    const job = this.decode(providerJobId);
    const now = this.clock.now();
    if (now < job.r) return { state: "running", retryAfterMs: job.r - now };
    if (job.o === "fail") {
      return {
        state: "failed",
        reason: "The sample provider was asked to fail this request ([[fail]] in the prompt).",
        retryable: false,
      };
    }
    if (job.o === "flaky" && now < job.r + FLAKY_WINDOW_MS) {
      return {
        state: "failed",
        reason: "The sample provider had a temporary problem ([[flaky]] in the prompt).",
        retryable: true,
      };
    }
    return { state: "succeeded" };
  }

  async fetchResult(providerJobId: string): Promise<ProviderResult> {
    const status = await this.getStatus(providerJobId);
    if (status.state !== "succeeded") {
      throw new ProviderError("The sample result is not ready.", status.state === "running");
    }
    const job = this.decode(providerJobId);
    const bytes = await renderSampleImage({
      purpose: job.p,
      label: job.l,
      aspectRatio: job.a,
      digest: job.d,
    });
    return { bytes, mimeType: "image/png" };
  }

  private decode(providerJobId: string): SampleJob {
    const job = decodeSampleJobId(providerJobId);
    if (!job) throw new ProviderError("The sample job id is not valid.", false);
    return job;
  }
}
