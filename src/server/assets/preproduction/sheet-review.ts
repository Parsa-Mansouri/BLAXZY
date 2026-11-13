/** Reviewing sheets and the views of location packs and prop sheets, and locking a pack. */
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { fixRequestCodes, type FixSelection } from "@/server/damis";
import { type DbTx, getDb } from "@/server/db/client";
import { assetSheet, assetSheetView, review } from "@/server/db/schema";
import { assetSheetAssemble, assetSheetPlan, assetSheetViewsAdvance } from "@/server/jobs";
import { logProjectEvent } from "@/server/projects";
import { type AssetRow, loadAssetState, type LookRow, type SheetRow } from "../looks";
import { latestViewRows, packKindOf, packLockGate, type PackViewRow } from "../packs";
import { AssetInputError, parse } from "../service";
import type { AssetStage } from "../stage";
import { assertActive, isUuid, lockAsset } from "./access";
import { enqueueOnTx, enqueueSheetJob } from "./enqueue";
import { idSchema, sheetReviewInput, userIdSchema, viewReviewInput } from "./inputs";
import { sendBackToDesigner } from "./look-review";
import { HYPOTHESES_FIRST, NEEDS_REASON, NOT_IN_REVIEW } from "./messages";
import { planSheetReview } from "./review-plans";
import { insertSheet, insertViewVersion } from "./versions";

/**
 * Accepts or rejects a character sheet in review (the asset's latest, built from its accepted
 * look); a ready asset's accepted sheet can also be sent back (the Review All pass).
 *
 * Accepted: the asset is ready. Rejected: the catalog picks become `fix_requests` (and
 * `issue_codes`). SR01 alone re-rolls the image (same prompt, new seed, no dami call). SX01 sends
 * the asset back to the Character Generator with the user's words (the sheet is rebuilt once the
 * new board is accepted). Anything else is a fix round of the sheet maker (`asset.sheet.fix`).
 * Location packs and prop sheets are reviewed view by view (`submitSheetViewReview`, `lockSheet`);
 * only the design route applies to them here.
 */
