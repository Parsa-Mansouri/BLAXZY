/**
 * Character sheets (sheet-generator-character v4): one 16:9 image built from the approved board.
 * A location's or prop's sheet is a pack of views instead (`asset-sheet-pack.ts`); a pack sheet
 * that reaches these jobs (queued before the pack jobs existed) is handed to `asset.sheet.plan`.
 */
import {
  AssetInputError,
  failSheet,
  loadSheetJob,
  packKindOf,
  requestSheetGeneration,
  storeCharacterSheet,
  type SheetJobContext,
} from "../../src/server/assets";
import {
  AI_DECIDES,
  CHARACTER_DETAIL_FIELDS,
  CHARACTER_SHEET_EDIT_CODES,
  designerProject,
  MAX_DESIGN_REFERENCES,
  noteOutsideRequests,
  runDami,
  sheetGeneratorCharacter,
  type CharacterSheetInput,
  type CharacterSheetOutput,
} from "../../src/server/damis";
import type { ProjectStyle, SheetSpec } from "../../src/server/db/schema";
import {
  assetSheetFix,
  assetSheetGenerate,
  assetSheetPlan,
  defineHandler,
  enqueue,
  type JobContext,
  type JobPayload,
} from "../../src/server/jobs";
import { classifyAssetFailure } from "./asset-failure";
import { creativeDnaForRun } from "./creative-bible";
import { handleFailure } from "./failure";

type OriginalRole = "face" | "outfit" | "full_body" | "other";
const ORIGINAL_ROLES: readonly string[] = ["face", "outfit", "full_body", "other"];

/** The character's details the user gave: guided answers (not left to the dami) and the script's description. */
function characterDetails(ctx: SheetJobContext): Record<string, string> {
  const details: Record<string, string> = {};
  const answers = ctx.look.guidedAnswers ?? {};
  for (const field of CHARACTER_DETAIL_FIELDS) {
    const value = answers[field]?.trim();
    if (value && value !== AI_DECIDES) details[field] = value.slice(0, 1000);
  }
  if (ctx.asset.description) details.script_description = ctx.asset.description.slice(0, 1000);
  return details;
}

/**
 * The sheet maker's input: the approved board as image 1, the previous sheet when every fix is
 * edit-eligible (detail frames or backdrop only), then the user's original photos. Fix mode sends
 * the previous prompt, its detail frames and the review's fix requests.
 */
export function characterSheetInput(ctx: SheetJobContext): CharacterSheetInput {
  const { look, asset, parent, review } = ctx;
  const style = ctx.project.style as ProjectStyle;
  if (!look.fileId) throw new AssetInputError("The approved image is missing. Start again.");
  const fixing = parent !== null && review !== null && parent.prompt !== null;
  const requests = fixing ? review.fixRequests : [];
  const editPrevious =
    fixing &&
    parent.fileId !== null &&
    requests.length > 0 &&
    requests.every((r) => CHARACTER_SHEET_EDIT_CODES.includes(r.code));
  const references: CharacterSheetInput["referenceImages"] = [
    { fileId: look.fileId, role: "approved" },
  ];
  if (editPrevious && parent.fileId) {
    references.push({ fileId: parent.fileId, role: "previous_sheet" });
  }
  for (const r of look.references) {
    if (references.length >= MAX_DESIGN_REFERENCES + 2) break;
    if (ORIGINAL_ROLES.includes(r.role)) {
      references.push({
        fileId: r.fileId,
        role: r.role as OriginalRole,
        ...(r.note ? { note: r.note } : {}),
      });
    }
  }
  const notes = fixing ? noteOutsideRequests(review.note, requests) : undefined;
  return {
    project: designerProject(style),
    character: {
      name: asset.name,
      ...(asset.details?.role ? { role: asset.details.role.slice(0, 200) } : {}),
      details: characterDetails(ctx),
      ...(asset.details?.isMinor === "yes" ? { isMinor: true } : {}),
    },
    referenceImages: references,
    ...(look.prompt ? { boardPrompt: look.prompt } : {}),
    boardAssumptions: (look.spec?.assumptions ?? []).slice(0, 60),
    renderCellNumbers: true,
    ...(notes ? { userNotes: notes.slice(0, 4000) } : {}),
    ...(fixing && parent.prompt
      ? {
          previousPrompt: parent.prompt,
          ...(parent.spec?.detailCells.length === 6
            ? { previousDetailCells: parent.spec.detailCells }
            : {}),
          fixRequests: requests.map((r) => ({
            type: r.type,
            code: r.code,
            instruction: r.instruction,
            ...(r.customText ? { customText: r.customText } : {}),
          })),
        }
      : {}),
  };
}

