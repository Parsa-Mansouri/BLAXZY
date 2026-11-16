import { defineHandler, takeReview } from "../../src/server/jobs";
import { failTakeReview, runTakeCheck } from "../../src/server/production";
import { handleFailure } from "./failure";
import { classifyProductionFailure } from "./production-failure";

/**
 * The Video Review of a generated clip (`runTakeCheck`): frames, the dami's report, the last frame.
 * The take is already in review and the user may decide on it at once, so a failure never blocks
 * anything: once the attempts are used up the review is marked `failed` and the screen shows the
 * clip without findings.
 */
export const takeReviewHandler = defineHandler(takeReview, async (payload, context) => {
  try {
    await runTakeCheck(payload.takeId, { signal: context.signal });
  } catch (error) {
    await handleFailure(
      error,
      takeReview,
      context,
      async () => {
        await failTakeReview(payload.takeId);
      },
      classifyProductionFailure,
    );
  }
});
