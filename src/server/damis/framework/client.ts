import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages";
import { faultsEnabled, maybeFault } from "@/server/faults";
import { claudeFaultError } from "@/server/faults/errors";

export type ClaudeRequest = MessageCreateParamsNonStreaming;
export type ClaudeResponse = Message;

export type ClaudeCallOptions = {
  signal?: AbortSignal;
  /**
   * The dami behind the call and its validated input. The Claude API client ignores it; the
   * sample client (sample mode) uses it to answer without parsing the prompt.
   */
  dami?: { key: string; input: unknown };
};

/**
 * The narrow surface the runner needs from Claude. The default implementation wraps the
 * official SDK; tests inject a fake. Nothing else in the codebase talks to the Claude API.
 */
export interface ClaudeClient {
  /** One non-streaming Messages API call. */
  createMessage(request: ClaudeRequest, options?: ClaudeCallOptions): Promise<ClaudeResponse>;
  /** One streaming Messages API call, resolved to the final accumulated message. */
  streamMessage(request: ClaudeRequest, options?: ClaudeCallOptions): Promise<ClaudeResponse>;
}

/** Streaming generations of a long script can run for many minutes. */
const REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

/** Wraps the official SDK. SDK retries are disabled: the runner owns retries and counts attempts. */
export function createAnthropicClaudeClient(apiKey: string, workspaceId?: string): ClaudeClient {
  const sdk = new Anthropic({
    apiKey,
    maxRetries: 0,
    timeout: REQUEST_TIMEOUT_MS,
    // A key that is not scoped to a workspace must name the workspace on every request.
    defaultHeaders: workspaceId ? { "anthropic-workspace-id": workspaceId } : undefined,
  });
  return {
    createMessage: (request, options) => sdk.messages.create(request, { signal: options?.signal }),
    streamMessage: async (request, options) =>
      sdk.messages.stream(request, { signal: options?.signal }).finalMessage(),
  };
}

let defaultClient: { apiKey: string; workspaceId?: string; client: ClaudeClient } | undefined;

/** Lazily created process-wide client; null when no API key is configured. */
export function getDefaultClaudeClient(
  apiKey: string | undefined,
  workspaceId?: string,
): ClaudeClient | null {
  if (!apiKey) return null;
  if (defaultClient?.apiKey !== apiKey || defaultClient.workspaceId !== workspaceId) {
    defaultClient = {
      apiKey,
      workspaceId,
      client: createAnthropicClaudeClient(apiKey, workspaceId),
    };
  }
  return defaultClient.client;
}

/** Output that fails JSON parsing, so the runner takes its corrective-retry path. */
const MALFORMED_TEXT = "Injected fault: this is not valid JSON {";

/**
 * Fault injection (FAULT_INJECT=claude:..., development and QA only): throws the SDK's own
 * errors before the call, or replaces a real answer with malformed output. Returns `client`
 * untouched when no claude rule is configured.
 */
export function withClaudeFaults(client: ClaudeClient): ClaudeClient {
  if (!faultsEnabled("claude")) return client;
  const run = async (call: () => Promise<ClaudeResponse>): Promise<ClaudeResponse> => {
    const fault = maybeFault("claude");
    if (fault === null) return call();
    if (fault !== "malformed") throw claudeFaultError(fault);
    const response = await call();
    return {
      ...response,
      stop_reason: "end_turn",
      content: [{ type: "text", text: MALFORMED_TEXT, citations: null }],
    } as ClaudeResponse;
  };
  return {
    createMessage: (request, options) => run(() => client.createMessage(request, options)),
    streamMessage: (request, options) => run(() => client.streamMessage(request, options)),
  };
}
