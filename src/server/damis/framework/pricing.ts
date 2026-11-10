/**
 * The single pricing table for Claude calls, in USD per million tokens (first-party Claude API).
 *
 * Sources (the `claude-api` skill, model table cached 2026-10-06, and its prompt-caching guide):
 * - claude-opus-5-5: input $4, output $20, cache read $0.20.
 * - claude-sonnet-5-5: input $2, output $10, cache read $0.20.
 * - 5-minute cache writes cost 1.25x the input price (the runner only uses the default 5-minute TTL).
 *
 * claude-haiku-5-5 is deliberately absent: its input/output prices are tiered by prompt length
 * and its cache-read price could not be confirmed, so runs on it store `cost_usd = null`.
 * Never add a price here that you cannot confirm from Anthropic's pricing page.
 */
export type ModelPricing = {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWrite5mPerMTok: number;
};

const CACHE_WRITE_5M_MULTIPLIER = 1.25;

function pricing(input: number, output: number, cacheRead: number): ModelPricing {
  return {
    inputPerMTok: input,
    outputPerMTok: output,
    cacheReadPerMTok: cacheRead,
    cacheWrite5mPerMTok: input * CACHE_WRITE_5M_MULTIPLIER,
  };
}

export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  "claude-opus-5-5": pricing(4, 20, 0.2),
  "claude-sonnet-5-5": pricing(2, 10, 0.2),
};

export type TokenUsage = {
  /** Uncached input tokens. */
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** Cost in USD, or null when the model has no confirmed price. */
export function computeCostUsd(model: string, usage: TokenUsage): number | null {
  const price = MODEL_PRICING[model];
  if (!price) return null;
  const cost =
    (usage.inputTokens * price.inputPerMTok +
      usage.outputTokens * price.outputPerMTok +
      usage.cacheReadTokens * price.cacheReadPerMTok +
      usage.cacheWriteTokens * price.cacheWrite5mPerMTok) /
    1_000_000;
  // dami_run.cost_usd is numeric(12, 6).
  return Math.round(cost * 1_000_000) / 1_000_000;
}
