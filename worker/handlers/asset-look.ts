import {
  AssetInputError,
  failLook,
  loadLookJob,
  requestLookGeneration,
  storeLookPrompt,
} from "../../src/server/assets";
import {
  assetFixer,
  assetPromptWriter,
  LOOK_ISSUE_CODES,
  runDami,
  type LookIssueCode,
} from "../../src/server/damis";
import {
  assetLookFix,
  assetLookGenerate,
  defineHandler,
  type JobContext,
  type JobDefinition,
} from "../../src/server/jobs";
import { classifyAssetFailure } from "./asset-failure";
import { handleFailure } from "./script-failure";

function isLookIssue(code: string): code is LookIssueCode {
  return (LOOK_ISSUE_CODES as readonly string[]).includes(code);
}

/**
 * Produces a pending look: writes its prompt with a dami unless one is stored (a retry after a
 * failed generation reuses it), then requests the generation. The completion hook moves the look
 * to review. `fix` answers the rejected parent's review with the asset-fixer.
 */
async function produceLook(
  lookId: string,
  mode: "generate" | "fix",
  job: JobDefinition,
  context: JobContext,
): Promise<void> {
  const ctx = await loadLookJob(lookId);
  if (!ctx || ctx.look.status !== "pending") return;
  if ((ctx.look.parentId !== null) !== (mode === "fix")) return; // the other job's look
  const { look, asset, project, parent, review } = ctx;
  try {
    if (asset.status !== "active") throw new AssetInputError("This asset was removed.");
    if (asset.kind === "voice") throw new AssetInputError("Voices are recorded, not generated.");
    if (!project.style) throw new AssetInputError("Choose the project's style first.");
    if (!look.prompt) {
      const reference = {
        kind: asset.kind,
        name: asset.name,
        description: asset.description ?? "",
      };
      const runContext = { userId: project.ownerId, projectId: project.id, signal: context.signal };
      let run: { runId: string; output: { prompt: string } };
      if (mode === "generate") {
        run = await runDami(
          assetPromptWriter,
          {
            style: project.style,
            asset: reference,
            userPrompt: look.userPrompt ?? undefined,
            guidedAnswers: look.guidedAnswers ?? undefined,
          },
          runContext,
        );
      } else {
        if (!parent?.prompt || !review) {
          throw new AssetInputError("The review this image answers is missing. Start again.");
        }
        run = await runDami(
          assetFixer,
          {
            style: project.style,
            asset: reference,
            previousPrompt: parent.prompt,
            review: {
              issueCodes: review.issueCodes.filter(isLookIssue),
              note: review.note ?? undefined,
            },
          },
          runContext,
        );
      }
      await storeLookPrompt({ lookId, prompt: run.output.prompt, damiRunId: run.runId });
    }
    await requestLookGeneration(lookId);
  } catch (error) {
    await handleFailure(
      error,
      job,
      context,
      async (d) => {
        await failLook(lookId, d.message, d.runId);
      },
      classifyAssetFailure,
    );
  }
}

/** asset-prompt-writer → prompt → generation (asset_look). */
export const assetLookGenerateHandler = defineHandler(assetLookGenerate, (payload, context) =>
  produceLook(payload.lookId, "generate", assetLookGenerate, context),
);

/** asset-fixer on the parent's prompt and review → prompt → generation (asset_look). */
export const assetLookFixHandler = defineHandler(assetLookFix, (payload, context) =>
  produceLook(payload.lookId, "fix", assetLookFix, context),
);
