import { getSectionerAssets } from "../../src/server/assets";
import { hasCurrentBlocksFor, replaceBlocks, setSectioningState } from "../../src/server/blocks";
import { sectionScript } from "../../src/server/damis";
import { defineHandler, scriptSection } from "../../src/server/jobs";
import { loadScriptJob, ScriptInputError } from "../../src/server/script";
import { handleFailure } from "./script-failure";

/**
 * Cuts the accepted script into prompt blocks (sectionScript → replaceBlocks) and marks
 * sectioning done. Skips a version that is no longer the accepted one.
 */
export const scriptSectionHandler = defineHandler(scriptSection, async (payload, context) => {
  const versionId = payload.scriptVersionId;
  const job = await loadScriptJob(versionId);
  if (!job || job.version.status !== "accepted") return;
  const { project, version } = job;
  const done = () =>
    setSectioningState({
      projectId: project.id,
      state: "done",
      scriptVersionId: versionId,
      failure: null,
      onlyFor: versionId,
    });
  if (await hasCurrentBlocksFor(project.id, versionId)) {
    await done();
    return;
  }
  try {
    if (!project.style) throw new ScriptInputError("Choose the project's style first.");
    if (!version.content) throw new ScriptInputError("The accepted script has no text.");
    const assets = await getSectionerAssets(project.id);
    const result = await sectionScript(
      { style: project.style, content: version.content, assets },
      { userId: project.ownerId, projectId: project.id, signal: context.signal },
    );
    const current = await loadScriptJob(versionId);
    if (current?.version.status !== "accepted") return; // edited again meanwhile
    const runFor = (line: number) => {
      const segment = result.segments.find((s) => line >= s.startLine && line <= s.endLine);
      return segment ? result.runIds[segment.index] : undefined;
    };
    await replaceBlocks({
      projectId: project.id,
      scriptVersionId: versionId,
      blocks: result.blocks.map((b) => ({ ...b, damiRunId: runFor(b.startLine) })),
      damiRunIds: result.runIds,
    });
    await done();
  } catch (error) {
    await handleFailure(error, scriptSection, context, async (d) => {
      await setSectioningState({
        projectId: project.id,
        state: "failed",
        scriptVersionId: versionId,
        failure: d.message,
        onlyFor: versionId,
      });
    });
  }
});
