import { applyDetection, hasDetectionFor, loadDetectorState } from "../../src/server/assets";
import { hasCurrentBlocksFor, markBlocksStale, setSectioningState } from "../../src/server/blocks";
import { defineHandler, enqueue, scriptDetectAssets, scriptSection } from "../../src/server/jobs";
import { loadScriptJob, ScriptInputError } from "../../src/server/script";
import { detectorProject, detectorScript, runDetector, viewFor } from "./asset-detection";
import { handleFailure } from "./failure";
import { classifyFailure } from "./script-failure";

/**
 * Detects the assets of the accepted script with Asset Detector v1, applies the result, marks the
 * old blocks stale, then queues sectioning. The first detection is full; later ones (an edited
 * script) are incremental with every stored asset as `known_assets` (approved ones keep their
 * names). Skips a version that is no longer the accepted one.
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
      const state = await loadDetectorState(project.id);
      const hasDetected = state.rows.some(
        (r) => r.asset.status === "active" && r.asset.origin === "detected",
      );
      const mode = hasDetected ? "incremental" : "full";
      const view = viewFor(state.rows, state.latest?.sceneIndex ?? [], mode);
      const run = await runDetector(
        {
          mode,
          project: detectorProject(project.style, "wizard"),
          script: detectorScript(version),
          ...(mode === "incremental" ? { known_assets: view.known } : {}),
        },
        { userId: project.ownerId, projectId: project.id, signal: context.signal },
      );
      const current = await loadScriptJob(versionId);
      if (current?.version.status !== "accepted") return; // edited again meanwhile
      await applyDetection({
        projectId: project.id,
        scriptVersionId: versionId,
        damiRunId: run.runId,
        mode,
        output: run.output,
        byTemp: view.byTemp,
      });
      await enqueue(scriptSection, { scriptVersionId: versionId });
    } catch (error) {
      await handleFailure(
        error,
        scriptDetectAssets,
        context,
        async (d) => {
          await setSectioningState({
            projectId: project.id,
            state: "failed",
            scriptVersionId: versionId,
            failure: d.message,
            onlyFor: versionId,
          });
        },
        classifyFailure,
      );
    }
  },
);
