import { defineHandler, exportBuild } from "../../src/server/jobs";
import { buildExport, failExport } from "../../src/server/production";
import { isLastAttempt } from "./script-failure";

const EXPORT_FAILED = "The ZIP could not be prepared. Try again.";

/**
 * Builds a pending export's ZIP (streamed from and to the object store). An aborted or failed
 * attempt is retried; the last one marks the export failed so the user can ask again.
 */
export const exportBuildHandler = defineHandler(exportBuild, async (payload, context) => {
  try {
    await buildExport(payload.exportId, context.signal);
  } catch (error) {
    if (isLastAttempt(exportBuild, context)) {
      await failExport(payload.exportId, EXPORT_FAILED);
      console.error(
        JSON.stringify({
          time: new Date().toISOString(),
          level: "error",
          msg: "job gave up",
          job: exportBuild.name,
          id: context.jobId,
          attempt: context.attempt,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    throw error;
  }
});
