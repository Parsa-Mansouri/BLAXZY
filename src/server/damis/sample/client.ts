/**
 * The sample-mode Claude client: answers each dami with output generated from its actual input
 * (one small generator per dami in this folder), after a short artificial delay. The runner uses
 * it when `getDamiMode()` is `sample`; runs are stored with model `sample` and no cost.
 */
import type {
  ClaudeCallOptions,
  ClaudeClient,
  ClaudeRequest,
  ClaudeResponse,
} from "../framework/client";
import { SAMPLE_MODEL } from "../framework/mode";
import { sampleAssetDetector } from "./asset-detector";
import { sampleCharacterGenerator } from "./character-generator";
import { sampleCreativeDna } from "./creative-dna";
import { sampleBlockRevision } from "./block-revision";
import { sampleCinematographer } from "./cinematographer";
import { sampleDirector } from "./director";
import { sampleFilmDirector, sampleFilmDirectorCard } from "./film-director";
import { sampleLocationGenerator } from "./location-generator";
import { samplePropGenerator } from "./prop-generator";
import { sampleSheetGeneratorCharacter } from "./sheet-generator-character";
import { sampleSheetGeneratorLocation } from "./sheet-generator-location";
import { sampleSheetGeneratorProp } from "./sheet-generator-prop";
import { sampleProjectNamer } from "./project-namer";
import { sampleScriptChecker } from "./script-checker";
import { sampleScriptReviser } from "./script-reviser";
import { sampleEnhancer } from "./enhancer";
import { sampleVideoReview } from "./video-review";
import { sampleScriptOutline, sampleScriptWriter } from "./script-writer";

/** Sample output by dami key. Each generator validates the input with the dami's schema. */
export const SAMPLE_GENERATORS: Readonly<Record<string, (input: unknown) => unknown>> = {
  "creative-dna": sampleCreativeDna,
  "project-namer": sampleProjectNamer,
  "script-writer": sampleScriptWriter,
  "script-writer-outline": sampleScriptOutline,
  enhancer: sampleEnhancer,
  "script-checker": sampleScriptChecker,
  "script-reviser": sampleScriptReviser,
  "asset-detector": sampleAssetDetector,
  "character-generator": sampleCharacterGenerator,
  "location-generator": sampleLocationGenerator,
  "prop-generator": samplePropGenerator,
  "sheet-generator-character": sampleSheetGeneratorCharacter,
  "sheet-generator-location": sampleSheetGeneratorLocation,
  "sheet-generator-prop": sampleSheetGeneratorProp,
  director: sampleDirector,
  "director-plan": sampleDirector,
  "block-revision": sampleBlockRevision,
  "video-review": sampleVideoReview,
  "film-director": sampleFilmDirector,
  "film-director-card": sampleFilmDirectorCard,
  cinematographer: sampleCinematographer,
};

function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function sampleResponse(text: string): ClaudeResponse {
  return {
    id: "msg_sample",
    type: "message",
    role: "assistant",
    model: SAMPLE_MODEL,
    container: null,
    diagnostics: null,
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_creation: null,
      inference_geo: null,
      output_tokens_details: null,
      server_tool_use: null,
      service_tier: "standard",
      speed: null,
    },
  };
}

export function createSampleClaudeClient(options: { delayMs: number }): ClaudeClient {
  const answer = async (
    _request: ClaudeRequest,
    call: ClaudeCallOptions | undefined,
  ): Promise<ClaudeResponse> => {
    const key = call?.dami?.key;
    const generate = key ? SAMPLE_GENERATORS[key] : undefined;
    if (!generate) {
      throw new Error(
        `Sample mode has no generator for dami "${key ?? "(unknown)"}". Set DAMI_MODE=live with an API key.`,
      );
    }
    await wait(options.delayMs, call?.signal);
    return sampleResponse(JSON.stringify(generate(call?.dami?.input)));
  };
  return { createMessage: answer, streamMessage: answer };
}
