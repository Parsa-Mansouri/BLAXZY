/** Completing the Production stage. */
import { getDb } from "@/server/db/client";
import { advanceStage, logProjectEvent } from "@/server/projects";
import { openProject, parse } from "./access";
import { ProductionInputError } from "./errors";
import { projectInput } from "./inputs";
import { notFinalMessage } from "./messages";
import { projectStages } from "./views";

/**
 * Moves the project from production to done once every current block has an accepted final.
 * True when this call advanced it; false when the project is not the user's or not in production.
 * Throws `ProductionInputError` while blocks are not done.
 */
export async function completeProduction(input: {
  projectId: string;
  userId: string;
}): Promise<boolean> {
  const { projectId, userId } = parse(projectInput, input);
  return getDb().transaction(async (tx) => {
    const owned = await openProject(tx, projectId, userId, true);
    if (!owned || owned.stage !== "production") return false;
    const { blocks, counts } = await projectStages(tx, projectId);
    if (blocks.length === 0) throw new ProductionInputError("There are no shots yet.");
    if (counts.done !== blocks.length) {
      throw new ProductionInputError(notFinalMessage(blocks.length - counts.done));
    }
    const advanced = await advanceStage({ projectId, from: "production", to: "done" }, tx);
    if (advanced) {
      await logProjectEvent(tx, {
        projectId,
        userId,
        type: "production.completed",
        payload: { blocks: blocks.length },
      });
    }
    return advanced;
  });
}
