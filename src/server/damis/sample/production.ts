/**
 * Sample-mode generators for the three production damis. Each derives its output from the input
 * alone (deterministic, no randomness) and validates the input with the dami's own schema.
 */
import { BLOCK_ISSUES, type BlockIssueCode } from "../block-reviser/issues";
import { blockReviserInputSchema } from "../block-reviser/schema";
import { ASSET_TAG_PATTERN } from "../prompt-sectioner/schema";
import {
  IMAGE_TOKEN_PATTERN,
  imageToken,
  MAX_PRODUCTION_PROMPT,
  MAX_REFERENCE_IMAGES,
  type BlockAsset,
} from "../shared/block";
import { TAKE_ISSUES, type TakeIssueCode } from "../take-fixer/issues";
import { takeFixerInputSchema } from "../take-fixer/schema";
import { textBlocksInputSchema } from "../text-blocks/schema";
import { collapseWhitespace, truncate } from "./util";

/** Lower is kept first when the block names more assets than the reference limit. */
const PRIORITY: Readonly<Record<string, number>> = {
  character: 0,
  creature: 0,
  location: 1,
  prop: 2,
  costume: 3,
  other: 4,
  voice: 5,
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A previous block's tail without tokens or tags: those belong to another block's numbering. */
function cleanTail(tail: string): string {
  return collapseWhitespace(
    tail.replace(new RegExp(IMAGE_TOKEN_PATTERN.source, "g"), "").replace(ASSET_TAG_PATTERN, ""),
  );
}

export function sampleTextBlocks(raw: unknown): {
  prompt: string;
  assetRefs: string[];
  notes: string[];
} {
  const input = textBlocksInputSchema.parse(raw);
  const byRef = new Map<string, BlockAsset>(input.assets.map((a) => [a.ref, a]));
  const notes: string[] = [];

  // Tags in order of first appearance.
  const appearance: string[] = [];
  for (const match of input.block.prompt.matchAll(ASSET_TAG_PATTERN)) {
    const ref = match[1] ?? "";
    if (!appearance.includes(ref)) appearance.push(ref);
  }

  const candidates = appearance.filter((ref) => {
    const asset = byRef.get(ref);
    return asset !== undefined && asset.kind !== "voice";
  });
  for (const ref of appearance) {
    const asset = byRef.get(ref);
    if (asset === undefined) {
      notes.push(`"${ref}" has no reference sheet yet; it is named in words only.`);
    }
  }
  const ranked = candidates
    .map((ref, order) => ({ ref, order, rank: PRIORITY[byRef.get(ref)?.kind ?? "other"] ?? 4 }))
    .sort((a, b) => a.rank - b.rank || a.order - b.order);
  const keptSet = new Set(ranked.slice(0, MAX_REFERENCE_IMAGES).map((c) => c.ref));
  for (const { ref } of ranked.slice(MAX_REFERENCE_IMAGES)) {
    const name = byRef.get(ref)?.name ?? ref;
    notes.push(
      `The video model takes at most ${MAX_REFERENCE_IMAGES} references; "${name}" is named in words only.`,
    );
  }
  const assetRefs = candidates.filter((ref) => keptSet.has(ref));

  let prompt = input.block.prompt;
  for (const ref of appearance) {
    const position = assetRefs.indexOf(ref) + 1;
    let first = true;
    prompt = prompt.replace(
      new RegExp(`( ?)\\[${escapeRegExp(ref)}\\]`, "g"),
      (_all, space: string) => {
        if (position > 0 && first) {
          first = false;
          return `${space}${imageToken(position)}`;
        }
        first = false;
        return "";
      },
    );
  }

  if (input.previous) {
    const tail = cleanTail(input.previous.promptTail);
    if (tail) {
      prompt = `${prompt}\nCONTINUITY: picks up from "${truncate(input.previous.title, 80)}"; keep wardrobe, light and positions as they were. Before: ${truncate(tail, 300)}`;
    }
  }
  if (prompt.length > MAX_PRODUCTION_PROMPT) prompt = prompt.slice(0, MAX_PRODUCTION_PROMPT);
  return { prompt, assetRefs, notes };
}

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
