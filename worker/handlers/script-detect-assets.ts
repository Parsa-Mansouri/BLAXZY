import { applyDetection, getKnownAssets, hasDetectionFor } from "../../src/server/assets";
import { hasCurrentBlocksFor, markBlocksStale, setSectioningState } from "../../src/server/blocks";
import { assetDetector, runDami } from "../../src/server/damis";
import { defineHandler, enqueue, scriptDetectAssets, scriptSection } from "../../src/server/jobs";
import { loadScriptJob, ScriptInputError } from "../../src/server/script";
import { handleFailure } from "./script-failure";

/**
 * Detects the assets of the accepted script as a diff, marks the old blocks stale, then queues
 * sectioning. Skips a version that is no longer the accepted one.
 */
export const scriptDetectAssetsHandler = defineHandler(
  scriptDetectAssets,
  async (payload, context) => {
    const versionId = payload.scriptVersionId;
    const job = await loadScriptJob(versionId);
    if (!job || job.version.status !== "accepted") return;
    const { project, version } = job;
    if (await hasDetectionFor(project.id, versionId)) {
      // Done before (a retry after a crash): make sure sectioning was queued.
      if (!(await hasCurrentBlocksFor(project.id, versionId))) {
        await enqueue(scriptSection, { scriptVersionId: versionId });
      }
      return;
    }
    try {
      if (!project.style) throw new ScriptInputError("Choose the project's style first.");
      if (!version.content) throw new ScriptInputError("The accepted script has no text.");
      await markBlocksStale({
        projectId: project.id,
        reason: `The script changed (version ${version.versionNumber}).`,
      });
      const knownAssets = await getKnownAssets(project.id);
      const run = await runDami(
        assetDetector,
        { style: project.style, content: version.content, knownAssets },
        { userId: project.ownerId, projectId: project.id, signal: context.signal },
      );
      const current = await loadScriptJob(versionId);
      if (current?.version.status !== "accepted") return; // edited again meanwhile
      await applyDetection({
        projectId: project.id,
        scriptVersionId: versionId,
        damiRunId: run.runId,
        assets: run.output.assets,
      });
      await enqueue(scriptSection, { scriptVersionId: versionId });
    } catch (error) {
      await handleFailure(error, scriptDetectAssets, context, async (d) => {
        await setSectioningState({
          projectId: project.id,
          state: "failed",
          scriptVersionId: versionId,
          failure: d.message,
          onlyFor: versionId,
        });
      });
    }
  },
);
