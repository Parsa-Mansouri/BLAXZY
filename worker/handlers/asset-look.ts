import {
  AssetInputError,
  failLook,
  loadDesignContext,
  loadLookJob,
  markLookNeedsInput,
  requestLookGeneration,
  storeLookDesign,
  applyUploadedLook,
} from "../../src/server/assets";
import { designerFor } from "../../src/server/damis";
import {
  assetLookFix,
  assetLookGenerate,
  defineHandler,
  type JobContext,
  type JobDefinition,
} from "../../src/server/jobs";
import { mergeDamiStyle } from "../../src/server/projects";
import { classifyAssetFailure } from "./asset-failure";
import { runDesigner } from "./asset-design";
import { handleFailure } from "./failure";

/** The project's style descriptor is at most this long (see `projectStyleSchema`). */
const MAX_STYLE_DESCRIPTOR = 2000;

/**
 * Produces a pending look. Without a stored prompt, the asset's designer runs (character,
 * location or prop generator): in fix mode when the look answers a rejected one (the review's
 * fix requests on the previous answer), else in create mode. Its answer is an image to generate
 * (prompt and spec stored, then the generation is requested), the user's own photo as the Hero
 * (in review at once), a blocking question (`needs_input`), or a refusal (failed, with the
 * designer's reason). A look that already has a prompt (a retry after a failed generation, or a
 * re-roll) goes straight to the generation. The completion hook moves it to review.
 */
async function produceLook(lookId: string, job: JobDefinition, context: JobContext): Promise<void> {
  const ctx = await loadLookJob(lookId);
  if (!ctx || ctx.look.status !== "pending") return;
  const { look, asset, project } = ctx;
  try {
    if (asset.status !== "active") throw new AssetInputError("This asset was removed.");
    if (!designerFor(asset.kind)) throw new AssetInputError("Voices are recorded, not generated.");
    const style = project.style;
    if (!style) throw new AssetInputError("Choose the project's style first.");
    if (!look.prompt) {
      const design = await loadDesignContext(asset);
      const outcome = await runDesigner(ctx, design, {
        userId: project.ownerId,
        projectId: project.id,
        signal: context.signal,
      });
      switch (outcome.kind) {
        case "refused":
          await failLook(lookId, outcome.message, outcome.runId);
          return;
        case "question":
          await markLookNeedsInput({ lookId, spec: outcome.spec, damiRunId: outcome.runId });
          return;
        case "uploaded":
          await applyUploadedLook({
            lookId,
            fileId: outcome.fileId,
            spec: outcome.spec,
            damiRunId: outcome.runId,
          });
          return;
        case "generate":
          await storeLookDesign({
            lookId,
            prompt: outcome.prompt,
            spec: outcome.spec,
            damiRunId: outcome.runId,
          });
          // The project's first character resolves its style: every later character, location
          // and prop is designed with that descriptor (a Pro override is for one asset only).
          if (
            outcome.spec.generator === "character-generator" &&
            outcome.spec.styleSource === "project" &&
            !style.styleDescriptor &&
            outcome.spec.styleUsed.trim()
          ) {
            await mergeDamiStyle(
              project.id,
              { styleDescriptor: outcome.spec.styleUsed.trim().slice(0, MAX_STYLE_DESCRIPTOR) },
              { onlyMissing: true },
            );
          }
          break;
      }
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

/** A first design (or an answered question): designer in create mode → generation. */
export const assetLookGenerateHandler = defineHandler(assetLookGenerate, (payload, context) =>
  produceLook(payload.lookId, assetLookGenerate, context),
);

/** A rejected look's next version: designer in fix mode (or a re-roll) → generation. */
export const assetLookFixHandler = defineHandler(assetLookFix, (payload, context) =>
  produceLook(payload.lookId, assetLookFix, context),
);
