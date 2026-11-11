/**
 * Sample-mode generators for the four reference-image damis. Each derives its output from the
 * input alone (deterministic, no randomness) and validates the input with the dami's own schema.
 */
import type { z } from "zod";
import type { ProjectStyle } from "@/server/db/schema";
import { assetFixerInputSchema } from "../asset-fixer/schema";
import { LOOK_ISSUES, type LookIssueCode } from "../asset-fixer/issues";
import { renderGuidedAnswers } from "../asset-prompt-writer/prompt";
import { assetPromptWriterInputSchema } from "../asset-prompt-writer/schema";
import type { ReferenceAsset } from "../shared/reference";
import type { ImageAssetKind } from "../shared/reference-rules";
import { SHEET_ISSUES, type SheetIssueCode } from "../sheet-fixer/issues";
import { sheetFixerInputSchema } from "../sheet-fixer/schema";
import { sheetGeneratorInputSchema } from "../sheet-generator/schema";
import { collapseWhitespace, truncate } from "./util";

const MAX_PROMPT = 2900;

function fit(text: string): string {
  return text.length <= MAX_PROMPT ? text : `${text.slice(0, MAX_PROMPT - 1).trimEnd()}…`;
}

function kindOf(asset: ReferenceAsset): ImageAssetKind {
  // Voices are rejected by every input schema; this keeps the type honest.
  return asset.kind === "voice" ? "other" : asset.kind;
}

function styleLead(style: ProjectStyle, what: string): string {
  return `${style.visualStyle} ${what} (${style.genre} film)`;
}

const LOOK_FRAMING: Record<ImageAssetKind, string> = {
  character:
    "full figure from head to toe, relaxed neutral pose facing the camera, calm neutral expression, face clearly visible, plain seamless light-grey background, even soft light",
  location:
    "wide establishing view of the whole place, signature feature in view, natural light for the time of day, no people",
  prop: "the object alone, centred, three-quarter angle, on a plain seamless light-grey background, soft even light with a faint contact shadow",
  creature:
    "full body in three-quarter view, standing naturally, plain seamless light-grey background, even soft light",
  costume:
    "the full outfit on a faceless mannequin, front view, plain seamless light-grey background, even soft light",
  other:
    "the single subject, whole and centred, plain seamless light-grey background, even soft light",
};

const SHEET_VIEWS: Record<ImageAssetKind, { views: string; layout: string }> = {
  character: {
    views:
      "a turnaround row of the full figure in four views on one shared ground line (front, three-quarter, side, back), then a row of three face close-ups (neutral, smiling, worried) and two close-ups of key costume details",
    layout:
      "Four-view turnaround (front, three-quarter, side, back) on top; three face close-ups and two costume details below.",
  },
  location: {
    views:
      "one large wide establishing view, two alternate angles of the same place, and three close-ups of key details",
    layout:
      "One large establishing view, two alternate angles beside it, and three detail close-ups in a row below.",
  },
  prop: {
    views:
      "orthographic front, side, back and top views on one shared scale, one three-quarter view, a drawn scale cue beside the object, and close-ups of its material and any marking",
    layout:
      "Four orthographic views and one three-quarter view in a row; scale cue and two material close-ups below.",
  },
  creature: {
    views:
      "a turnaround row in four views on one shared ground line (front, three-quarter, side, back), head close-ups from the front and in profile, a close-up of its markings and a drawn scale cue",
    layout:
      "Four-view turnaround on top; two head close-ups, a markings detail and a scale cue below.",
  },
  costume: {
    views:
      "the outfit on a faceless mannequin in four views (front, three-quarter, side, back) on one shared scale, plus close-ups of collar, fastenings, trim and fabric",
    layout: "Four mannequin views in a row; four detail close-ups in a second row.",
  },
  other: {
    views:
      "front, side and back or top views as suits its shape, one three-quarter view, a drawn scale cue and a close-up of its defining detail",
    layout: "Main views in a row; scale cue and defining-detail close-up below.",
  },
};

export function sampleAssetPromptWriter(raw: unknown): { prompt: string; notes: string[] } {
  const input = assetPromptWriterInputSchema.parse(raw);
  const kind = kindOf(input.asset);
  const description = truncate(input.asset.description, 500);
  const userPrompt = truncate(input.userPrompt ?? "", 800);
  const answers = renderGuidedAnswers(input.asset.kind, input.guidedAnswers).map((line) =>
    line.replace(/^- /, ""),
  );
  const parts = [
    `${styleLead(input.style, "reference image")} of the ${kind} "${input.asset.name}"`,
    LOOK_FRAMING[kind],
  ];
  if (userPrompt) parts.push(`director's description: ${userPrompt}`);
  if (answers.length > 0) parts.push(`chosen details: ${truncate(answers.join("; "), 900)}`);
  if (description) parts.push(`from the script: ${description}`);
  parts.push("no text, no watermark, no logo");
  const notes: string[] = [];
  if (userPrompt && description) {
    notes.push("Your own prompt wins where it differs from the script description.");
  }
  if (answers.length > 0) {
    notes.push(`Folded in ${answers.length} guided answer${answers.length === 1 ? "" : "s"}.`);
  }
  if (!description) notes.push("The script states nothing visual about this asset.");
  return { prompt: fit(parts.join(", ")), notes };
}

