import {
  AssetInputError,
  failSheet,
  loadSheetJob,
  requestSheetGeneration,
  storeSheetPrompt,
} from "../../src/server/assets";
import {
  runDami,
  SHEET_ISSUE_CODES,
  sheetFixer,
  sheetGenerator,
  type SheetIssueCode,
} from "../../src/server/damis";
import {
  assetSheetFix,
  assetSheetGenerate,
  defineHandler,
  type JobContext,
  type JobDefinition,
} from "../../src/server/jobs";
import { classifyAssetFailure } from "./asset-failure";
import { handleFailure } from "./script-failure";

function isSheetIssue(code: string): code is SheetIssueCode {
  return (SHEET_ISSUE_CODES as readonly string[]).includes(code);
}

/**
 * Produces a pending sheet: writes its prompt with a dami unless one is stored, then requests the
 * generation with the accepted look attached as the reference. The completion hook moves the
 * sheet to review. `fix` answers the rejected parent's review with the sheet-fixer.
 */
async function produceSheet(
  sheetId: string,
  mode: "generate" | "fix",
  job: JobDefinition,
  context: JobContext,
): Promise<void> {
  const ctx = await loadSheetJob(sheetId);
  if (!ctx || ctx.sheet.status !== "pending") return;
  if ((ctx.sheet.parentId !== null) !== (mode === "fix")) return; // the other job's sheet
  const { sheet, look, asset, project, parent, review } = ctx;
  try {
    if (asset.status !== "active") throw new AssetInputError("This asset was removed.");
    if (look.status !== "accepted" || !look.fileId) {
      throw new AssetInputError("The image this sheet is built from was replaced. Start again.");
    }
    if (!project.style) throw new AssetInputError("Choose the project's style first.");
    if (!sheet.prompt) {
      const reference = {
        kind: asset.kind,
        name: asset.name,
        description: asset.description ?? "",
      };
      const runContext = { userId: project.ownerId, projectId: project.id, signal: context.signal };
      let run: { runId: string; output: { prompt: string } };
      if (mode === "generate") {
        run = await runDami(sheetGenerator, { style: project.style, asset: reference }, runContext);
      } else {
        if (!parent?.prompt || !review) {
          throw new AssetInputError("The review this sheet answers is missing. Start again.");
        }
        run = await runDami(
          sheetFixer,
          {
            style: project.style,
            asset: reference,
            previousPrompt: parent.prompt,
            review: {
              issueCodes: review.issueCodes.filter(isSheetIssue),
              note: review.note ?? undefined,
            },
          },
          runContext,
        );
      }
      await storeSheetPrompt({ sheetId, prompt: run.output.prompt, damiRunId: run.runId });
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

/** sheet-generator → prompt → generation (asset_sheet, the accepted look attached). */
export const assetSheetGenerateHandler = defineHandler(assetSheetGenerate, (payload, context) =>
  produceSheet(payload.sheetId, "generate", assetSheetGenerate, context),
);

/** sheet-fixer on the parent's prompt and review → prompt → generation (asset_sheet). */
export const assetSheetFixHandler = defineHandler(assetSheetFix, (payload, context) =>
  produceSheet(payload.sheetId, "fix", assetSheetFix, context),
);
