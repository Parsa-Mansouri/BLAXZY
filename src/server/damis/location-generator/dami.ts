import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { appliedFixProblems, wordCount } from "../shared/designer";
import { buildLocationGeneratorPrompt } from "./prompt";
import {
  locationGeneratorInputSchema,
  locationGeneratorOutputSchema,
  type LocationGeneratorOutput,
  type LocationGeneratorParsedInput,
} from "./schema";

/** The owner's limit is 40 words; only clearly longer summaries are sent back. */
const SUMMARY_MAX_WORDS = 55;

/** True when the run is a fix round (the owner's STEP 9). */
export function isLocationFix(input: LocationGeneratorParsedInput): boolean {
  return (
    input.previousOutput !== undefined &&
    (input.fixRequests.length > 0 || input.userNotes !== undefined)
  );
}

/**
 * The owner's validators (section 8): spec fields exist, every anchor the Hero names is in the
 * DNA, the coverage plan has the requested mode, the Hero's mode fits the references, and every
 * fix request is applied.
 */
export function checkLocationSpec(
  output: LocationGeneratorOutput,
  input: LocationGeneratorParsedInput,
): string[] {
  const problems: string[] = [];
  if (output.spec_fields.length === 0) problems.push("spec_fields must not be empty");
  const anchors = new Set(output.dna.fixed_anchors.map((a) => a.id));
  for (const id of [
    ...output.hero_wide.visible_anchor_ids,
    ...output.hero_wide.hidden_anchor_ids,
  ]) {
    if (!anchors.has(id)) {
      problems.push(`hero_wide names anchor "${id}", which is not in dna.fixed_anchors`);
    }
  }
  const layoutIds = new Set([
    ...output.layout.openings.map((o) => o.id),
    ...output.layout.key_objects.map((o) => o.id),
    ...output.layout.zones.map((z) => z.id),
  ]);
  for (const anchor of output.dna.fixed_anchors) {
    if (!layoutIds.has(anchor.id) && !anchor.where.trim()) {
      problems.push(
        `fixed anchor "${anchor.id}" must be in the layout (same id) or say where it is (wall and position)`,
      );
    }
  }
  if (output.coverage_plan.mode !== input.outputMode) {
    problems.push(`coverage_plan.mode must be "${input.outputMode}" (the requested output_mode)`);
  }
  const refs = input.referenceImages;
  const hero = output.hero_wide;
  for (const r of hero.reference_order) {
    const given = refs[r.index - 1];
    if (!given || given.role !== r.role) {
      problems.push(
        `hero_wide.reference_order entry ${r.index}:${r.role} does not match the attached images`,
      );
    }
  }
  const heroRef = refs.some((r) => r.role === "hero");
  if (hero.mode !== "generate" && !heroRef) {
    problems.push(`hero_wide.mode "${hero.mode}" needs a reference image with the role "hero"`);
  }
  if (hero.mode === "use_uploaded" && hero.image_prompt.trim()) {
    problems.push('hero_wide.image_prompt must be empty when mode is "use_uploaded"');
  }
  if (hero.mode !== "use_uploaded" && !hero.image_prompt.trim() && output.warnings.length === 0) {
    problems.push("hero_wide.image_prompt is empty: write it, or explain in warnings why not");
  }
  if (wordCount(output.location_summary) > SUMMARY_MAX_WORDS) {
    problems.push("location_summary must be at most 40 words");
  }
  if (input.styleOverride === undefined && output.style_source !== "project_style") {
    problems.push('style_source must be "project_style": no style_override was given');
  }
  if (!output.style_used.trim()) problems.push("style_used must name the effective style");
  problems.push(
    ...appliedFixProblems(output.applied_fixes, isLocationFix(input) ? input.fixRequests : []),
  );
  return problems;
}

export const locationGenerator = defineDami({
  key: "location-generator",
  version: "1.0.0",
  description:
    "Defines one location (space first, image second): narrative analysis, a specification with confirmed, inferred and unknown fields, DNA, a layout on a shared compass, a coverage plan and the 16:9 Hero prompt; fix mode applies the reviewer's fix requests to the previous answer.",
  input: locationGeneratorInputSchema,
  output: locationGeneratorOutputSchema,
  // The owner's recommended model.
  model: CLAUDE_MODELS.sonnet,
  // The owner asks for temperature 0.5 on a first run and 0.3 in fix mode. The SDK has no
  // temperature (docs/damis/README.md): medium effort here, and the worker passes `low` for fix
  // rounds (`LOCATION_FIX_EFFORT`).
  effort: "medium",
  // The owner sizes max_tokens at 6000; doubled for headroom (thinking counts against it).
  maxOutputTokens: 12_000,
  build: buildLocationGeneratorPrompt,
  check: checkLocationSpec,
});

/** Effort for fix rounds (the owner's temperature 0.3). */
export const LOCATION_FIX_EFFORT = "low" as const;
