import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/messages";

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
export function createAnthropicClaudeClient(apiKey: string): ClaudeClient {
  const sdk = new Anthropic({ apiKey, maxRetries: 0, timeout: REQUEST_TIMEOUT_MS });
  return {
    createMessage: (request, options) => sdk.messages.create(request, { signal: options?.signal }),
    streamMessage: async (request, options) =>
      sdk.messages.stream(request, { signal: options?.signal }).finalMessage(),
  };
}

let defaultClient: { apiKey: string; client: ClaudeClient } | undefined;

/** Lazily created process-wide client; null when no API key is configured. */
export function getDefaultClaudeClient(apiKey: string | undefined): ClaudeClient | null {
  if (!apiKey) return null;
  if (defaultClient?.apiKey !== apiKey) {
    defaultClient = { apiKey, client: createAnthropicClaudeClient(apiKey) };
  }
  return defaultClient.client;
}