/** The sheet's spec from the dami's answer: the files to attach follow its reference order. */
export function characterSheetSpec(
  output: CharacterSheetOutput,
  input: CharacterSheetInput,
): SheetSpec {
  const refs = input.referenceImages;
  const files = output.reference_order
    .map((r) => refs[r.index - 1]?.fileId)
    .filter((f): f is string => f !== undefined);
  const { image_prompt: _prompt, ...rest } = output;
  void _prompt;
  return {
    maker: "sheet-generator-character",
    referenceFileIds: files.length > 0 ? [...new Set(files)] : [refs[0]?.fileId ?? ""],
    referenceOrder: output.reference_order,
    editMode: output.edit_mode,
    detailCells: output.detail_cells,
    styleUsed: output.style_used,
    assumptions: output.assumptions,
    warnings: output.warnings,
    appliedFixes: output.applied_fixes,
    generationOrder: [],
    output: rest,
  };
}

/**
 * Produces a pending character sheet: writes its prompt with the sheet maker unless one is stored
 * (a re-roll keeps it), then requests the generation. The completion hook moves it to review.
 */
async function produceSheet(
  payload: JobPayload<typeof assetSheetGenerate>,
  job: typeof assetSheetGenerate | typeof assetSheetFix,
  context: JobContext,
): Promise<void> {
  const sheetId = payload.sheetId;
  const ctx = await loadSheetJob(sheetId);
  if (!ctx || ctx.sheet.status !== "pending") return;
  if (packKindOf(ctx.asset.kind)) {
    await enqueue(assetSheetPlan, { sheetId });
    return;
  }
  const { sheet, look, asset, project } = ctx;
  try {
    if (asset.status !== "active") throw new AssetInputError("This asset was removed.");
    if (look.status !== "accepted" || !look.fileId) {
      throw new AssetInputError("The image this sheet is built from was replaced. Start again.");
    }
    if (!project.style) throw new AssetInputError("Choose the project's style first.");
    if (!sheet.prompt) {
      if (sheet.parentId && (!ctx.parent?.prompt || !ctx.review)) {
        throw new AssetInputError("The review this sheet answers is missing. Start again.");
      }
      const dna = await creativeDnaForRun({
        projectId: project.id,
        consumer: "sheet_generator",
        job,
        payload,
      });
      if (dna.deferred) return;
      const input = {
        ...characterSheetInput(ctx),
        ...(dna.creativeDna ? { creativeDna: dna.creativeDna } : {}),
      };
      const run = await runDami(sheetGeneratorCharacter, input, {
        userId: project.ownerId,
        projectId: project.id,
        signal: context.signal,
      });
      if (!run.output.image_prompt.trim()) {
        await failSheet(
          sheetId,
          run.output.warnings[0] ?? "The approved image could not be read. Replace it.",
          run.runId,
        );
        return;
      }
      await storeCharacterSheet({
        sheetId,
        prompt: run.output.image_prompt,
        spec: characterSheetSpec(run.output, input),
        damiRunId: run.runId,
      });
    }
    await requestSheetGeneration(sheetId);
  } catch (error) {
    await handleFailure(
      error,
      job,
      context,
      async (d) => {
        await failSheet(sheetId, d.message, d.runId);
      },
      classifyAssetFailure,
    );
  }
}

/** sheet-generator-character → prompt → generation (the approved board attached). */
export const assetSheetGenerateHandler = defineHandler(assetSheetGenerate, (payload, context) =>
  produceSheet(payload, assetSheetGenerate, context),
);

/** A rejected sheet's next version: the sheet maker in fix mode (or a re-roll) → generation. */
export const assetSheetFixHandler = defineHandler(assetSheetFix, (payload, context) =>
  produceSheet(payload, assetSheetFix, context),
);
