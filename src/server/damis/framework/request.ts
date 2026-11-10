import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type {
  ContentBlock,
  ContentBlockParam,
  JSONOutputFormat,
  MessageParam,
  TextBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import type { z } from "zod";
import type { ClaudeRequest } from "./client";
import type { DamiEffort, DamiPrompt, PromptText } from "./define";

/** The API allows at most 4 cache breakpoints per request. */
const MAX_CACHE_BREAKPOINTS = 4;

const jsonSchemaCache = new WeakMap<z.ZodType, JSONOutputFormat>();

/**
 * The structured-output format for a Zod schema. The SDK helper converts the schema to JSON
 * Schema and moves constraints the API does not enforce (minLength, minimum, ...) into
 * descriptions; we validate those ourselves with Zod. Only `type` and `schema` are sent, so the
 * SDK does not auto-parse (and throw) before our corrective retry can run.
 */
export function outputFormatFor(schema: z.ZodType): JSONOutputFormat {
  let format = jsonSchemaCache.get(schema);
  if (!format) {
    const helper = zodOutputFormat(schema);
    format = { type: "json_schema", schema: helper.schema };
    jsonSchemaCache.set(schema, format);
  }
  return format;
}

function textBlock(part: PromptText): TextBlockParam {
  return part.cache
    ? { type: "text", text: part.text, cache_control: { type: "ephemeral" } }
    : { type: "text", text: part.text };
}

export function countBreakpoints(prompt: DamiPrompt): number {
  const all = [...prompt.system, ...prompt.messages.flatMap((m) => m.content)];
  return all.filter((p) => p.cache).length;
}

export type RequestOptions = {
  model: string;
  maxTokens: number;
  effort: DamiEffort | undefined;
  outputSchema: z.ZodType;
};

/**
 * Builds the Messages API request. Thinking is not set: on the 5.5 models adaptive thinking is
 * the default (and disabling it is rejected on Opus 5.5); `effort` is the control.
 */
export function buildClaudeRequest(prompt: DamiPrompt, options: RequestOptions): ClaudeRequest {
  const breakpoints = countBreakpoints(prompt);
  if (breakpoints > MAX_CACHE_BREAKPOINTS) {
    throw new Error(`A prompt may mark at most ${MAX_CACHE_BREAKPOINTS} cache breakpoints`);
  }
  const messages: MessageParam[] = prompt.messages.map((m) => ({
    role: m.role,
    content: m.content.map(textBlock),
  }));
  return {
    model: options.model,
    max_tokens: options.maxTokens,
    system: prompt.system.map(textBlock),
    messages,
    output_config: {
      format: outputFormatFor(options.outputSchema),
      ...(options.effort ? { effort: options.effort } : {}),
    },
  };
}

/**
 * The assistant turn to replay before a corrective message. Thinking blocks are passed back
 * unchanged, as the API requires for preserved thinking; other block types are not expected
 * with structured output and are dropped.
 */
export function replayAssistantContent(content: ContentBlock[]): ContentBlockParam[] {
  const replay: ContentBlockParam[] = [];
  for (const block of content) {
    if (block.type === "text") replay.push({ type: "text", text: block.text });
    else if (block.type === "thinking")
      replay.push({ type: "thinking", thinking: block.thinking, signature: block.signature });
    else if (block.type === "redacted_thinking")
      replay.push({ type: "redacted_thinking", data: block.data });
  }
  return replay;
}

export function responseText(content: ContentBlock[]): string {
  return content
    .filter((b): b is Extract<ContentBlock, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
}
