import { runDami, scriptWriter } from "../../src/server/damis";
import { defineHandler, scriptWrite } from "../../src/server/jobs";
import {
  completeScriptVersion,
  failScriptVersion,
  loadScriptJob,
  ScriptInputError,
} from "../../src/server/script";
import { handleFailure } from "./script-failure";

/** Writes a script from the brief: script-writer → content, title, logline, notes → in_review. */
export const scriptWriteHandler = defineHandler(scriptWrite, async (payload, context) => {
  const versionId = payload.scriptVersionId;
  const job = await loadScriptJob(versionId);
  if (!job || job.version.status !== "pending" || !job.isLatest) return;
  const { project, version } = job;
  try {
    if (!project.style) throw new ScriptInputError("Choose the project's style first.");
    if (!version.brief) throw new ScriptInputError("This version has no brief to write from.");
    const run = await runDami(
      scriptWriter,
      { style: project.style, brief: version.brief },
      { userId: project.ownerId, projectId: project.id, signal: context.signal },
    );
    const { title, logline, content, notes } = run.output;
    if (!content.trim()) {
      const reason = notes.join(" ") || "no reason was given";
      await failScriptVersion(versionId, `The script could not be written: ${reason}`, run.runId);
      return;
    }
    await completeScriptVersion({
      versionId,
      content,
      damiRunId: run.runId,
      notes: { title, logline, notes },
    });
  } catch (error) {
    await handleFailure(error, scriptWrite, context, async (d) => {
      await failScriptVersion(versionId, d.message, d.runId);
    });
  }
});
