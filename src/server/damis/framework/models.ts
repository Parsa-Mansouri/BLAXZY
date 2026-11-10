/**
 * Claude model ids used by damis (confirmed against the `claude-api` skill, 2026-10 model table,
 * and the `Model` union in @anthropic-ai/sdk 1.7.0). Ids are complete as written: no date suffix.
 */
export const CLAUDE_MODELS = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
} as const;

export type KnownClaudeModel = (typeof CLAUDE_MODELS)[keyof typeof CLAUDE_MODELS];

/** Used when a dami does not name a model. */
export const FRAMEWORK_DEFAULT_MODEL: KnownClaudeModel = CLAUDE_MODELS.opus;

/**
 * Model precedence, highest first:
 * 1. an explicit model passed to `runDami` (Pro may let a user pick one),
 * 2. `DAMI_DEFAULT_MODEL` (an operator-wide override, e.g. a cheaper model for staging),
 * 3. the dami's own default.
 */
export function resolveModel(
  damiModel: string,
  envOverride: string | undefined,
  explicit: string | undefined,
): string {
  return explicit ?? envOverride ?? damiModel;
}
