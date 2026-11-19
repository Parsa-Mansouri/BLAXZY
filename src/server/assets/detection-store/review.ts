/**
 * The review loop of the category screens ("Something wrong with this list?"): the panel they
 * show, and a correction round.
 */
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { freeTextFixRequest, getReviewCatalog, parseAssetRef } from "@/server/damis";
import { getDb } from "@/server/db/client";
import { asset, projectEvent, review } from "@/server/db/schema";
import { assetDetectFix, enqueue } from "@/server/jobs";
import { logLine } from "@/server/log";
import { findOwnedProject, logProjectEvent } from "@/server/projects";
import { visibleWarnings } from "../detection";
import { assertPreProductionOpen } from "../preproduction/access";
import { ENQUEUE_FAILURE, wakeOnTx } from "../preproduction/enqueue";
import { AssetInputError, parse } from "../service";
import { latestDetection } from "./apply";

const CATALOG_KEY = "asset-detector" as const;

/** The re-scan action (ADR01): the whole script again; stored in `issue_codes` to tell the worker. */
export const RESCAN_CODE = "ADR01";

/** The longest change request, in characters. */
export const MAX_DETECTION_NOTE = 2000;

export type DetectionWarning = {
  /** MERGE_CHECK, NO_LOCATION, AMBIGUOUS, REAL_PERSON, APPROVED_CONFLICT, NOT_IN_SCRIPT ... */
  tag: string;
  text: string;
};

export type DetectionPanel = {
  warnings: DetectionWarning[];
  /** Correction rounds asked for so far (for the "edit by hand" suggestion). */
  rounds: number;
  maxRounds: number;
  suggestion: string | null;
  /** A correction or re-scan is running. */
  busy: boolean;
  /** The last correction round failed (user-readable). */
  failure: string | null;
};

function splitWarning(w: string): DetectionWarning {
  const match = /^([A-Z_]+):\s*(.*)$/s.exec(w);
  return match ? { tag: match[1] ?? "", text: match[2] ?? w } : { tag: "NOTE", text: w };
}

async function ownedProject(projectId: string, userId: string) {
  return findOwnedProject(getDb(), projectId, userId);
}

/** What the category screens show about the detected list. */
export async function getDetectionPanel(
  projectId: string,
  userId: string,
): Promise<DetectionPanel | null> {
  const owned = await ownedProject(projectId, userId);
  if (!owned) return null;
  const catalog = getReviewCatalog(CATALOG_KEY);
  const db = getDb();
  const latest = await latestDetection(db, projectId);
  const [rounds] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(review)
    .where(and(eq(review.projectId, projectId), eq(review.subjectType, "asset_detection")));
  const [lastReview] = await db
    .select({ id: review.id, createdAt: review.createdAt })
    .from(review)
    .where(and(eq(review.projectId, projectId), eq(review.subjectType, "asset_detection")))
    .orderBy(desc(review.createdAt))
    .limit(1);
  let busy = false;
  let failure: string | null = null;
  if (lastReview && (!latest || latest.createdAt < lastReview.createdAt)) {
    const [failed] = await db
      .select({ payload: projectEvent.payload })
      .from(projectEvent)
      .where(
        and(
          eq(projectEvent.projectId, projectId),
          eq(projectEvent.type, "assets.fix-failed"),
          gt(projectEvent.createdAt, lastReview.createdAt),
        ),
      )
      .limit(1);
    if (failed) {
      const payload = failed.payload as { failure?: unknown } | null;
      failure = typeof payload?.failure === "string" ? payload.failure : "The correction failed.";
    } else busy = true;
  }
  const maxRounds = catalog.maxAttemptsBeforeSuggestion ?? 4;
  const n = rounds?.n ?? 0;
  return {
    warnings: visibleWarnings(latest?.warnings ?? []).map(splitWarning),
    rounds: n,
    maxRounds,
    suggestion:
      n >= maxRounds
        ? "This list has been corrected several times. Rename, remove or add assets yourself; it is quicker."
        : null,
    busy,
    failure,
  };
}

const NOT_AN_ASSET = "One of the chosen assets is not on the list. Reload the page.";

const reviewSchema = z.object({
  projectId: z.string().max(100),
  userId: z.string().min(1).max(128),
  note: z.string().trim().max(MAX_DETECTION_NOTE, "Keep it under 2,000 characters.").optional(),
  rescan: z.boolean().optional(),
});

