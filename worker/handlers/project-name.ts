import { projectNamer, runDami } from "../../src/server/damis";
import { defineHandler, projectName } from "../../src/server/jobs";
import { logLine } from "../../src/server/jobs/log";
import { applyAutoName, loadProjectNameJob } from "../../src/server/projects";
import { classifyDamiFailure, handleFailure, type FailureCopy } from "./failure";

/** A name that could not be made is not shown to anyone: the project keeps "Untitled project". */
const NAME_FAILURE_COPY: FailureCopy = {
  userErrors: [],
  credits: false,
  refusal: "Claude declined to name the project.",
  truncated: "The project name came out too long to finish.",
  invalidInput: "The project name could not be made from this story.",
  notConfigured: "Project names are not set up on this server (the Claude API key is missing).",
  fallback: "Something went wrong while naming the project.",
};

/**
 * Names a project from its first story, once: project-namer → title with source `auto`. Does
 * nothing unless the title is still the placeholder, and the update is conditional on that, so a
 * rename by the user (before or while this runs) always wins. A failure is only logged.
 */
export const projectNameHandler = defineHandler(projectName, async (payload, context) => {
  const job = await loadProjectNameJob(payload.projectId, payload.scriptVersionId);
  if (!job?.input) return;
  try {
    const run = await runDami(projectNamer, job.input, {
      userId: job.ownerId,
      projectId: job.projectId,
      signal: context.signal,
    });
    await applyAutoName({
      projectId: job.projectId,
      title: run.output.title,
      damiRunId: run.runId,
    });
  } catch (error) {
    await handleFailure(
      error,
      projectName,
      context,
      async (decision) => {
        logLine("warn", "project not named", {
          projectId: job.projectId,
          reason: decision.message,
          runId: decision.runId,
        });
      },
      (e) => classifyDamiFailure(e, NAME_FAILURE_COPY),
    );
  }
});