export async function submitSheetReview(input: {
  sheetId: string;
  userId: string;
  decision: "accepted" | "rejected";
  selections?: FixSelection[];
  note?: string;
}): Promise<AssetStage | null> {
  const parsed = parse(sheetReviewInput, input);
  const { sheetId, userId, decision } = parsed;
  const selections = parsed.selections ?? [];
  const note = parsed.note ? parsed.note : null;
  if (!isUuid(sheetId)) return null;
  if (decision === "rejected" && selections.length === 0 && !note) {
    throw new AssetInputError(NEEDS_REASON);
  }
  const outcome = await getDb().transaction(async (tx) => {
    const [target] = await tx
      .select({ assetId: assetSheet.assetId })
      .from(assetSheet)
      .where(eq(assetSheet.id, sheetId))
      .limit(1);
    if (!target) return null;
    const locked = await lockAsset(tx, target.assetId, userId);
    if (!locked) return null;
    const { asset: row } = locked;
    assertActive(row);
    const plan =
      decision === "rejected"
        ? planSheetReview(row.kind, selections)
        : { fixRequests: [], regenerate: null, route: null };
    const { look, sheet: latest } = await loadAssetState(tx, row);
    if (
      !latest ||
      latest.id !== sheetId ||
      // A ready asset's accepted sheet can still be sent back (the Review All pass).
      !(
        latest.status === "in_review" ||
        (decision === "rejected" && latest.status === "accepted")
      ) ||
      look?.id !== latest.lookId ||
      look.status !== "accepted"
    ) {
      throw new AssetInputError(NOT_IN_REVIEW);
    }
    const pack = packKindOf(row.kind);
    if (pack && !plan.route) {
      throw new AssetInputError(
        decision === "accepted"
          ? "Approve the views one by one, then lock the sheet."
          : "Ask for changes on the view itself, or change the design.",
      );
    }
    if (plan.route) {
      await sendBackToDesigner(tx, {
        row,
        look,
        sheet: latest,
        userId,
        code: plan.route.code,
        text: plan.route.text,
        note,
      });
      return "generating" as const;
    }
    const now = new Date();
    const issueCodes = [
      ...fixRequestCodes(plan.fixRequests),
      ...(plan.regenerate ? [plan.regenerate] : []),
    ];
    await tx.insert(review).values({
      projectId: row.projectId,
      userId,
      subjectType: "asset_sheet",
      subjectId: sheetId,
      decision,
      issueCodes: decision === "rejected" ? issueCodes : [],
      fixRequests: decision === "rejected" ? plan.fixRequests : [],
      note,
      damiRunId: latest.damiRunId,
    });
    if (decision === "rejected") {
      if (plan.fixRequests.length === 0 && !plan.regenerate && !note) {
        throw new AssetInputError(NEEDS_REASON);
      }
      await tx
        .update(assetSheet)
        .set({ status: "rejected", decidedAt: now })
        .where(eq(assetSheet.id, sheetId));
      const reroll =
        plan.regenerate !== null &&
        plan.fixRequests.length === 0 &&
        !note &&
        latest.prompt !== null;
      const next = await insertSheet(tx, {
        assetId: row.id,
        projectId: row.projectId,
        lookId: latest.lookId,
        parentId: sheetId,
        status: "pending",
        // A re-roll keeps the prompt, the spec and the dami run: only the seed changes.
        ...(reroll
          ? { prompt: latest.prompt, spec: latest.spec, damiRunId: latest.damiRunId }
          : {}),
      });
      await logProjectEvent(tx, {
        projectId: row.projectId,
        userId,
        type: "asset.sheet_rejected",
        payload: {
          assetId: row.id,
          sheetId,
          nextSheetId: next.id,
          issueCodes,
        },
      });
      await enqueueSheetJob(tx, next, row.kind);
      return "building_sheet" as const;
    }
    await tx
      .update(assetSheet)
      .set({ status: "superseded" })
      .where(
        and(
          eq(assetSheet.assetId, row.id),
          eq(assetSheet.status, "accepted"),
          ne(assetSheet.id, sheetId),
        ),
      );
    await tx
      .update(assetSheet)
      .set({ status: "accepted", decidedAt: now })
      .where(eq(assetSheet.id, sheetId));
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId,
      type: "asset.sheet_accepted",
      payload: {
        assetId: row.id,
        sheetId,
        lookId: latest.lookId,
      },
    });
    return "ready" as const;
  });
  return outcome;
}

/** The view, its sheet and its asset, the asset locked, when the user owns it. */
async function lockView(
  tx: DbTx,
  viewRowId: string,
  userId: string,
): Promise<{ view: PackViewRow; asset: AssetRow; look: LookRow; sheet: SheetRow } | null> {
  if (!isUuid(viewRowId)) return null;
  const [target] = await tx
    .select({ assetId: assetSheetView.assetId })
    .from(assetSheetView)
    .where(eq(assetSheetView.id, viewRowId))
    .limit(1);
  if (!target) return null;
  const locked = await lockAsset(tx, target.assetId, userId);
  if (!locked) return null;
  const { asset: row } = locked;
  assertActive(row);
  const { look, sheet } = await loadAssetState(tx, row);
  const views = sheet ? await latestViewRows(tx, sheet.id) : [];
  const view = views.find((v) => v.id === viewRowId);
  if (!look || !sheet || !view || look.status !== "accepted" || sheet.lookId !== look.id) {
    throw new AssetInputError(NOT_IN_REVIEW);
  }
  return { view, asset: row, look, sheet };
}

/**
 * Approves a view of a location pack or prop sheet, or asks for changes.
 *
 * Accepted: the view's proposed parts (`new_hypotheses`) must be approved with it; the views that
 * waited for it are requested. Rejected: the catalog picks become `fix_requests`. A re-roll alone
 * (LSR01, ASR01) makes a new version with the same prompt and a new seed; a design change (LSX01,
 * ASX01) sends the asset back to its designer; anything else is a fix round that re-writes only
 * this view (`asset.sheet.plan` with the new version).
 */
