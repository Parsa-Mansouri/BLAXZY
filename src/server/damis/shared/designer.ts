/**
 * Pieces shared by the three designers (character, location and prop generators): the project
 * block every one of them reads, the fix requests a review sends, the script slice, and helpers
 * for their prompts and checks. Pure: no database, no Claude.
 */
import { z } from "zod";
import { ownerGenreName, ownerStyleName } from "@/lib/style-options";
import type { ProjectStyle } from "@/server/db/schema";
import { isPromptImage, type DamiPrompt, type PromptPart } from "../framework/define";

/** What a guided answer says when the user lets the designer decide ("I'm not sure"). */
export const AI_DECIDES = "ai_decides";

/** Reference photos a designer reads at most (the owner tunes the prompts for four). */
export const MAX_DESIGN_REFERENCES = 4;

export const MAX_DESIGN_TEXT = 4000;

const text = (max = MAX_DESIGN_TEXT) => z.string().trim().min(1).max(max);
const optionalText = (max = MAX_DESIGN_TEXT) => z.string().trim().max(max).optional();

/** The project as the designers see it (the owner's `project` block). */
export const designerProjectSchema = z.object({
  /** The owner's style name ("Realistic", "Claymation") or the user's own words. */
  style: text(400),
  /** The resolved style, as the project's first character described it (used verbatim). */
  styleDescriptor: optionalText(2000),
  /** The owner's genre name ("Science Fiction") or the user's own words. */
  genre: text(400),
  format: z.enum(["movie", "series"]),
  orientation: z.enum(["landscape", "portrait"]),
  eraSetting: optionalText(500),
  lookLine: optionalText(1000),
  artDirectionNotes: optionalText(),
  uiLanguage: z.string().trim().min(2).max(10).default("en"),
});
export type DesignerProject = z.output<typeof designerProjectSchema>;

/** The designers' project block from the project's style (owner names for genre and style). */
export function designerProject(style: ProjectStyle): z.input<typeof designerProjectSchema> {
  return {
    style: ownerStyleName(style.visualStyle),
    ...(style.styleDescriptor ? { styleDescriptor: style.styleDescriptor } : {}),
    genre: ownerGenreName(style.genre),
    format: style.format,
    orientation: style.orientation,
    ...(style.eraSetting ? { eraSetting: style.eraSetting } : {}),
    ...(style.lookLine ? { lookLine: style.lookLine } : {}),
    ...(style.artDirectionNotes ? { artDirectionNotes: style.artDirectionNotes } : {}),
    uiLanguage: "en",
  };
}

/** One change the reviewer asked for (from `review.fix_requests`). */
export const designerFixRequestSchema = z.object({
  type: z.enum(["technical", "preference"]),
  code: text(40),
  instruction: text(),
  customText: optionalText(),
});
export type DesignerFixRequest = z.output<typeof designerFixRequestSchema>;

/** One scene of the script slice where an asset appears. */
export const designerSceneSchema = z.object({
  sceneNumber: text(20),
  heading: z.string().trim().max(300),
  action: z.string().max(3000),
  dialogueExcerpt: z.string().max(1500),
  charactersPresent: z.array(text(200)).max(100),
});
export type DesignerScene = z.output<typeof designerSceneSchema>;

export const designerScriptSchema = z.object({
  logline: z.string().trim().max(1000),
  scenes: z.array(designerSceneSchema).max(60),
});
export type DesignerScript = z.output<typeof designerScriptSchema>;

/** A reference photo by file id, with its role and what to keep from it. */
export function referenceSchema<const R extends readonly [string, ...string[]]>(roles: R) {
  return z.object({ fileId: z.uuid(), role: z.enum(roles), note: optionalText(1000) });
}

/** Guided answers keyed by question id ("ai_decides" lets the designer choose). */
export const guidedAnswersSchema = z.record(z.string().min(1).max(64), text(1000));

/**
 * The user message of a designer: the reference images first, in index order (the prompt calls
 * them "the first reference image" ...), then the input JSON.
 */
export function designerMessage(fileIds: readonly string[], input: string): DamiPrompt["messages"] {
  const parts: PromptPart[] = fileIds.map((fileId) => ({ image: { fileId } }));
  parts.push({ text: input });
  return [{ role: "user", content: parts }];
}

/** The text part of a designer's user message (for tests). */
export function designerInputText(prompt: DamiPrompt): string {
  const part = prompt.messages[0]?.content.find((p) => !isPromptImage(p));
  return part && !isPromptImage(part) ? part.text : "";
}

/** The owner's fix-request shape: `{type, code, instruction, custom_text?}`. */
export function ownerFixRequests(requests: readonly DesignerFixRequest[]) {
  return requests.map((r) => ({
    type: r.type,
    code: r.code,
    instruction: r.instruction,
    ...(r.customText ? { custom_text: r.customText } : {}),
  }));
}

