import { cinematographer, runDami, type SceneVisual } from "../../src/server/damis";
import {
  failDirection,
  isDirectionOpen,
  loadSceneBatchJob,
  saveSceneBatch,
  saveSceneProgress,
  sceneInputFor,
} from "../../src/server/direction";
import { setSectioningState } from "../../src/server/blocks";
import { defineHandler, directionScene } from "../../src/server/jobs";
import { ScriptInputError } from "../../src/server/script";
import { handleFailure } from "./failure";
import { classifyFailure } from "./script-failure";

/**
 * Lights one batch of scenes of a craft run: the cinematographer's `scene` mode for each scene of
 * the batch, in order. Each lit scene is saved on the batch row as it finishes, so a retry only
 * runs the scenes still missing. Batches of one run run in parallel; the one that finishes last
 * runs the Breakdown and queues the write batches (`saveSceneBatch`, one transaction). A batch of
 * a run that was superseded or failed is skipped; a batch already stored is skipped. A batch that
 * fails for good fails the whole run (the user retries it as a whole).
 */
export const directionSceneHandler = defineHandler(directionScene, async (payload, context) => {
  const { directionId, batchIndex } = payload;
  const job = await loadSceneBatchJob(directionId, batchIndex);
  if (!job || job.batch.status !== "pending" || !(await isDirectionOpen(directionId))) return;
  const { direction } = job;
  const fail = async (message: string, runId: string | null) => {
    const { failed } = await failDirection(directionId, message, runId);
    if (failed) {
      await setSectioningState({
        projectId: direction.projectId,
        state: "failed",
        scriptVersionId: direction.scriptVersionId,
        failure: message,
        onlyFor: direction.scriptVersionId,
      });
    }
  };
  try {
    const craft = job.context.craft;
    if (!craft) throw new ScriptInputError("The craft of this run is missing. Try again.");
    const scenes: SceneVisual[] = [...job.done];
    for (const sceneId of job.sceneIds) {
      if (scenes.some((s) => s.scene_id === sceneId)) continue;
      const run = await runDami(
        cinematographer,
        sceneInputFor({
          plan: job.shotPlan,
          registry: job.context.asset_registry,
          look: job.look,
          cinematographerId: craft.cinematographerId,
          sceneId,
        }),
        { userId: job.ownerId, projectId: direction.projectId, signal: context.signal },
      );
      if (run.output.mode !== "scene") {
        throw new Error("The cinematographer answered the wrong mode.");
      }
      scenes.push(run.output.scene);
      await saveSceneProgress({ directionId, batchIndex, scenes, runId: run.runId });
    }
    await saveSceneBatch({ directionId, batchIndex, scenes });
  } catch (error) {
    await handleFailure(
      error,
      directionScene,
      context,
      (d) => fail(d.message, d.runId),
      classifyFailure,
    );
  }
});