export async function submitSheetViewReview(input: {
  viewRowId: string;
  userId: string;
  decision: "accepted" | "rejected";
  selections?: FixSelection[];
  note?: string;
  hypothesesApproved?: boolean;
}): Promise<AssetStage | null> {
  const parsed = parse(viewReviewInput, input);
  const { viewRowId, userId, decision } = parsed;
  const note = parsed.note ? parsed.note : null;
  const selections = parsed.selections ?? [];
  if (decision === "rejected" && selections.length === 0 && !note) {
    throw new AssetInputError(NEEDS_REASON);
  }
  const outcome = await getDb().transaction(async (tx) => {
    const found = await lockView(tx, viewRowId, userId);
    if (!found) return null;
    const { view, asset: row, look, sheet } = found;
    if (sheet.status !== "in_review" || view.status !== "in_review") {
      throw new AssetInputError(NOT_IN_REVIEW);
    }
    const now = new Date();
    if (decision === "accepted") {
      if (view.newHypotheses.length > 0 && !parsed.hypothesesApproved) {
        throw new AssetInputError(HYPOTHESES_FIRST);
      }
      await tx.insert(review).values({
        projectId: row.projectId,
        userId,
        subjectType: "asset_sheet_view",
        subjectId: view.id,
        decision,
        note,
        damiRunId: view.damiRunId,
      });
      await tx
        .update(assetSheetView)
        .set({ status: "accepted", decidedAt: now })
        .where(eq(assetSheetView.id, view.id));
      await logProjectEvent(tx, {
        projectId: row.projectId,
        userId,
        type: "asset.sheet_view_accepted",
        payload: {
          assetId: row.id,
          sheetId: sheet.id,
          viewRowId: view.id,
          viewId: view.viewId,
        },
      });
      // The views that waited for this one are requested next (sent with the approval).
      await enqueueOnTx(tx, assetSheetViewsAdvance, { sheetId: sheet.id });
      return "sheet_review" as const;
    }
    const plan = planSheetReview(
      row.kind,
      selections.map((s) => ({ ...s, viewId: view.viewId })),
    );
    if (plan.route) {
      await sendBackToDesigner(tx, {
        row,
        look,
        sheet,
        userId,
        code: plan.route.code,
        text: plan.route.text,
        note,
        viewLabel: view.label,
      });
      return "generating" as const;
    }
    const issueCodes = [
      ...fixRequestCodes(plan.fixRequests),
      ...(plan.regenerate ? [plan.regenerate] : []),
    ];
    await tx.insert(review).values({
      projectId: row.projectId,
      userId,
      subjectType: "asset_sheet_view",
      subjectId: view.id,
      decision,
      issueCodes,
      fixRequests: plan.fixRequests,
      note,
      damiRunId: view.damiRunId,
    });
    await tx
      .update(assetSheetView)
      .set({ status: "rejected", decidedAt: now })
      .where(eq(assetSheetView.id, view.id));
    const reroll = plan.regenerate !== null && plan.fixRequests.length === 0 && !note;
    const next = await insertViewVersion(
      tx,
      view,
      reroll
        ? { prompt: view.prompt, editMode: view.editMode, warnings: [], damiRunId: view.damiRunId }
        : {},
    );
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId,
      type: "asset.sheet_view_rejected",
      payload: {
        assetId: row.id,
        sheetId: sheet.id,
        viewRowId: view.id,
        nextViewRowId: next.id,
        issueCodes,
      },
    });
    // A re-roll is requested by the advance; a fix round re-writes this view first.
    if (reroll) await enqueueOnTx(tx, assetSheetViewsAdvance, { sheetId: sheet.id });
    else await enqueueOnTx(tx, assetSheetPlan, { sheetId: sheet.id, viewRowId: next.id });
    return "sheet_review" as const;
  });
  return outcome;
}

/**
 * Runs a failed view (its latest version) again: back to planned, then the pack advances (or, a
 * fix round that failed before its prompt was written, the sheet maker runs again), the job sent
 * with the change. The failed attempt (its generation, refunded, and its failure) is kept in the
 * `asset.sheet_view_retried` event before the row is cleared.
 */
