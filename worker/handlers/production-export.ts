import { defineHandler, exportBuild, isShutdownAbort } from "../../src/server/jobs";
import { buildExport, failExport } from "../../src/server/production";
import { isLastAttempt, logGaveUp } from "./failure";

export const EXPORT_FAILED = "The ZIP could not be prepared. Try again.";

/**
 * Builds a pending export's ZIP (streamed from and to the object store). An aborted or failed
 * attempt is retried; the last one marks the export failed so the user can ask again (unless the
 * worker is shutting down: then the job runs again).
 */
export const exportBuildHandler = defineHandler(exportBuild, async (payload, context) => {
  try {
    await buildExport(payload.exportId, context.signal);
  } catch (error) {
    if (isLastAttempt(exportBuild, context) && !isShutdownAbort(context.signal)) {
      await failExport(payload.exportId, EXPORT_FAILED);
      logGaveUp(exportBuild, context, error, EXPORT_FAILED);
    }
    throw error;
  }
});
