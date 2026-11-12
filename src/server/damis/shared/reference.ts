/**
 * Pieces shared by the production fixers (block-reviser, take-fixer): the asset and review input schemas, the style and asset
 * renderers for the user message, and the image-prompt craft rules. Prompt text here is part of
 * each dami's stable base prompt: changing it means bumping their versions.
 */
import { z } from "zod";
import { ASSET_KINDS, type ProjectStyle } from "@/server/db/schema";
import { renderStyleReferences } from "./project";

/** The kinds that get an image. Voices are recorded, never generated. */
export const IMAGE_ASSET_KINDS = ASSET_KINDS.filter((k) => k !== "voice");

/** The asset a reference image or sheet is made for. Voices are rejected. */
export const referenceAssetSchema = z
  .object({
    kind: z.enum(ASSET_KINDS),
    name: z.string().trim().min(1).max(200),
    /** What the script states about the asset (may be empty for a manually added asset). */
    description: z.string().trim().max(4000).default(""),
  })
  .refine((asset) => asset.kind !== "voice", {
    path: ["kind"],
    message: "voice assets have no image; they are recorded, not generated",
  });

export type ReferenceAsset = z.output<typeof referenceAssetSchema>;

/** The review shape both fixers take; `codes` is the dami's own issue-code enum. */
export function reviewSchemaFor<const C extends readonly [string, ...string[]]>(codes: C) {
  return z
    .object({
      issueCodes: z.array(z.enum(codes)).max(codes.length).default([]),
      note: z.string().trim().max(4000).optional(),
    })
    .refine((review) => review.issueCodes.length > 0 || (review.note ?? "").length > 0, {
      message: "a review needs at least one issue code or a note",
    });
}

/** What the fixers return: the new prompt and one entry per review request. */
export const changeSummaryItemSchema = z.object({
  request: z.string().trim().min(1).describe('What this answers: an issue code or "note".'),
  change: z.string().trim().min(1).max(400).describe("What was changed, in English."),
});

export type ChangeSummaryItem = z.output<typeof changeSummaryItemSchema>;

export const imagePromptSchema = z
  .string()
  .trim()
  .min(20)
  .max(3000)
  .describe("The finished image-generation prompt, in English, as one block of text.");

/** The catalogue entry shape for the review UI (same fields as the script issues). */
export type ImageIssueDefinition<Code extends string> = {
  code: Code;
  /** The choice shown to the user. */
  label: string;
  /** A one-line hint under the choice. */
  hint: string;
  /** What the fixer must do about it. */
  instruction: string;
};

/**
 * One request per issue code plus "note"; the fixers' semantic check requires exactly these.
 */
export function requiredRequests(review: { issueCodes: readonly string[]; note?: string }) {
  const required: string[] = [...review.issueCodes];
  if (review.note) required.push("note");
  return required;
}

/** Semantic check shared by both fixers. */
export function checkFixerOutput(
  output: { prompt: string; changeSummary: ChangeSummaryItem[] },
  input: { previousPrompt: string; review: { issueCodes: readonly string[]; note?: string } },
): string[] {
  const issues: string[] = [];
  const required = requiredRequests(input.review);
  const answered = new Set(output.changeSummary.map((c) => c.request.trim()));
  for (const request of required) {
    if (!answered.has(request)) {
      issues.push(`changeSummary has no entry with request "${request}"; every request needs one`);
    }
  }
  for (const request of answered) {
    if (!required.includes(request)) {
      issues.push(
        `changeSummary request "${request}" is not one of: ${required.map((r) => `"${r}"`).join(", ")}`,
      );
    }
  }
  if (output.prompt.trim() === input.previousPrompt.trim()) {
    issues.push("the prompt is unchanged; apply the requested changes");
  }
  return issues;
}

/** The project's look, for the user message: style, genre and any extras, sorted by key. */
export function renderImageStyle(style: ProjectStyle): string {
  const lines = [
    "## Project look",
    `- Visual style: ${style.visualStyle}`,
    `- Genre: ${style.genre}`,
    ...renderStyleReferences(style),
  ];
  const extras = Object.entries(style.extras ?? {})
    .filter(([, v]) => v.trim().length > 0)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [key, value] of extras) lines.push(`- ${key}: ${value}`);
  return lines.join("\n");
}

export function renderAsset(asset: ReferenceAsset): string {
  return [
    "## The asset",
    `- Kind: ${asset.kind}`,
    `- Name: ${asset.name}`,
    "- What the script states:",
    "<script_description>",
    asset.description.length > 0 ? asset.description : "(the script states nothing visual)",
    "</script_description>",
  ].join("\n");
}

/** How to write a prompt for an image model; shared by all four damis. */
export const IMAGE_PROMPT_CRAFT = `## How to write an image-generation prompt
- One block of plain English prose or comma-separated phrases, no Markdown, no lists, no headings, no quotation marks around the whole prompt. Between 60 and 180 words: enough to pin the subject down, short enough that no detail is drowned.
- Order: the style in concrete rendering terms first, then the subject (who or what, the details that identify it), then pose or framing, then background, then light. The first words weigh most.
- State what you want, positively and concretely: "plain seamless light-grey background", not "no clutter". Use one short closing clause for exclusions that image models commonly get wrong ("no text, no watermark, no logo").
- Specific beats generic: "worn waxed-cotton jacket with a torn left cuff", not "old clothes". Give every colour, material and size you know. Never invent facts the script and the director did not give; where something is open, choose the plainest option that fits the era and style, and stay neutral.
- Era and culture are visual facts: clothing, materials, architecture and objects must belong to the period and place the script states. Do not mix in modern items.
- The image is a reference that a video model will later match across many shots, so it shows one clean, unambiguous version of the subject. No story moment, no dramatic action, no motion blur, no depth-of-field tricks that hide details.
- Never name real people, celebrities, brands, trademarked characters or artists' styles. Describe the look in neutral words instead.
- Generated images cannot carry legible text: no readable signs, labels, captions, logos or watermarks anywhere in the picture.`;

/** Language rules specific to image prompts (the screenplay language rules come on top). */
export const IMAGE_LANGUAGE_RULES = `## Language of the prompt
- The image prompt is always English, because the image model reads English best. Translate the script's facts and the director's words into English; keep a proper name or a quoted term in its original spelling only when it is a visible part of the subject (and never as legible text in the image).
- Notes, change summaries and layout descriptions are addressed to the director and written in English.`;
