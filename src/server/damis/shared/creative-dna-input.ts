/**
 * What a dami that consumes the Creative Bible takes and does with it. Kept apart from
 * `creative-context.ts` (which holds the registry) so input schemas stay light.
 */
import { z } from "zod";
import type { PromptText } from "../framework/define";

/**
 * The optional `creativeDna` input of a consuming dami: the rendered block for its consumer
 * (`renderCreativeDna(consumer, bible).text`), so the dami stays a pure function of its input.
 */
export const creativeDnaTextSchema = z.string().min(1).max(100_000);

/**
 * Adds the project's Creative Bible block as the last system block (one more cache breakpoint).
 * Without one the system prompt is returned unchanged, so a project with no bible gets exactly
 * the prompt it always got. Every consumer has at most three breakpoints before this one.
 */
export function withCreativeDna(
  system: PromptText[],
  creativeDna: string | undefined,
): PromptText[] {
  return creativeDna ? [...system, { text: creativeDna, cache: true }] : system;
}
