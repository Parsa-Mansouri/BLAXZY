/** What the Script screens read. */
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { damiRun, project, scriptVersion } from "@/server/db/schema";
import { loadView, ownedProject, projectScope } from "./internal";
import { MAX_LISTED_VERSIONS, uuidSchema } from "./schemas";
import { type ScriptVersionSummary, type ScriptVersionView, toView } from "./views";

export type ScriptState = {
  /** The latest version. */
  current: ScriptVersionView | null;
  /** The accepted version, if any. */
  accepted: ScriptVersionView | null;
  /** The most recent versions, newest first (at most MAX_LISTED_VERSIONS). */
  versions: ScriptVersionSummary[];
  /** A job for the latest version is in flight (it is pending). */
  busy: boolean;
};

export async function getScriptState(
  projectId: string,
  userId: string,
): Promise<ScriptState | null> {
  if (!(await ownedProject(projectId, userId))) return null;
  const db = getDb();
  const versions = await db
    .select({
      id: scriptVersion.id,
      versionNumber: scriptVersion.versionNumber,
      status: scriptVersion.status,
      source: scriptVersion.source,
      createdAt: scriptVersion.createdAt,
    })
    .from(scriptVersion)
    .where(projectScope(projectId))
    .orderBy(desc(scriptVersion.versionNumber))
    .limit(MAX_LISTED_VERSIONS);
  const latest = versions[0];
  const current = latest ? await loadView(latest.id) : null;
  const [acceptedRow] = await db
    .select({ id: scriptVersion.id })
    .from(scriptVersion)
    .where(and(projectScope(projectId), eq(scriptVersion.status, "accepted")))
    .orderBy(desc(scriptVersion.versionNumber))
    .limit(1);
  const accepted = acceptedRow
    ? acceptedRow.id === current?.id
      ? current
      : await loadView(acceptedRow.id)
    : null;
  return { current, accepted, versions, busy: current?.status === "pending" };
}

/** One version of one of the user's projects. */
export async function getScriptVersion(
  versionId: string,
  userId: string,
): Promise<ScriptVersionView | null> {
  if (!uuidSchema.safeParse(versionId).success) return null;
  const [row] = await getDb()
    .select({ version: scriptVersion, model: damiRun.model })
    .from(scriptVersion)
    .innerJoin(project, eq(project.id, scriptVersion.projectId))
    .leftJoin(damiRun, eq(damiRun.id, scriptVersion.damiRunId))
    .where(
      and(eq(scriptVersion.id, versionId), eq(project.ownerId, userId), isNull(project.archivedAt)),
    )
    .limit(1);
  return row ? toView(row.version, row.model) : null;
}