function notePart(note: string | undefined): string[] {
  return note ? [`director's note: ${truncate(note, 300)}`] : [];
}

const LOOK_FIX_TEXT: Record<LookIssueCode, string> = {
  face_incomplete:
    "the whole face is visible and sharp, both eyes, nose and mouth clearly drawn, head fully inside the frame",
  anatomy_wrong: "two arms, two legs, two hands with five fingers each, relaxed and fully visible",
  wrong_age: "the age shows clearly in skin texture, lines, hair and posture",
  wrong_clothing:
    "the outfit is described garment by garment, head to toe, in exact fabric and colour",
  wrong_era: "every garment, object and building belongs strictly to the stated era and place",
  wrong_details: "every fact from the script description is shown exactly as written",
  wrong_colours: "each key colour is exactly as named, next to the item it belongs to",
  text_or_watermark: "no text, no letters, no logo, no watermark, no signature anywhere",
  style_mismatch: "rendered strictly in the project's visual style, nothing from another style",
  background_not_clean:
    "one plain seamless light-grey background, no objects, no horizon line, no clutter",
  wrong_framing:
    "the whole subject centred inside the frame with margin on every side, camera at mid-height",
  extra_subjects: "the subject is alone in the picture, nothing and nobody else",
  lighting_poor: "even, soft, neutral light from the front and slightly above, open shadows",
};

const SHEET_FIX_TEXT: Record<SheetIssueCode, string> = {
  face_incomplete: "every face is fully visible and sharp, both eyes, nose and mouth clearly drawn",
  anatomy_wrong:
    "two arms, two legs and two five-fingered hands in every view, relaxed and visible",
  wrong_age: "the same age in every view and close-up, shown in skin, lines and hair",
  wrong_clothing:
    "every view wears exactly the outfit of the attached image, including the back view",
  wrong_era: "every garment, object and structure in every view belongs to the stated era",
  text_or_labels: "no text, letters, numbers, arrows, labels, logo or watermark on the sheet",
  style_mismatch:
    "the sheet matches the attached image's rendering and the project's style exactly",
  background_not_clean:
    "one plain seamless neutral light-grey background across the sheet, no borders or props",
  inconsistent_views:
    "every view shows exactly the same subject as the attached image: same face, outfit, colours and markings",
  proportions_off:
    "all views drawn to one shared scale on a common ground line with the proportions of the attached image",
  missing_view: "all required views are present and named in order, none dropped",
  wrong_framing: "each view whole and uncropped with margin, no overlaps, angles exactly as named",
  differs_from_look: "the sheet reproduces the attached image faithfully and adds no new features",
  layout_cluttered: "simple layout: clear rows, equal spacing, generous margins, nothing touching",
};

type FixInput = {
  previousPrompt: string;
  review: { issueCodes: readonly string[]; note?: string };
};

/** Previous prompt kept (trimmed to fit), requested fixes appended, one summary entry per request. */
function fixPrompt<C extends string>(
  input: FixInput,
  text: Record<C, string>,
  label: (code: C) => string,
): { prompt: string; changeSummary: { request: string; change: string }[] } {
  const codes = input.review.issueCodes as readonly C[];
  const additions = [...codes.map((code) => text[code]), ...notePart(input.review.note)];
  const addition = additions.join("; ");
  const room = Math.max(200, MAX_PROMPT - addition.length - 12);
  const previous = collapseWhitespace(input.previousPrompt).replace(/[.\s]+$/, "");
  const base = previous.length > room ? previous.slice(0, room).trimEnd() : previous;
  const changeSummary = codes.map((code) => ({
    request: code as string,
    change: truncate(`${label(code)}: added "${text[code]}".`, 400),
  }));
  if (input.review.note) {
    changeSummary.push({
      request: "note",
      change: truncate(`Applied the note: "${truncate(input.review.note, 200)}".`, 400),
    });
  }
  return { prompt: `${base}. Revised: ${addition}.`, changeSummary };
}

export function sampleAssetFixer(raw: unknown) {
  const input: z.output<typeof assetFixerInputSchema> = assetFixerInputSchema.parse(raw);
  return fixPrompt(input, LOOK_FIX_TEXT, (code) => LOOK_ISSUES[code].label);
}

export function sampleSheetFixer(raw: unknown) {
  const input: z.output<typeof sheetFixerInputSchema> = sheetFixerInputSchema.parse(raw);
  return fixPrompt(input, SHEET_FIX_TEXT, (code) => SHEET_ISSUES[code].label);
}

export function sampleSheetGenerator(raw: unknown): { prompt: string; layout: string } {
  const input = sheetGeneratorInputSchema.parse(raw);
  const kind = kindOf(input.asset);
  const { views, layout } = SHEET_VIEWS[kind];
  const description = truncate(input.asset.description, 500);
  const parts = [
    `${styleLead(input.style, "reference sheet")} of the ${kind} "${input.asset.name}", built from the attached reference image: ${views}`,
    "every view shows exactly the subject of the attached image, same proportions throughout",
  ];
  if (description) parts.push(`identifying features from the script: ${description}`);
  parts.push(
    "plain seamless light-grey background, even soft light, no text, no labels, no numbers, no panel borders, no watermark",
  );
  return { prompt: fit(parts.join(", ")), layout };
}
