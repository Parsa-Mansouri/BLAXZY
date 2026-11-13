/** Completing the pre-production stage. */
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { advanceStage, logProjectEvent } from "@/server/projects";
import { AssetInputError, parse } from "../service";
import { openProject } from "./access";
import { idSchema, userIdSchema } from "./inputs";
import { readiness, summarise } from "./read";

/**
 * Moves the project from pre-production to production once every active asset is ready. True
 * when this call advanced it; false when the project is not the user's or already moved on.
 * Throws `AssetInputError` while assets are not ready.
 */
export async function completePreProduction(input: {
  projectId: string;
  userId: string;
}): Promise<boolean> {
  const { projectId, userId } = parse(
    z.object({ projectId: idSchema, userId: userIdSchema }),
    input,
  );
  return getDb().transaction(async (tx) => {
    const owned = await openProject(tx, projectId, userId, true);
    if (!owned || owned.stage !== "pre_production") return false;
    const overview = summarise(await readiness(tx, projectId), owned.stage);
    if (overview.total === 0) {
      throw new AssetInputError("There are no assets yet. Wait for detection or add one.");
    }
    if (!overview.canComplete) {
      throw new AssetInputError(
        `Finish every asset first: ${overview.ready} of ${overview.total} are ready.`,
      );
    }
    const advanced = await advanceStage(
      { projectId, from: "pre_production", to: "production" },
      tx,
    );
    if (advanced) {
      await logProjectEvent(tx, {
        projectId,
        userId,
        type: "preproduction.completed",
        payload: {
          assets: overview.total,
        },
      });
    }
    return advanced;
  });
}
