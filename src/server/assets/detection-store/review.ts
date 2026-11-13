/**
 * The review loop of the category screens ("Something wrong with this list?"): the panel they
 * show, and a correction round.
 */
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  buildFixRequests,
  fixRequestCodes,
  type FixSelection,
  getReviewCatalog,
  parseAssetRef,
  ReviewCatalogError,
  type ReviewOption,
  visibleOptions,
} from "@/server/damis";
import { getDb } from "@/server/db/client";
import { asset, projectEvent, review, type ReviewFixRequest } from "@/server/db/schema";
import { assetDetectFix, enqueue } from "@/server/jobs";
import { findOwnedProject, logProjectEvent } from "@/server/projects";
import { visibleWarnings } from "../detection";
import { assertPreProductionOpen } from "../preproduction/access";
import { ENQUEUE_FAILURE, wakeOnTx } from "../preproduction/enqueue";
import { AssetInputError, parse } from "../service";
import { latestDetection } from "./apply";

const CATALOG_KEY = "asset-detector" as const;

/** Codes that need no dami: skip (ADP01). Rename, delete, add and merge use their own actions. */
const SKIP_CODE = "ADP01";

export const RESCAN_CODE = "ADR01";

export type DetectionWarning = {
  /** MERGE_CHECK, NO_LOCATION, AMBIGUOUS, REAL_PERSON, APPROVED_CONFLICT, NOT_IN_SCRIPT ... */
  tag: string;
  text: string;
};

export type DetectionPanel = {
  /** The options the Wizard shows, from the owner's catalog. */
  options: ReviewOption[];
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
    options: visibleOptions(catalog, { sector: owned.mode === "pro" ? "pro" : "wizard" }),
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

const selectionSchema = z.object({
  code: z.string().trim().min(1).max(20),
  value: z.string().trim().max(200).optional(),
  customText: z.string().trim().max(4000).optional(),
  targetNames: z.array(z.string().min(1).max(300)).max(50).optional(),
});

const NOT_AN_ASSET = "One of the chosen assets is not on the list. Reload the page.";

const submitSchema = z.object({
  projectId: z.string().max(100),
  userId: z.string().min(1).max(128),
  selections: z.array(selectionSchema).min(1, "Pick what is wrong first.").max(20),
  note: z.string().trim().max(8000).optional(),
});

/**
 * One "Something wrong with this list?" round. Skip (ADP01) sets the targets' priority to
 * skipped (no dami). Re-scan (ADR01) and the dami fixes (ADT…, ADP02…) are recorded as a review
 * of the latest detection, with the fix requests built from the owner's catalog (targets as
 * `kind:Name` refs), and run by `asset.detect.fix`. Returns what was started.
 */
export async function submitDetectionReview(input: {
  projectId: string;
  userId: string;
  selections: FixSelection[];
  note?: string;
}): Promise<{ skipped: number; started: boolean } | null> {
  const parsed = parse(submitSchema, input);
  const owned = await ownedProject(parsed.projectId, parsed.userId);
  if (!owned) return null;
  assertPreProductionOpen(owned);
  const catalog = getReviewCatalog(CATALOG_KEY);
  const allowed = new Set(
    visibleOptions(catalog, { sector: owned.mode === "pro" ? "pro" : "wizard" }).map((o) => o.code),
  );
  for (const s of parsed.selections) {
    if (!allowed.has(s.code))
      throw new AssetInputError("One of the chosen fixes is not available.");
  }
  const skip = parsed.selections.filter((s) => s.code === SKIP_CODE);
  // Each target is a `kind:Name` ref; anything else is refused before it reaches the database.
  const skipRefs = skip.flatMap((s) =>
    (s.targetNames ?? []).map((ref) => {
      const target = parseAssetRef(ref);
      if (!target) throw new AssetInputError(NOT_AN_ASSET);
      return target;
    }),
  );
  const rescan = parsed.selections.some((s) => s.code === RESCAN_CODE);
  let requests: ReviewFixRequest[];
  try {
    requests = buildFixRequests(
      catalog,
      parsed.selections.filter((s) => s.code !== SKIP_CODE && s.code !== RESCAN_CODE),
    );
  } catch (error) {
    if (error instanceof ReviewCatalogError) {
      throw new AssetInputError("Say a little more about what is wrong, then try again.");
    }
    throw error;
  }
  for (const r of requests) {
    const option = catalog.options.find((o) => o.code === r.code);
    if ((option?.targetCount ?? 0) >= 1 && !(r.targetNames?.length ?? 0)) {
      throw new AssetInputError("Pick the assets this is about.");
    }
  }

  const outcome = await getDb().transaction(async (tx) => {
    // The project row first (the lock order of every asset writer), with ownership and stage.
    const locked = await findOwnedProject(tx, parsed.projectId, parsed.userId, {
      lock: "no-key-update",
    });
    if (!locked) return null;
    assertPreProductionOpen(locked);
    let skipped = 0;
    let skippedLocation = false;
    for (const target of skipRefs) {
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
        payload: { refs: skip.flatMap((s) => s.targetNames ?? []) },
      });
    }
    // A skipped location is not designed: props waiting for it go ahead without it.
    if (skippedLocation) await wakeOnTx(tx, parsed.projectId);
    if (requests.length === 0 && !rescan) return { skipped, reviewId: null };
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
        issueCodes: rescan
          ? [RESCAN_CODE, ...fixRequestCodes(requests)]
          : fixRequestCodes(requests),
        fixRequests: requests,
        note: parsed.note || null,
        damiRunId: latest.damiRunId,
      })
      .returning({ id: review.id });
    if (!row) throw new Error("review insert returned no row");
    // The fix job is sent with the review: the panel never shows a round as running without it.
    try {
      await enqueue(assetDetectFix, { reviewId: row.id }, { tx });
    } catch (error) {
      console.error("[assets] could not enqueue asset.detect.fix:", error);
      throw new AssetInputError(ENQUEUE_FAILURE);
    }
    return { skipped, reviewId: row.id };
  });
  if (!outcome) return null;
  return { skipped: outcome.skipped, started: outcome.reviewId !== null };
}