/**
 * One "Something wrong with this list?" round, in the user's own words. The note is recorded as a
 * review of the latest detection and sent to the Asset Detector in fix mode as one free-text fix
 * request (the owner's "Other", ADP99, with the note as its custom text), run by `asset.detect.fix`.
 * `rescan` (the action, no words needed) runs the detector again over the whole script instead
 * (incremental, known assets kept). Returns whether a round started.
 */
export async function submitDetectionReview(input: {
  projectId: string;
  userId: string;
  note?: string;
  rescan?: boolean;
}): Promise<{ started: boolean } | null> {
  const parsed = parse(reviewSchema, input);
  const note = parsed.note ? parsed.note : null;
  const rescan = parsed.rescan === true;
  if (!rescan && !note) throw new AssetInputError("Tell us what to change: write a note.");
  const owned = await ownedProject(parsed.projectId, parsed.userId);
  if (!owned) return null;
  assertPreProductionOpen(owned);
  const requests = rescan || !note ? [] : [freeTextFixRequest(CATALOG_KEY, note)];

  const outcome = await getDb().transaction(async (tx) => {
    // The project row first (the lock order of every asset writer), with ownership and stage.
    const locked = await findOwnedProject(tx, parsed.projectId, parsed.userId, {
      lock: "no-key-update",
    });
    if (!locked) return null;
    assertPreProductionOpen(locked);
    const latest = await latestDetection(tx, parsed.projectId);
    if (!latest) {
      throw new AssetInputError("The assets have not been detected yet. Wait for the list first.");
    }
    const [row] = await tx
      .insert(review)
      .values({
        projectId: parsed.projectId,
        userId: parsed.userId,
        subjectType: "asset_detection",
        subjectId: latest.id,
        decision: "rejected",
        issueCodes: rescan ? [RESCAN_CODE] : [],
        fixRequests: requests,
        note,
        damiRunId: latest.damiRunId,
      })
      .returning({ id: review.id });
    if (!row) throw new Error("review insert returned no row");
    // The fix job is sent with the review: the panel never shows a round as running without it.
    try {
      await enqueue(assetDetectFix, { reviewId: row.id }, { tx });
    } catch (error) {
      logLine("error", "could not enqueue", { job: assetDetectFix.name, exception: error });
      throw new AssetInputError(ENQUEUE_FAILURE);
    }
    return { reviewId: row.id };
  });
  if (!outcome) return null;
  return { started: true };
}

const skipSchema = z.object({
  projectId: z.string().max(100),
  userId: z.string().min(1).max(128),
  refs: z.array(z.string().min(1).max(300)).min(1).max(50),
});

/**
 * "Not needed as its own asset" (the owner's ADP01): the assets' priority is set to skipped, no
 * dami. Each target is a \`kind:Name\` ref; anything else is refused before it reaches the database.
 * Returns how many assets were skipped.
 */
export async function skipDetectedAssets(input: {
  projectId: string;
  userId: string;
  refs: string[];
}): Promise<{ skipped: number } | null> {
  const parsed = parse(skipSchema, input);
  const targets = parsed.refs.map((ref) => {
    const target = parseAssetRef(ref);
    if (!target) throw new AssetInputError(NOT_AN_ASSET);
    return target;
  });
  const owned = await ownedProject(parsed.projectId, parsed.userId);
  if (!owned) return null;
  assertPreProductionOpen(owned);
  return getDb().transaction(async (tx) => {
    const locked = await findOwnedProject(tx, parsed.projectId, parsed.userId, {
      lock: "no-key-update",
    });
    if (!locked) return null;
    assertPreProductionOpen(locked);
    let skipped = 0;
    let skippedLocation = false;
    for (const target of targets) {
      const updated = await tx
        .update(asset)
        .set({ priority: "skipped" })
        .where(
          and(
            eq(asset.projectId, parsed.projectId),
            eq(asset.kind, target.kind),
            sql`lower(${asset.name}) = lower(${target.name})`,
          ),
        )
        .returning({ id: asset.id });
      skipped += updated.length;
      if (updated.length > 0 && target.kind === "location") skippedLocation = true;
    }
    if (skipped > 0) {
      await logProjectEvent(tx, {
        projectId: parsed.projectId,
        userId: parsed.userId,
        type: "assets.skipped",
        payload: { refs: parsed.refs },
      });
    }
    // A skipped location is not designed: props waiting for it go ahead without it.
    if (skippedLocation) await wakeOnTx(tx, parsed.projectId);
    return { skipped };
  });
}
