/**
 * The one ownership check of a project: the services' own checks (`getProjectForUser`, the script,
 * assets, blocks and production variants) are thin wrappers over `findOwnedProject`, each keeping
 * its stage assertion and its lock strength.
 */
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DbExecutor } from "@/server/db/client";
import { project } from "@/server/db/schema";

const uuid = z.uuid();

/**
 * Row lock taken on the project: `update` (`FOR UPDATE`) or `no-key-update` (`FOR NO KEY UPDATE`,
 * which leaves inserts of rows referencing the project unblocked). Only inside a transaction.
 */
export type ProjectLock = "update" | "no-key-update";

/**
 * The project when `userId` owns it and it is not archived, else null (also for an id that is not
 * a uuid, before any query). With `lock`, the row is locked in the caller's transaction.
 */
export async function findOwnedProject(
  db: DbExecutor,
  projectId: string,
  userId: string,
  options: { lock?: ProjectLock } = {},
): Promise<typeof project.$inferSelect | null> {
  if (!uuid.safeParse(projectId).success) return null;
  const query = db
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.ownerId, userId), isNull(project.archivedAt)))
    .limit(1);
  const [row] =
    options.lock === "update"
      ? await query.for("update")
      : options.lock === "no-key-update"
        ? await query.for("no key update")
        : await query;
  return row ?? null;
}
