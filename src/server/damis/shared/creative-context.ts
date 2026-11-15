/**
 * What every later dami gets from a project's Creative Bible (the owner's `buildConsumerContext`):
 * the shared core, the two specializations, the contracts, the project frame, its own slice of
 * rules and the QC items of its stages, as one block to put in its prompt after its own
 * instructions. The block is the same for every call of the project, so it is a cache breakpoint.
 */
import type { PromptText } from "../framework/define";
import { CREATIVE_REGISTRY, getCreativeModule } from "../creative-dna/registry";
import type { CreativeBible, ReviewPoint } from "../creative-dna/schema";

export const CREATIVE_CONSUMERS = [
  "script_writer",
  "script_checker",
  "asset_detector",
  "asset_generation",
  "sheet_generator",
  "director",
  "text_blocks_video",
] as const;
export type CreativeConsumer = (typeof CREATIVE_CONSUMERS)[number];

/** The QC stages a consumer checks its own output against before it answers. */
export const QC_STAGE: Readonly<Record<CreativeConsumer, readonly string[]>> = {
  script_writer: ["script", "all"],
  script_checker: ["script", "all"],
  asset_detector: ["asset", "all"],
  asset_generation: ["asset", "all"],
  sheet_generator: ["sheet", "all"],
  director: ["text_block", "video", "all"],
  text_blocks_video: ["text_block", "video", "all"],
};

function sliceFor(consumer: CreativeConsumer, bible: CreativeBible) {
  switch (consumer) {
    case "script_writer":
      return bible.slices.for_script_writer;
    case "script_checker":
      return bible.slices.for_script_checker;
    case "asset_detector":
      return bible.slices.for_asset_detector;
    case "asset_generation":
      return bible.slices.for_asset_generation;
    case "sheet_generator":
      return bible.slices.for_sheet_generator;
    case "director":
      return bible.slices.for_director;
    case "text_blocks_video":
      return bible.slices.for_text_blocks_video;
  }
}

const bullets = (lines: readonly string[]) => lines.map((l) => `- ${l}`).join("\n");

/** The Creative Bible block for one consumer, marked as a prompt-cache breakpoint. */
export function renderCreativeDna(consumer: CreativeConsumer, bible: CreativeBible): PromptText {
  const genre = getCreativeModule(bible.selection.genre_id);
  const style = getCreativeModule(bible.selection.style_id);
  const slice = sliceFor(consumer, bible);
  const rules = bullets(
    [
      ...slice.rules,
      ...(consumer === "script_writer" ? bible.slices.for_script_writer.series_rules : []),
    ].map((r) => r.rule),
  );
  const qc = bullets(
    bible.qc_checklist.filter((q) => QC_STAGE[consumer].includes(q.stage)).map((q) => q.criterion),
  );
  const extras = Object.entries(slice)
    .filter(([key]) => key !== "rules" && key !== "series_rules")
    .map(([key, value]) => `<${key}>\n${JSON.stringify(value)}\n</${key}>`)
    .join("\n");
  const text = `<creative_dna version="${bible.dami_version}" genre="${genre.id}" style="${style.id}">
<shared_core>
${CREATIVE_REGISTRY.shared_core_en}
</shared_core>
<genre_specialization>
${genre.specialization_en}
</genre_specialization>
<style_specialization>
${style.specialization_en}
</style_specialization>
<contracts>
Genre: ${bible.contracts.genre_contract}
Style: ${bible.contracts.style_contract}
Combination: ${bible.contracts.combination_logic}
</contracts>
<project_frame>
${JSON.stringify(bible.project_frame)}
</project_frame>
<project_rules>
${rules}
</project_rules>
${extras}
<never_add>
${bullets(bible.anti_cliche_guards.map((g) => g.guard))}
</never_add>
<continuity_locks>
${bullets(bible.continuity_locks)}
</continuity_locks>
<self_check_before_output>
${qc}
</self_check_before_output>
</creative_dna>`;
  return { text, cache: true };
}

/** The review screen's options for one review point (the wizard's reject flow). */
export function getReviewOptions(bible: CreativeBible, point: ReviewPoint) {
  return bible.review_options[point];
}
