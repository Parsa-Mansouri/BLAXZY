import {
  runDami,
  SCRIPT_ISSUE_CODES,
  scriptReviser,
  type ScriptIssueCode,
} from "../../src/server/damis";
import { defineHandler, scriptRevise } from "../../src/server/jobs";
import {
  completeScriptVersion,
  failScriptVersion,
  loadScriptJob,
  readScriptNotes,
  ScriptInputError,
} from "../../src/server/script";
import { handleFailure } from "./script-failure";

function isIssueCode(code: string): code is ScriptIssueCode {
  return (SCRIPT_ISSUE_CODES as readonly string[]).includes(code);
}

/** Revises the rejected parent from its review: script-reviser → content, change summary. */
export const scriptReviseHandler = defineHandler(scriptRevise, async (payload, context) => {
  const versionId = payload.scriptVersionId;
  const job = await loadScriptJob(versionId);
  if (!job || job.version.status !== "pending" || !job.isLatest) return;
  const { project, parent, review } = job;
  try {
    if (!project.style) throw new ScriptInputError("Choose the project's style first.");
    if (!parent?.content || !review) {
      throw new ScriptInputError("The review this revision answers is missing. Start again.");
    }
    const run = await runDami(
      scriptReviser,
      {
        style: project.style,
        content: parent.content,
        review: {
          issueCodes: review.issueCodes.filter(isIssueCode),
          note: review.note ?? undefined,
          comments: review.comments,
        },
      },
      { userId: project.ownerId, projectId: project.id, signal: context.signal },
    );
    const parentNotes = readScriptNotes(parent.damiNotes);
    await completeScriptVersion({
      versionId,
      content: run.output.content,
      damiRunId: run.runId,
      notes: {
        title: parentNotes.title ?? null,
        logline: parentNotes.logline ?? null,
        changeSummary: run.output.changeSummary,
        edits: run.output.edits,
      },
    });
  } catch (error) {
    await handleFailure(error, scriptRevise, context, async (d) => {
      await failScriptVersion(versionId, d.message, d.runId);
    });
  }
});
