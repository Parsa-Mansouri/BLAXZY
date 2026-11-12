import {
  applyDetection,
  detectionAnswered,
  loadDetectionFix,
  loadDetectorState,
  recordFixFailure,
  tempIdsFor,
} from "../../src/server/assets";
import { setSectioningState } from "../../src/server/blocks";
import { assetDetectFix, defineHandler, enqueue, scriptSection } from "../../src/server/jobs";
import { loadScriptJob, ScriptInputError } from "../../src/server/script";
import { detectorProject, detectorScript, runDetector, viewFor } from "./asset-detection";
import { handleFailure } from "./script-failure";

/**
 * One correction round of the detected list: the Asset Detector in fix mode, with the stored
 * assets rebuilt as `previous_output` (temporary ids for this run only) and the review's fix
 * requests (targets translated from names to those ids); or, for a re-scan (ADR01), an
 * incremental run over the accepted script. The result is applied like any detection.
 */
export const assetDetectFixHandler = defineHandler(assetDetectFix, async (payload, context) => {
  const job = await loadDetectionFix(payload.reviewId);
  if (!job || (await detectionAnswered(payload.reviewId, job.projectId))) return;
  try {
    if (!job.scriptVersionId) throw new ScriptInputError("There is no accepted script to read.");
    const script = await loadScriptJob(job.scriptVersionId);
    if (!script?.project.style) throw new ScriptInputError("Choose the project's style first.");
    const state = await loadDetectorState(job.projectId);
    const sceneIndex = state.latest?.sceneIndex ?? [];
    const requests = job.review.fixRequests;
    const mode = job.rescan || requests.length === 0 ? "incremental" : "fix";
    const view = viewFor(state.rows, sceneIndex, mode);
    const note = job.review.note ? [job.review.note] : [];
    const run = await runDetector(
      {
        mode,
        project: detectorProject(script.project.style, "wizard"),
        script: detectorScript(script.version),
        known_assets: view.known,
        ...(mode === "fix"
          ? {
              previous_output: view.previousOutput,
              fix_requests: requests.map((r, i) => ({
                type: r.type,
                code: r.code,
                instruction: r.instruction,
                target_ids: tempIdsFor(r.targetNames ?? [], view.tempByName),
                ...(r.customText || (i === 0 && note[0])
                  ? {
                      custom_text: [r.customText, i === 0 ? note[0] : undefined]
                        .filter(Boolean)
                        .join("\n"),
                    }
                  : {}),
              })),
            }
          : {}),
      },
      { userId: job.ownerId, projectId: job.projectId, signal: context.signal },
    );
    if (await detectionAnswered(payload.reviewId, job.projectId)) return;
    await applyDetection({
      projectId: job.projectId,
      scriptVersionId: job.scriptVersionId,
      damiRunId: run.runId,
      mode,
      output: run.output,
      byTemp: view.byTemp,
    });
    // The blocks are cut again so they name the corrected list (as after the first detection).
    await setSectioningState({
      projectId: job.projectId,
      state: "running",
      scriptVersionId: job.scriptVersionId,
      failure: null,
    });
    await enqueue(scriptSection, { scriptVersionId: job.scriptVersionId, resection: true });
  } catch (error) {
    await handleFailure(error, assetDetectFix, context, async (d) => {
      await recordFixFailure(job.projectId, payload.reviewId, d.message);
    });
  }
});
