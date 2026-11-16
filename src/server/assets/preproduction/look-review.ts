/** Reviewing a look, and sending an asset back to its designer from the sheet step. */
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { designerFor } from "@/server/damis";
import { type DbTx, getDb } from "@/server/db/client";
import {
  asset,
  assetLook,
  assetSheet,
  assetSheetView,
  project,
  review,
  type ReviewFixRequest,
} from "@/server/db/schema";
import { logProjectEvent } from "@/server/projects";
import { checkReferences, type ReferenceInput } from "../designs";
import { type AssetRow, loadAssetState, type LookRow, type SheetRow } from "../looks";
import { AssetInputError, parse } from "../service";
import type { AssetStage } from "../stage";
import { assertActive, isUuid, lockAsset } from "./access";
import { enqueueLookJob, enqueueSheetJob, wakeOnTx } from "./enqueue";
import { lookReviewInput } from "./inputs";
import { CHECK_FIELDS, NEEDS_REASON, NOT_IN_REVIEW } from "./messages";
import { fieldsToConfirm, planLookReview, sameReferences } from "./review-plans";
import { insertLook, insertSheet } from "./versions";

/**
 * Accepts or rejects a look in review (the asset's latest), recording the review with the dami
 * run that wrote its prompt.
 *
 * Accepted: a location's or prop's critical inferred spec fields must be in `confirmedFields`;
 * any earlier accepted look and sheet are superseded and a sheet is started. A location that is
 * accepted wakes the props waiting for it.
 *
 * Rejected: the note becomes one free-text `fix_request` (`issue_codes` stays empty); spec-card edits, answers
 * to the designer's questions and changed photos go with them. A re-roll (`regenerate`) alone makes a new
 * version with the same prompt and a new seed (no dami call); anything else is a fix round
 * (`asset.look.fix`). An uploaded look (older projects) sends the asset back to needs_image.
 */
export async function submitLookReview(input: {
  lookId: string;
  userId: string;
  decision: "accepted" | "rejected";
  note?: string;
  /** Rejected, no words: draw the same design again (a new seed, no dami call). */
  regenerate?: boolean;
  references?: ReferenceInput[];
  specEdits?: { field: string; value: string }[];
  clarifyAnswers?: Record<string, string>;
  confirmedFields?: string[];
}): Promise<AssetStage | null> {
  const parsed = parse(lookReviewInput, input);
  const { lookId, userId, decision } = parsed;
  const note = parsed.note ? parsed.note : null;
  const specEdits = parsed.specEdits ?? [];
  const clarify = parsed.clarifyAnswers ?? {};
  if (!isUuid(lookId)) return null;
  const db = getDb();
  // Only the user's own look is read (a foreign id is "missing" before its photos are checked).
  const [target] = await db
    .select({ asset })
    .from(assetLook)
    .innerJoin(asset, eq(asset.id, assetLook.assetId))
    .innerJoin(project, eq(project.id, asset.projectId))
    .where(and(eq(assetLook.id, lookId), eq(project.ownerId, userId), isNull(project.archivedAt)))
    .limit(1);
  if (!target) return null;
  const newReferences =
    decision === "rejected" && parsed.references
      ? await checkReferences(target.asset, userId, parsed.references)
      : null;
  const outcome = await db.transaction(async (tx) => {
    const locked = await lockAsset(tx, target.asset.id, userId);
    if (!locked) return null;
    const { asset: row } = locked;
    assertActive(row);
    const plan =
      decision === "rejected" ? planLookReview(row.kind, note, specEdits) : { fixRequests: [] };
    const { look: latest } = await loadAssetState(tx, row);
    if (!latest || latest.id !== lookId || latest.status !== "in_review") {
      throw new AssetInputError(NOT_IN_REVIEW);
    }
    const referencesChanged =
      newReferences !== null && !sameReferences(newReferences, latest.references);
    const clarifyGiven = Object.keys(clarify).length > 0;
    if (
      decision === "rejected" &&
      plan.fixRequests.length === 0 &&
      !parsed.regenerate &&
      !note &&
      !clarifyGiven &&
      !referencesChanged
    ) {
      throw new AssetInputError(NEEDS_REASON);
    }
    const confirmed = [...new Set(parsed.confirmedFields ?? [])];
    if (decision === "accepted") {
      const missing = fieldsToConfirm(latest.spec).filter((f) => !confirmed.includes(f));
      if (missing.length > 0) throw new AssetInputError(CHECK_FIELDS);
    }
    const now = new Date();
    await tx.insert(review).values({
      projectId: row.projectId,
      userId,
      subjectType: "asset_look",
      subjectId: lookId,
      decision,
      // The user's words are the request: the note, and the free-text fix request built from it.
      issueCodes: [],
      fixRequests: decision === "rejected" ? plan.fixRequests : [],
      note,
      damiRunId: latest.damiRunId,
    });

    if (decision === "rejected") {
      await tx
        .update(assetLook)
        .set({ status: "rejected", decidedAt: now })
        .where(eq(assetLook.id, lookId));
      await logProjectEvent(tx, {
        projectId: row.projectId,
        userId,
        type: "asset.look_rejected",
        payload: {
          assetId: row.id,
          lookId,
          ...(referencesChanged ? { referencesChanged: true } : {}),
          ...(specEdits.length > 0 ? { specEdits: specEdits.map((e) => e.field) } : {}),
        },
      });
      if (latest.source === "uploaded") return "needs_image" as const;
      const reroll =
        parsed.regenerate === true &&
        plan.fixRequests.length === 0 &&
        !note &&
        !clarifyGiven &&
        !referencesChanged &&
        latest.prompt !== null;
      const next = await insertLook(tx, {
        assetId: row.id,
        projectId: row.projectId,
        parentId: lookId,
        source: "generated",
        status: "pending",
        userPrompt: latest.userPrompt,
        guidedAnswers: latest.guidedAnswers,
        references: newReferences ?? latest.references,
        clarifyAnswers:
          clarifyGiven || latest.clarifyAnswers
            ? { ...(latest.clarifyAnswers ?? {}), ...clarify }
            : null,
        // A re-roll keeps the prompt, the spec and the dami run: only the seed changes.
        ...(reroll
          ? { prompt: latest.prompt, spec: latest.spec, damiRunId: latest.damiRunId }
          : {}),
        createdBy: userId,
      });
      await enqueueLookJob(tx, next);
      return "generating" as const;
    }

    await tx
      .update(assetLook)
      .set({ status: "superseded" })
      .where(
        and(
          eq(assetLook.assetId, row.id),
          eq(assetLook.status, "accepted"),
          ne(assetLook.id, lookId),
        ),
      );
    await tx
      .update(assetSheet)
      .set({ status: "superseded" })
      .where(
        and(
          eq(assetSheet.assetId, row.id),
          inArray(assetSheet.status, ["accepted", "in_review", "failed"]),
        ),
      );
    await tx
      .update(assetLook)
      .set({ status: "accepted", decidedAt: now })
      .where(eq(assetLook.id, lookId));
    const sheet = await insertSheet(tx, {
      assetId: row.id,
      projectId: row.projectId,
      lookId,
      status: "pending",
    });
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId,
      type: "asset.look_accepted",
      payload: {
        assetId: row.id,
        lookId,
        source: latest.source,
        sheetId: sheet.id,
        ...(confirmed.length > 0 ? { confirmedFields: confirmed } : {}),
      },
    });
    await enqueueSheetJob(tx, sheet, row.kind);
    // An accepted location wakes the props that waited for its Hero (sent with the acceptance).
    if (designerFor(row.kind) === "location") await wakeOnTx(tx, row.projectId);
    return "building_sheet" as const;
  });
  return outcome;
}

