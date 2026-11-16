import type { DamiPrompt, PromptPart } from "../framework/define";
import { VIDEO_REVIEW_SYSTEM } from "./prompt-text";
import type { VideoReviewParsedInput } from "./schema";

/** `SHEET char_1 (MOHAMMAD)`: the text line before a sheet image. */
export function sheetLabel(sheet: { asset_id: string; name: string }): string {
  return `SHEET ${sheet.asset_id} (${sheet.name})`;
}

/** The label before the last frame of the accepted previous block. */
export const PREV_END_LABEL = "PREV_END";

const tag = (name: string, value: unknown) =>
  `<${name}>\n${typeof value === "string" ? value : JSON.stringify(value)}\n</${name}>`;

/**
 * The owner's user turn, in his input order. Each image is preceded, in its own text part, by its
 * label line (`SHEET ...`, `PREV_END`, `FRAME ...`).
 *
 * Caching: the system prompt is one breakpoint. Everything up to and including the last sheet (or
 * PREV_END) is the same for every attempt at the block (bible, block, binding, sheets), so it is
 * the second breakpoint; the frames, cuts, transcript and meta that follow are per clip. The image
 * count is limited by the input schema (`MAX_PROMPT_IMAGES`).
 */
export function buildVideoReviewPrompt(input: VideoReviewParsedInput): DamiPrompt {
  const stable: PromptPart[] = [
    {
      text: [
        tag("ui_language", input.ui_language),
        tag("creative_bible", input.creative_bible),
        ...(input.continuity_bible ? [tag("continuity_bible", input.continuity_bible)] : []),
        tag("block", input.block),
        tag("reference_binding", input.reference_binding),
      ].join("\n\n"),
    },
  ];
  if (input.sheets.length > 0) {
    stable.push({ text: "<sheets> (one image per asset; the text line before each names it)" });
  }
  for (const sheet of input.sheets) {
    stable.push({ text: sheetLabel(sheet) }, { image: { fileId: sheet.fileId } });
  }
  if (input.previous_end_frame) {
    stable.push({ text: PREV_END_LABEL }, { image: { fileId: input.previous_end_frame.fileId } });
  }
  const lastStable = stable[stable.length - 1]!;
  stable[stable.length - 1] = { ...lastStable, cache: true };

  const perClip: PromptPart[] = [
    { text: "<frames> (keyframes of the generated clip, in time order)" },
  ];
  for (const frame of input.frames) {
    perClip.push({ text: frame.label }, { image: { fileId: frame.fileId } });
  }
  const meta = input.generation_meta;
  perClip.push({
    text: [
      tag("detected_cuts", input.detected_cuts),
      ...(input.transcript ? [tag("transcript", input.transcript)] : []),
      tag("generation_meta", meta),
      `Review the clip now. Report block_id ${input.block.block_id}, block_version ${input.block.version}, video_version ${meta.video_version}. Write every label in ui_language. Return only the JSON object.`,
    ].join("\n\n"),
  });

  return {
    system: [{ text: VIDEO_REVIEW_SYSTEM, cache: true }],
    messages: [{ role: "user", content: [...stable, ...perClip] }],
  };
}
