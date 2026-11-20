import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { PLATFORM_CONFIG } from "../shared/platform";
import { buildCreativeDnaPrompt } from "./prompt";
import {
  creativeBibleSchema,
  creativeDnaInputSchema,
  REVIEW_POINTS,
  type CreativeBible,
  type CreativeDnaInput,
} from "./schema";

export const CREATIVE_DNA_VERSION = "1.0.0";

/** Every rule of every slice, series rules included. */
function sliceRules(bible: CreativeBible) {
  return [
    ...Object.values(bible.slices).flatMap((slice) => slice.rules),
    ...bible.slices.for_script_writer.series_rules,
  ];
}

/**
 * The owner's `semanticCheck`, plus the block math the platform numbers fix. A `rejected` skeleton
 * is the owner's allowed answer for a wrong module kind (the input guard keeps that from reaching
 * a call, so it only comes from the model misreading): it is not checked further, and the worker
 * does not store it as a bible.
 */
export function checkCreativeBible(bible: CreativeBible, input: CreativeDnaInput): string[] {
  if (bible.validation_status === "rejected") {
    return bible.conflicts.length > 0
      ? []
      : ['a "rejected" answer must explain itself in `conflicts`'];
  }
  const errors: string[] = [];
  if (bible.selection.genre_id !== input.genre_id || bible.selection.style_id !== input.style_id) {
    errors.push("selection ids do not match the requested genre_id/style_id");
  }
  const criteria = bible.qc_checklist.filter((q) => q.type === "criterion");
  if (criteria.filter((q) => q.source === "genre").length < 6) {
    errors.push("qc_checklist needs all 6 genre criteria");
  }
  if (criteria.filter((q) => q.source === "style").length < 6) {
    errors.push("qc_checklist needs all 6 style criteria");
  }
  const seen = new Set<string>();
  const unique = (id: string) => {
    if (seen.has(id)) errors.push(`duplicate id ${id}`);
    seen.add(id);
  };
  for (const rule of sliceRules(bible)) unique(rule.id);
  for (const point of REVIEW_POINTS) {
    const options = bible.review_options[point];
    for (const option of [...options.technical, ...options.preference]) unique(option.id);
  }
  const frame = bible.project_frame;
  if (input.dialogue_policy === "none" && frame.max_spoken_words_per_block !== 0) {
    errors.push("dialogue_policy none requires max_spoken_words_per_block = 0");
  }
  const lengths: readonly number[] = PLATFORM_CONFIG.block_length_options_sec;
  if (!lengths.includes(frame.block_length_sec)) {
    errors.push(`block_length_sec must be one of ${lengths.join(", ")}`);
  }
  if (input.block_length_sec !== undefined && frame.block_length_sec !== input.block_length_sec) {
    errors.push(
      `block_length_sec must be ${input.block_length_sec}, the length the user chose in project_settings`,
    );
  }
  if (input.episode_duration_sec != null) {
    const expected = Math.ceil(input.episode_duration_sec / frame.block_length_sec);
    if (frame.blocks_per_episode !== expected) {
      errors.push(
        `blocks_per_episode must be ceil(episode_duration_sec / block_length_sec) = ${expected}`,
      );
    }
  }
  return errors;
}

export const creativeDna = defineDami({
  key: "creative-dna",
  version: CREATIVE_DNA_VERSION,
  description:
    "DAMI-00 Creative DNA: compiles a project's genre and visual-style modules, format, orientation and duration into its Creative Bible (output_10), the rules, guards, QC items and review options every later dami follows.",
  input: creativeDnaInputSchema,
  output: creativeBibleSchema,
  // Opus: one call per project (and per Style change) that every later stage depends on; the work
  // is merging two long modules without contradicting either, so a miss is costly.
  model: CLAUDE_MODELS.opus,
  effort: "medium",
  maxOutputTokens: 32_000,
  build: buildCreativeDnaPrompt,
  check: checkCreativeBible,
});
