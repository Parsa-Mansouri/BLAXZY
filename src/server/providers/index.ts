/**
 * The provider layer: the only module that knows which generation backend is active. Everything
 * else asks `getProvider()` and `pickModel()` and stores what they returned.
 */
import { getEnv } from "@/server/env";
import { faultsEnabled } from "@/server/faults";
import { HiggsfieldProvider } from "./higgsfield";
import { withProviderFaults } from "./faults";
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

type ProviderId = typeof SAMPLE_PROVIDER_ID | "higgsfield";

function isProviderId(id: string): id is ProviderId {
  return id === SAMPLE_PROVIDER_ID || id === "higgsfield";
}

let sampleWarned = false;

/** One loud structured warning per process when the sample provider is used in production. */
function warnSampleProviderInProduction(): void {
  if (sampleWarned || process.env.NODE_ENV !== "production") return;
  sampleWarned = true;
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "sample_mode_in_production",
      component: "providers",
      message:
        "The SAMPLE generation provider is active in a production process: clips and images are placeholders. Set GENERATION_PROVIDER=higgsfield to generate for real.",
    }),
  );
}

function create(id: ProviderId): GenerationProvider {
  switch (id) {
    case "higgsfield":
      return new HiggsfieldProvider();
    case SAMPLE_PROVIDER_ID:
      warnSampleProviderInProduction();
      return new SampleProvider();
    default: {
      const unknown: never = id;
      throw new Error(`Unknown generation provider "${String(unknown)}"`);
    }
  }
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
    if (!isProviderId(key)) throw new Error(`Unknown generation provider "${key}"`);
    provider = withProviderFaults(create(key), faultsEnabled("provider"));
    providers.set(key, provider);
  }
  return provider;
}

/** Output of this provider is a placeholder (the UI shows a "sample" note). */
export function isSampleProvider(providerId: string): boolean {
  return providerId === SAMPLE_PROVIDER_ID;
}
