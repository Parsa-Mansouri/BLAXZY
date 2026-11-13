/** What the worker needs to run the detector and its correction rounds. */
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { assetDetection, project, review, scriptVersion } from "@/server/db/schema";
import { logProjectEvent } from "@/server/projects";
import type { KnownRow } from "../detection";
import { isUuid } from "../preproduction/access";
import { type DetectionRow, knownRows, latestDetection } from "./apply";
import { RESCAN_CODE } from "./review";

/** Worker: the stored assets (with status) and the latest detection of a project. */
export async function loadDetectorState(projectId: string): Promise<{
  rows: KnownRow[];
  latest: DetectionRow | null;
}> {
  return getDb().transaction(async (tx) => ({
    rows: await knownRows(tx, projectId),
    latest: await latestDetection(tx, projectId),
  }));
}

/** True when a full or incremental detection of this script version has been applied. */
export async function hasDetectionFor(
  projectId: string,
  scriptVersionId: string,
): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: assetDetection.id })
    .from(assetDetection)
    .where(
      and(
        eq(assetDetection.projectId, projectId),
        eq(assetDetection.scriptVersionId, scriptVersionId),
        inArray(assetDetection.mode, ["full", "incremental"]),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export type DetectionFixJob = {
  review: typeof review.$inferSelect;
  projectId: string;
  ownerId: string;
  /** The detection the review answers, and whether it is still the latest. */
  detection: DetectionRow;
  isLatest: boolean;
  /** The accepted script version, or null. */
  scriptVersionId: string | null;
  rescan: boolean;
};

/** Worker: what `asset.detect.fix` needs, or null when the review or project is gone. */
export async function loadDetectionFix(reviewId: string): Promise<DetectionFixJob | null> {
  if (!isUuid(reviewId)) return null;
  const db = getDb();
  const [row] = await db
    .select({ review, ownerId: project.ownerId })
    .from(review)
    .innerJoin(project, eq(project.id, review.projectId))
    .where(
      and(
        eq(review.id, reviewId),
        eq(review.subjectType, "asset_detection"),
        isNull(project.archivedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  const [detection] = await db
    .select()
    .from(assetDetection)
    .where(eq(assetDetection.id, row.review.subjectId))
    .limit(1);
  if (!detection) return null;
  const latest = await latestDetection(db, row.review.projectId);
  const [accepted] = await db
    .select({ id: scriptVersion.id })
    .from(scriptVersion)
    .where(
      and(
        eq(scriptVersion.projectId, row.review.projectId),
        isNull(scriptVersion.episodeId),
        eq(scriptVersion.status, "accepted"),
      ),
    )
    .orderBy(desc(scriptVersion.versionNumber))
    .limit(1);
  return {
    review: row.review,
    projectId: row.review.projectId,
    ownerId: row.ownerId,
    detection,
    isLatest: latest?.id === detection.id,
    scriptVersionId: accepted?.id ?? null,
    rescan: row.review.issueCodes.includes(RESCAN_CODE),
  };
}

/** True when a detection newer than the review exists (the fix already ran). */
export async function detectionAnswered(reviewId: string, projectId: string): Promise<boolean> {
  const db = getDb();
  const [r] = await db.select().from(review).where(eq(review.id, reviewId)).limit(1);
  if (!r) return true;
  const [newer] = await db
    .select({ id: assetDetection.id })
    .from(assetDetection)
    .where(and(eq(assetDetection.projectId, projectId), gt(assetDetection.createdAt, r.createdAt)))
    .limit(1);
  return newer !== undefined;
}

/** Records that a correction round failed (shown on the category screens). */
export async function recordFixFailure(
  projectId: string,
  reviewId: string,
  failure: string,
): Promise<void> {
  await logProjectEvent(getDb(), {
    projectId,
    userId: null,
    type: "assets.fix-failed",
    payload: { reviewId, failure },
  });
}
