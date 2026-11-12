/**
 * The provider layer: the only module that knows which generation backend is active. Everything
 * else asks `getProvider()` and `pickModel()` and stores what they returned.
 */
import { getEnv } from "@/server/env";
import { HiggsfieldProvider } from "./higgsfield";
import { SAMPLE_PROVIDER_ID, SampleProvider } from "./sample/provider";
import type { GenerationProvider } from "./types";

export { ProviderError, ProviderNotConfiguredError } from "./errors";
export {
  ASPECT_RATIOS,
  aspectRatioFor,
  isAspectRatio,
  isVideoAspectRatio,
  MODEL_POLICY,
  pickModel,
  VIDEO_ASPECT_RATIOS,
  type AspectRatio,
  type GenerationOverrides,
  type VideoAspectRatio,
} from "./policy";
export type {
  GenerationProvider,
  GenerationReference,
  GenerationRequest,
  ModelChoice,
  ProviderJobStatus,
  ProviderResult,
} from "./types";

const providers = new Map<string, GenerationProvider>();

function create(id: string): GenerationProvider {
  if (id === "higgsfield") return new HiggsfieldProvider();
  return new SampleProvider();
}

/**
 * The active provider (`GENERATION_PROVIDER`, default `sample`), or the one with `id` (a stored
 * `generation.provider`, so a job finishes on the provider that started it). Providers hold no
 * per-job state, so one instance per process is safe.
 */
export function getProvider(id?: string): GenerationProvider {
  const key = id ?? getEnv().GENERATION_PROVIDER;
  let provider = providers.get(key);
  if (!provider) {
    if (key !== SAMPLE_PROVIDER_ID && key !== "higgsfield") {
      throw new Error(`Unknown generation provider "${key}"`);
    }
    provider = create(key);
    providers.set(key, provider);
  }
  return provider;
}

/** Output of this provider is a placeholder (the UI shows a "sample" note). */
export function isSampleProvider(providerId: string): boolean {
  return providerId === SAMPLE_PROVIDER_ID;
}
