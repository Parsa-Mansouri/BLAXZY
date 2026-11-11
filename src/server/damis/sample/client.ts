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
import { samplePromptSectioner } from "./prompt-sectioner";
import { sampleScriptChecker } from "./script-checker";
import { sampleScriptReviser } from "./script-reviser";
import { sampleScriptWriter } from "./script-writer";

/** Sample output by dami key. Each generator validates the input with the dami's schema. */
export const SAMPLE_GENERATORS: Readonly<Record<string, (input: unknown) => unknown>> = {
  "script-writer": sampleScriptWriter,
  "script-checker": sampleScriptChecker,
  "script-reviser": sampleScriptReviser,
  "asset-detector": sampleAssetDetector,
  "prompt-sectioner": samplePromptSectioner,
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