/**
 * Sends an asset back to its designer from the sheet step (the owner's SX01, LSX01, ASX01, or a
 * `DESIGN_CHANGE_REQUESTED:` warning): the sheet is rejected, the accepted design is rejected with
 * the request as a fix request, and the design's next version is started (a designer fix round).
 * Once the new design is accepted, a new sheet is built automatically. A pack's views not decided
 * yet are superseded. The new look's job is sent on `tx`. Returns the new look.
 */
export async function sendBackToDesigner(
  tx: DbTx,
  input: {
    row: AssetRow;
    look: LookRow;
    sheet: SheetRow;
    userId: string;
    code: string;
    text: string | null;
    note: string | null;
    viewLabel?: string;
  },
): Promise<LookRow> {
  const { row, look, sheet, userId, code } = input;
  const words = input.text ?? input.note;
  if (!words) {
    throw new AssetInputError("Say what should change in the design.");
  }
  const where = input.viewLabel ? ` (seen in the ${input.viewLabel} view)` : "";
  const request: ReviewFixRequest = {
    type: "preference",
    code,
    instruction: `At the sheet step the user asked for a design change${where}: ${words}. Apply it to the design and keep everything else.`,
    customText: words,
  };
  const now = new Date();
  await tx.insert(review).values({
    projectId: row.projectId,
    userId,
    subjectType: "asset_sheet",
    subjectId: sheet.id,
    decision: "rejected",
    issueCodes: [code],
    fixRequests: [request],
    note: input.note,
    damiRunId: sheet.damiRunId,
  });
  await tx
    .update(assetSheet)
    .set({ status: "rejected", decidedAt: now })
    .where(eq(assetSheet.id, sheet.id));
  // A pack's views still to be made or reviewed are set aside (kept, superseded), so nothing more
  // is generated or charged for it: the pack advance re-checks the sheet before each request, and
  // a generation already running settles on no view.
  const setAside = await tx
    .update(assetSheetView)
    .set({ status: "superseded" })
    .where(
      and(
        eq(assetSheetView.sheetId, sheet.id),
        inArray(assetSheetView.status, ["planned", "pending", "in_review"]),
      ),
    )
    .returning({ id: assetSheetView.id });
  await tx.insert(review).values({
    projectId: row.projectId,
    userId,
    subjectType: "asset_look",
    subjectId: look.id,
    decision: "rejected",
    issueCodes: [code],
    fixRequests: [request],
    note: input.note,
    damiRunId: look.damiRunId,
  });
  await tx
    .update(assetLook)
    .set({ status: "rejected", decidedAt: now })
    .where(eq(assetLook.id, look.id));
  const next = await insertLook(tx, {
    assetId: row.id,
    projectId: row.projectId,
    parentId: look.id,
    source: "generated",
    status: "pending",
    userPrompt: look.userPrompt,
    guidedAnswers: look.guidedAnswers,
    references: look.references,
    clarifyAnswers: look.clarifyAnswers,
    createdBy: userId,
  });
  await logProjectEvent(tx, {
    projectId: row.projectId,
    userId,
    type: "asset.sent_back_to_designer",
    payload: {
      assetId: row.id,
      sheetId: sheet.id,
      lookId: look.id,
      nextLookId: next.id,
      code,
      ...(setAside.length > 0 ? { viewsSetAside: setAside.map((v) => v.id) } : {}),
    },
  });
  await enqueueLookJob(tx, next, "fix");
  return next;
}