/** Guided answers without the ones the user left to the designer, or null when none remain. */
export function decidedAnswers(
  answers: Readonly<Record<string, string>> | undefined,
): Record<string, string> | null {
  if (!answers) return null;
  const kept = Object.entries(answers).filter(([, v]) => v !== AI_DECIDES);
  return kept.length > 0 ? Object.fromEntries(kept) : null;
}

/** Problems with `applied_fixes`: every requested code must be applied, and only those. */
export function appliedFixProblems(
  applied: readonly string[],
  requests: readonly { code: string }[],
): string[] {
  const asked = new Set(requests.map((r) => r.code));
  const done = new Set(applied);
  const problems: string[] = [];
  for (const code of asked) {
    if (!done.has(code)) problems.push(`applied_fixes must list ${code}: apply every fix request`);
  }
  for (const code of done) {
    if (!asked.has(code)) {
      problems.push(
        `applied_fixes lists ${code}, which was not requested: list only applied codes`,
      );
    }
  }
  return problems;
}

/**
 * Problems with a sheet maker's `applied_fixes`: the sheet makers never change the design, so a
 * request they could not apply (a design change, a detail the asset does not have) is named in
 * `warnings` instead. Every requested code is applied or explained there; only requested codes
 * are listed as applied.
 */
export function sheetFixProblems(
  applied: readonly string[],
  warnings: readonly string[],
  requests: readonly { code: string }[],
): string[] {
  const asked = new Set(requests.map((r) => r.code));
  const done = new Set(applied);
  const warned = warnings.join("\n");
  const problems: string[] = [];
  for (const code of asked) {
    if (!done.has(code) && !warned.includes(code) && !/DESIGN_CHANGE_REQUESTED:/.test(warned)) {
      problems.push(
        `applied_fixes must list ${code}, or a warning must say why it was not applied`,
      );
    }
  }
  for (const code of done) {
    if (!asked.has(code)) {
      problems.push(
        `applied_fixes lists ${code}, which was not requested: list only applied codes`,
      );
    }
  }
  return problems;
}

/** Words in a text. */
export function wordCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

/** A plain object, or null for anything else (arrays, null, primitives). */
export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The sheet makers' `generation_order` rule: it lists every view id of `views` exactly once.
 * `allowEmpty` skips the check when there are no views at all. Also returns each id's position,
 * which `viewDependencyProblems` needs.
 */
export function generationOrderProblems(
  ids: readonly string[],
  order: readonly string[],
  options: { allowEmpty?: boolean } = {},
): { problems: string[]; position: Map<string, number> } {
  const position = new Map(order.map((id, i) => [id, i]));
  const problems: string[] = [];
  const skip = options.allowEmpty && ids.length === 0;
  if (!skip && (order.length !== ids.length || ids.some((id) => !position.has(id)))) {
    problems.push("generation_order must list every view_id of views exactly once");
  }
  return { problems, position };
}

/**
 * A view's dependencies: each one that is in this answer comes earlier in `generation_order`, and
 * each one that is not in it is known (approved, or otherwise allowed).
 */
export function viewDependencyProblems(
  viewId: string,
  dependsOn: readonly string[],
  position: ReadonlyMap<string, number>,
  isKnown: (dependency: string) => boolean,
): string[] {
  const problems: string[] = [];
  const at = position.get(viewId) ?? -1;
  for (const dep of dependsOn) {
    const depAt = position.get(dep);
    if (depAt !== undefined && depAt >= at) {
      problems.push(`${viewId} depends on ${dep}, so it must come after it in generation_order`);
    }
    if (depAt === undefined && !isKnown(dep)) {
      problems.push(`${viewId} depends on ${dep}, which is neither approved nor in views`);
    }
  }
  return problems;
}

/**
 * `edit_previous_view` only when the view has fix requests and every one is edit-eligible, and the
 * previous version is referenced (`hasPreviousReference`).
 */
export function editPreviousViewProblems(
  viewId: string,
  requests: readonly { editEligible: boolean }[],
  hasPreviousReference: boolean,
): string[] {
  const problems: string[] = [];
  if (requests.length === 0 || !requests.every((r) => r.editEligible)) {
    problems.push(
      `${viewId}: edit_previous_view only when every request for the view is edit_eligible`,
    );
  }
  if (!hasPreviousReference) {
    problems.push(`${viewId}: edit_previous_view needs "previous:${viewId}" in reference_order`);
  }
  return problems;
}

/** The views of a sheet maker's answer: at most this many (the storage layer keeps 20 per pack). */
export const MAX_SHEET_VIEWS = 20;

/** View ids that appear more than once. */
export function duplicateIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dupes.add(id);
    seen.add(id);
  }
  return [...dupes];
}

/** True when a sheet maker run is a fix round: a previous answer plus requests or user notes. */
export function isSheetFixRound(input: {
  previousOutput?: unknown;
  fixRequests: readonly unknown[];
  userNotes?: unknown;
}): boolean {
  return (
    input.previousOutput !== undefined &&
    (input.fixRequests.length > 0 || input.userNotes !== undefined)
  );
}
