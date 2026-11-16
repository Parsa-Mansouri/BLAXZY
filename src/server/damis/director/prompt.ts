import type { DamiPrompt, PromptText } from "../framework/define";
import { QC_STAGE } from "../shared/creative-context";
import type { CreativeBible } from "../creative-dna/schema";
import { DIRECTOR_SYSTEM } from "./prompt-text";
import type { AnyDirectorInput } from "./schema";

/**
 * `<creative_bible>` as the owner's `<inputs>` lists it: selection, project_frame, contracts, the
 * `for_director` and `for_text_blocks_video` slices, continuity_locks, anti_cliche_guards, the QC
 * items of the stages the Director checks (`text_block`, `video`, `all`), open_questions and
 * validation_status.
 *
 * Not `renderCreativeDna("director" | "text_blocks_video", ...)`: that renders one consumer per
 * call (twice would repeat the shared core and the frame), and leaves out `open_questions` and
 * `validation_status`, which the Director's preflight reads. Review options, the other slices and
 * the conflicts are not the Director's business and are left out.
 */
export function directorBible(bible: CreativeBible) {
  const stages = QC_STAGE.director;
  return {
    selection: bible.selection,
    project_frame: bible.project_frame,
    contracts: bible.contracts,
    slices: {
      for_director: bible.slices.for_director,
      for_text_blocks_video: bible.slices.for_text_blocks_video,
    },
    continuity_locks: bible.continuity_locks,
    anti_cliche_guards: bible.anti_cliche_guards,
    qc_checklist: bible.qc_checklist.filter((q) => stages.includes(q.stage)),
    open_questions: bible.open_questions,
    validation_status: bible.validation_status,
  };
}

const tag = (name: string, value: string) => `<${name}>\n${value}\n</${name}>`;

/**
 * The owner's `<inputs>` as tagged blocks of the user turn.
 *
 * Caching (3 of 4 breakpoints): the owner's system prompt is identical for every call (1); the
 * platform numbers, block mode, Creative Bible, asset registry and script are the same for the
 * plan call and every `write_blocks` batch of a project, so they come first and form the second
 * prefix (2); the saved plan is the same for every batch of one run (3); the mode, the range and
 * the closing line change per call and come last. The owner lists `<mode>` first; the order of
 * tags in the data does not matter to the prompt, but a stable prefix does to the cache.
 */
export function buildDirectorPrompt(input: AnyDirectorInput): DamiPrompt {
  const stable = [
    tag("platform_config", JSON.stringify(input.platform_config)),
    tag("block_mode", input.block_mode),
    tag("creative_bible", JSON.stringify(directorBible(input.creative_bible))),
    tag("asset_registry", JSON.stringify(input.asset_registry)),
    tag("script", input.script),
  ].join("\n\n");

  const content: PromptText[] = [{ text: stable, cache: true }];
  if (input.plan) {
    content.push({ text: tag("plan", JSON.stringify(input.plan)), cache: true });
  }
  const perCall = [tag("mode", input.mode)];
  if (input.block_range) perCall.push(tag("block_range", input.block_range));
  perCall.push(
    input.mode === "plan"
      ? "Run the plan pass now. Return only the JSON object."
      : input.mode === "write_blocks"
        ? "Write the blocks of block_range now, using the plan verbatim. Return only the JSON object."
        : "Direct the whole script now. Return only the JSON object.",
  );
  content.push({ text: perCall.join("\n\n") });

  return {
    system: [{ text: DIRECTOR_SYSTEM, cache: true }],
    messages: [{ role: "user", content }],
  };
}
