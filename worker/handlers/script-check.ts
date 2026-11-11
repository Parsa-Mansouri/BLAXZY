import { runDami, scriptChecker } from "../../src/server/damis";
import { defineHandler, scriptCheck } from "../../src/server/jobs";
import {
  completeScriptVersion,
  extractScriptText,
  failScriptVersion,
  loadScriptJob,
  ScriptInputError,
} from "../../src/server/script";
import { readFileBytes } from "../../src/server/storage";
import { handleFailure } from "./script-failure";

/** Checks an upload: extract the text → script-checker → content and findings → in_review. */
export const scriptCheckHandler = defineHandler(scriptCheck, async (payload, context) => {
  const versionId = payload.scriptVersionId;
  const job = await loadScriptJob(versionId);
  if (!job || job.version.status !== "pending" || !job.isLatest) return;
  const { project, file } = job;
  try {
    if (!project.style) throw new ScriptInputError("Choose the project's style first.");
    if (!file || file.status !== "ready") {
      throw new ScriptInputError("The uploaded file is no longer available. Upload it again.");
    }
    const bytes = await readFileBytes(file.id, { signal: context.signal });
    const content = await extractScriptText(bytes, file.mimeType, file.originalName ?? "script");
    const run = await runDami(
      scriptChecker,
      { style: project.style, content },
      { userId: project.ownerId, projectId: project.id, signal: context.signal },
    );
    const { verdict, summary, issues } = run.output;
    await completeScriptVersion({
      versionId,
      content,
      damiRunId: run.runId,
      notes: { check: { verdict, summary, issues } },
    });
  } catch (error) {
    await handleFailure(error, scriptCheck, context, async (d) => {
      await failScriptVersion(versionId, d.message, d.runId);
    });
  }
});