export async function retrySheetView(input: {
  viewRowId: string;
  userId: string;
}): Promise<AssetStage | null> {
  const { viewRowId, userId } = parse(
    z.object({ viewRowId: idSchema, userId: userIdSchema }),
    input,
  );
  const outcome = await getDb().transaction(async (tx) => {
    const found = await lockView(tx, viewRowId, userId);
    if (!found) return null;
    const { view, asset: row, sheet } = found;
    if (sheet.status !== "in_review" || view.status !== "failed") {
      throw new AssetInputError("Only a view that could not be made can be tried again.");
    }
    // A fix round that failed before its prompt was written runs the sheet maker again.
    const needsPrompt = view.prompt === null;
    await tx
      .update(assetSheetView)
      .set({ status: "planned", failure: null, generationId: null })
      .where(eq(assetSheetView.id, view.id));
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId,
      type: "asset.sheet_view_retried",
      payload: {
        assetId: row.id,
        sheetId: sheet.id,
        viewRowId: view.id,
        previousGenerationId: view.generationId,
        previousFailure: view.failure,
      },
    });
    if (needsPrompt) {
      await enqueueOnTx(tx, assetSheetPlan, { sheetId: sheet.id, viewRowId: view.id });
    } else {
      await enqueueOnTx(tx, assetSheetViewsAdvance, { sheetId: sheet.id });
    }
    return "sheet_review" as const;
  });
  return outcome;
}

/**
 * Locks a location pack or prop sheet once its lock rules hold (`packLockGate`): the sheet is
 * accepted (the asset is ready), views not approved by then are set aside (superseded), and the
 * contact sheet is assembled for people.
 */
export async function lockSheet(input: {
  sheetId: string;
  userId: string;
}): Promise<AssetStage | null> {
  const { sheetId, userId } = parse(z.object({ sheetId: idSchema, userId: userIdSchema }), input);
  if (!isUuid(sheetId)) return null;
  const locked = await getDb().transaction(async (tx) => {
    const [target] = await tx
      .select({ assetId: assetSheet.assetId })
      .from(assetSheet)
      .where(eq(assetSheet.id, sheetId))
      .limit(1);
    if (!target) return null;
    const found = await lockAsset(tx, target.assetId, userId);
    if (!found) return null;
    const { asset: row } = found;
    assertActive(row);
    const pack = packKindOf(row.kind);
    const { look, sheet } = await loadAssetState(tx, row);
    if (
      !pack ||
      !sheet ||
      sheet.id !== sheetId ||
      sheet.status !== "in_review" ||
      look?.id !== sheet.lookId ||
      look.status !== "accepted"
    ) {
      throw new AssetInputError(NOT_IN_REVIEW);
    }
    // The sheet row before its views (the order the pack advance takes them in): an advance
    // running now finishes its view first, and the next one finds the sheet accepted.
    await tx
      .select({ id: assetSheet.id })
      .from(assetSheet)
      .where(eq(assetSheet.id, sheetId))
      .for("update");
    const views = await latestViewRows(tx, sheetId);
    const gate = packLockGate(pack, sheet.spec, views);
    if (!gate.canLock) {
      throw new AssetInputError(`Approve these first: ${gate.missing.join(", ")}.`);
    }
    const now = new Date();
    const setAside = views.filter((v) => v.status !== "accepted").map((v) => v.id);
    if (setAside.length > 0) {
      await tx
        .update(assetSheetView)
        .set({ status: "superseded" })
        .where(inArray(assetSheetView.id, setAside));
    }
    await tx
      .update(assetSheet)
      .set({ status: "superseded" })
      .where(
        and(
          eq(assetSheet.assetId, row.id),
          eq(assetSheet.status, "accepted"),
          ne(assetSheet.id, sheetId),
        ),
      );
    await tx
      .update(assetSheet)
      .set({ status: "accepted", decidedAt: now })
      .where(eq(assetSheet.id, sheetId));
    await tx.insert(review).values({
      projectId: row.projectId,
      userId,
      subjectType: "asset_sheet",
      subjectId: sheetId,
      decision: "accepted",
      damiRunId: sheet.damiRunId,
    });
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId,
      type: "asset.sheet_accepted",
      payload: {
        assetId: row.id,
        sheetId,
        lookId: sheet.lookId,
        views: views.filter((v) => v.status === "accepted").map((v) => v.viewId),
      },
    });
    // The contact sheet is assembled for people (sent with the lock).
    await enqueueOnTx(tx, assetSheetAssemble, { sheetId });
    return "ready" as const;
  });
  return locked;
}
