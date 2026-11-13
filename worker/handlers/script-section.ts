import { getSectionerAssets } from "../../src/server/assets";
import { latestDetectionAt } from "../../src/server/assets/jobs";
import { hasCurrentBlocksFor, replaceBlocks, setSectioningState } from "../../src/server/blocks";
import { sectionScript } from "../../src/server/damis";
import { defineHandler, scriptSection } from "../../src/server/jobs";
import { reopenProductionAfterScriptEdit } from "../../src/server/production";
import { loadScriptJob, ScriptInputError } from "../../src/server/script";
import { handleFailure } from "./failure";
import { classifyFailure } from "./script-failure";

/**
 * Cuts the accepted script into prompt blocks (sectionScript → replaceBlocks) and marks
 * sectioning done with the number of shots that must be prepared again. A finished film whose
 * shots changed returns to production. Skips a version that is no longer the accepted one.
 *
 * One cut per version (and kind) runs at a time; a re-cut queued while another runs is dropped.
 * So when a correction round applies a new detection during the cut, the cut is made once more
 * with the new list instead of storing blocks that name the old one.
 */
export const scriptSectionHandler = defineHandler(scriptSection, async (payload, context) => {
  const versionId = payload.scriptVersionId;
  const job = await loadScriptJob(versionId);
  if (!job || job.version.status !== "accepted") return;
  const { project, version } = job;
  const done = async (resetBlocks?: number) => {
    await reopenProductionAfterScriptEdit(project.id);
    await setSectioningState({
      projectId: project.id,
      state: "done",
      scriptVersionId: versionId,
      failure: null,
      onlyFor: versionId,
      resetBlocks,
    });
  };
  if (!payload.resection && (await hasCurrentBlocksFor(project.id, versionId))) {
    await done();
    return;
  }
  try {
    if (!project.style) throw new ScriptInputError("Choose the project's style first.");
    if (!version.content) throw new ScriptInputError("The accepted script has no text.");
    const style = project.style;
    const content = version.content;
    const cut = async () => {
      const detectedAt = await latestDetectionAt(project.id);
      const assets = await getSectionerAssets(project.id);
      const result = await sectionScript(
        { style, content, assets },
        { userId: project.ownerId, projectId: project.id, signal: context.signal },
      );
      const latest = await latestDetectionAt(project.id);
      const changed = latest !== null && (detectedAt === null || latest > detectedAt);
      return { result, changed };
    };
    const first = await cut();
    const { result } = first.changed ? await cut() : first;
    const current = await loadScriptJob(versionId);
    if (current?.version.status !== "accepted") return; // edited again meanwhile
    const runFor = (line: number) => {
      const segment = result.segments.find((s) => line >= s.startLine && line <= s.endLine);
      return segment ? result.runIds[segment.index] : undefined;
    };
    const replaced = await replaceBlocks({
      projectId: project.id,
      scriptVersionId: versionId,
      blocks: result.blocks.map((b) => ({ ...b, damiRunId: runFor(b.startLine) })),
      damiRunIds: result.runIds,
    });
    await done(replaced.reset);
  } catch (error) {
    await handleFailure(
      error,
      scriptSection,
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
});
