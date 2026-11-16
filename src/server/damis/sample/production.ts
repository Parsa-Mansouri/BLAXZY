/**
 * Sample-mode generators for the production damis (block-reviser and take-fixer). Each derives its output from the input
 * alone (deterministic, no randomness) and validates the input with the dami's own schema.
 */
import { BLOCK_ISSUES, type BlockIssueCode } from "../block-reviser/issues";
import { blockReviserInputSchema } from "../block-reviser/schema";
import { TAKE_ISSUES, type TakeIssueCode } from "../take-fixer/issues";
import { takeFixerInputSchema } from "../take-fixer/schema";
import { truncate } from "./util";

const BLOCK_FIX_TEXT: Record<BlockIssueCode, string> = {
  wrong_assets: "only the assets that belong in this shot are attached and named",
  missing_asset: "every asset the script puts in this shot is attached and named",
  wrong_camera: "shot size, angle and one simple named camera move are stated for each shot",
  action_unclear: "each shot has one clear action with a clear subject and direction",
  dialogue_wrong: "every line is verbatim from the script, with the right speaker and shot",
  too_much_happening: "the block holds only what fits its duration, one action per shot",
  continuity_break: "wardrobe, light and positions carry over from the previous shot",
  tone_off: "the mood is carried by light, pace and framing as the moment needs",
  wrong_setting: "the place, time of day and light are as the script states",
  invented_content: "nothing is shown that the script does not support",
};

const TAKE_FIX_TEXT: Record<TakeIssueCode, string> = {
  face_distorted:
    "closer framing so the face is large, sharp and evenly lit, one calm slow action, steady camera",
  character_mismatch:
    "the character keeps the look of the reference sheet in every shot, no other look",
  anatomy_wrong: "two arms, two legs, hands in view and relaxed, no crossing limbs",
  wrong_action: "one clear physical action per shot, stated first, with its end position",
  motion_glitch: "slow, single movement, steady camera, everything else stays still",
  wrong_location: "the location, time of day and light are restated at the start of the shot",
  object_wrong:
    "the key object is named with its reference, held in one hand, unchanged throughout",
  text_or_watermark: "no text, no subtitles, no captions, no logo, no watermark",
  wrong_camera_move: "one named camera move with its direction and speed in each shot",
  audio_off: "one speaker at a time, lines verbatim and short enough for their shot",
  too_static: "a slow camera move and one clear action with ambient movement in the scene",
  cut_off_early: "the action starts in the first second and ends on a held beat before the last",
  style_mismatch: "the project's visual style is restated in concrete terms at the start",
  flicker: "one steady, continuous light source, no flickering lights, static or slow camera",
};

type Review = { issueCodes: readonly string[]; note?: string };

/** Previous prompt kept as it is, the requested fixes appended, one summary entry per request. */
function revise<C extends string>(
  previousPrompt: string,
  review: Review,
  text: Record<C, string>,
  label: (code: C) => string,
  lead: string,
): { prompt: string; changeSummary: { request: string; change: string }[] } {
  const codes = review.issueCodes as readonly C[];
  const additions = codes.map((code) => text[code]);
  if (review.note) additions.push(`director's note: ${truncate(review.note, 300)}`);
  const previous = previousPrompt.trim().replace(/[.\s]+$/, "");
  const changeSummary = codes.map((code) => ({
    request: code as string,
    change: truncate(`${label(code)}: added "${text[code]}".`, 400),
  }));
  if (review.note) {
    changeSummary.push({
      request: "note",
      change: truncate(`Applied the note: "${truncate(review.note, 200)}".`, 400),
    });
  }
  return { prompt: `${previous}.\n${lead}: ${additions.join("; ")}.`, changeSummary };
}

export function sampleBlockReviser(raw: unknown) {
  const input = blockReviserInputSchema.parse(raw);
  const result = revise(
    input.block.prompt,
    input.review,
    BLOCK_FIX_TEXT,
    (code) => BLOCK_ISSUES[code].label,
    "REVISED",
  );
  return { ...result, assetRefs: [...input.block.assetRefs] };
}

export function sampleTakeFixer(raw: unknown) {
  const input = takeFixerInputSchema.parse(raw);
  return revise(
    input.previousPrompt,
    input.review,
    TAKE_FIX_TEXT,
    (code) => TAKE_ISSUES[code].label,
    `RETRY (${input.stage})`,
  );
}
