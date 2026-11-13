import type { DbExecutor } from "@/server/db/client";
import { projectEvent } from "@/server/db/schema";

/** One `project_event` row (the project's append-only log), on the caller's executor. */
export async function logProjectEvent(
  db: DbExecutor,
  event: {
    projectId: string;
    userId: string | null;
    type: string;
    payload: Record<string, unknown> | null;
  },
): Promise<void> {
  await db.insert(projectEvent).values({
    projectId: event.projectId,
    userId: event.userId,
    type: event.type,
    payload: event.payload,
  });
}
