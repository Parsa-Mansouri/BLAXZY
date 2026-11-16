import type { DamiPrompt } from "../framework/define";
import type { CreativeBible } from "../creative-dna/schema";
import { BLOCK_REVISION_SYSTEM } from "./prompt-text";
import type { BlockRevisionInput } from "./schema";

/**
 * `<creative_bible>` as the owner's `<inputs>` lists it: project_frame, contracts, the
 * `for_director` and `for_text_blocks_video` slices, continuity_locks and anti_cliche_guards. The
 * owner also lists `review_options.text_block` and `.video`; they are left out because BLAXZY's
 * change requests are free text only (no review options are sent).
 */
export function revisionBible(bible: CreativeBible) {
  return {
    project_frame: bible.project_frame,
    contracts: bible.contracts,
    slices: {
      for_director: bible.slices.for_director,
      for_text_blocks_video: bible.slices.for_text_blocks_video,
    },
    continuity_locks: bible.continuity_locks,
    anti_cliche_guards: bible.anti_cliche_guards,
  };
}

const tag = (name: string, value: string) => `<${name}>\n${value}\n</${name}>`;
const json = (value: unknown) => JSON.stringify(value);

/**
 * The owner's `<inputs>` as tagged blocks. Caching (2 of 4 breakpoints): the owner's prompt is
 * identical for every call (1); the platform numbers, Creative Bible and continuity bible are the
 * same for every block of a project (2); everything else is per block and per attempt. Optional
 * tags are only written when the input has them.
 */
export function buildBlockRevisionPrompt(input: BlockRevisionInput): DamiPrompt {
  const stable = [
    tag("platform_config", json(input.platform_config)),
    tag("creative_bible", json(revisionBible(input.creative_bible))),
    tag("continuity_bible", json(input.continuity_bible)),
  ].join("\n\n");

  const perBlock = [
    tag("ui_language", input.ui_language),
    tag("script_excerpt", input.script_excerpt),
    tag("neighbours", json(input.neighbours)),
    tag("current_block", json(input.current_block)),
  ];
  if (input.video_review) perBlock.push(tag("video_review", json(input.video_review)));
  if (input.timed_notes?.length) perBlock.push(tag("timed_notes", json(input.timed_notes)));
  if (input.keep?.length) perBlock.push(tag("keep", json(input.keep)));
  if (input.attempt_history?.length) {
    perBlock.push(tag("attempt_history", json(input.attempt_history)));
  }
  perBlock.push(tag("requests", json(input.requests)));
  perBlock.push(
    [
      "Refs for fix_map: an issue uses its issue_id; the timed notes are t1, t2, ... in the order given; the director note is d1.",
      "Return only the JSON object.",
    ].join("\n"),
  );

  return {
    system: [{ text: BLOCK_REVISION_SYSTEM, cache: true }],
    messages: [
      {
        role: "user",
        content: [{ text: stable, cache: true }, { text: perBlock.join("\n\n") }],
      },
    ],
  };
}
