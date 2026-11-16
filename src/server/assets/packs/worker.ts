/**
 * The worker's side of packs: storing a plan, re-writing a view, failing a view, advancing the
 * generations and settling a view's image.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { type DbTx, getDb } from "@/server/db/client";
import {
  assetSheet,
  assetSheetView,
  type LookAspectRatio,
  type SheetSpec,
  type SheetViewReference,
} from "@/server/db/schema";
import { requestGeneration } from "@/server/generation";
import { assetSheetAssemble, assetSheetViewsAdvance, enqueue } from "@/server/jobs";
import { logProjectEvent } from "@/server/projects";
import { AssetInputError } from "../service";
import { loadPackJob } from "./queries";
import { heroViewIdOf, MAX_VIEWS, packKindOf, viewReferenceFiles } from "./rules";

/** A view as the sheet maker wrote it, ready to store. */
export type PlannedView = {
  viewId: string;
  label: string;
  purpose: string | null;
  prompt: string;
  aspectRatio: LookAspectRatio;
  referenceOrder: SheetViewReference[];
  dependsOn: string[];
  mustShow: string[];
  mustNotShow: string[];
  reviewFocus: string[];
  newHypotheses: string[];
  editMode: "full" | "edit_previous_view";
  warnings: string[];
};

/**
 * Stores a pack's plan on a pending sheet that has none: the spec, the dami run and every view
 * (version 1, planned, in generation order). The sheet moves to `in_review` (its views are made
 * and reviewed one by one). False when another run stored it first. Throws `AssetInputError`
 * for a plan of more than `MAX_VIEWS` views or with a view id twice (the schemas refuse both;
 * this is the last line of defence, as a pack's views are keyed by view id).
 */
export async function storePackPlan(input: {
  sheetId: string;
  spec: SheetSpec;
  views: PlannedView[];
  damiRunId: string;
}): Promise<boolean> {
  if (input.views.length > MAX_VIEWS) {
    throw new AssetInputError(
      `The sheet maker planned ${input.views.length} views; a pack has at most ${MAX_VIEWS}. Try again.`,
    );
  }
  const ids = new Set(input.views.map((v) => v.viewId));
  if (ids.size !== input.views.length) {
    throw new AssetInputError("The sheet maker planned the same view twice. Try again.");
  }
  return getDb().transaction(async (tx) => {
    const [sheet] = await tx
      .update(assetSheet)
      .set({ spec: input.spec, damiRunId: input.damiRunId, status: "in_review" })
      .where(
        and(
          eq(assetSheet.id, input.sheetId),
          eq(assetSheet.status, "pending"),
          isNull(assetSheet.spec),
        ),
      )
      .returning();
    if (!sheet) return false;
    if (input.views.length > 0) {
      await tx.insert(assetSheetView).values(
        input.views.map((v, i) => ({
          sheetId: sheet.id,
          assetId: sheet.assetId,
          projectId: sheet.projectId,
          viewId: v.viewId,
          versionNumber: 1,
          label: v.label,
          position: i,
          status: "planned" as const,
          purpose: v.purpose,
          prompt: v.prompt,
          aspectRatio: v.aspectRatio,
          referenceOrder: v.referenceOrder,
          dependsOn: v.dependsOn,
          mustShow: v.mustShow,
          mustNotShow: v.mustNotShow,
          reviewFocus: v.reviewFocus,
          newHypotheses: v.newHypotheses,
          editMode: v.editMode,
          warnings: v.warnings,
          damiRunId: input.damiRunId,
        })),
      );
    }
    await logProjectEvent(tx, {
      projectId: sheet.projectId,
      userId: null,
      type: "asset.sheet_planned",
      payload: {
        assetId: sheet.assetId,
        sheetId: sheet.id,
        views: input.views.map((v) => v.viewId),
      },
    });
    return true;
  });
}

/** Stores the re-written prompt of a view in a fix round (planned, no prompt yet). */
export async function storeViewFix(input: {
  viewRowId: string;
  view: PlannedView;
  damiRunId: string;
}): Promise<boolean> {
  const v = input.view;
  const updated = await getDb()
    .update(assetSheetView)
    .set({
      prompt: v.prompt,
      aspectRatio: v.aspectRatio,
      referenceOrder: v.referenceOrder,
      dependsOn: v.dependsOn,
      mustShow: v.mustShow,
      mustNotShow: v.mustNotShow,
      reviewFocus: v.reviewFocus,
      newHypotheses: v.newHypotheses,
      editMode: v.editMode,
      warnings: v.warnings,
      damiRunId: input.damiRunId,
    })
    .where(
      and(
        eq(assetSheetView.id, input.viewRowId),
        eq(assetSheetView.status, "planned"),
        isNull(assetSheetView.prompt),
      ),
    )
    .returning({ id: assetSheetView.id });
  return updated.length > 0;
}

/** planned/pending → failed with a user-readable reason. */
export async function failSheetView(viewRowId: string, failure: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(assetSheetView)
      .set({ status: "failed", failure })
      .where(
        and(
          eq(assetSheetView.id, viewRowId),
          inArray(assetSheetView.status, ["planned", "pending"]),
        ),
      )
      .returning();
    if (!row) return false;
    await logProjectEvent(tx, {
      projectId: row.projectId,
      userId: null,
      type: "asset.sheet_view_failed",
      payload: {
        assetId: row.assetId,
        sheetId: row.sheetId,
        viewRowId,
        failure,
      },
    });
    return true;
  });
}

/**
 * Requests every planned view (with a prompt) whose dependencies are approved, each in its own
 * transaction: the sheet row is share-locked and must still be in review (a pack sent back to its
 * designer or set aside meanwhile stops here, so it never spends credits), then the view row is
 * locked; the generation and its run job are written in that transaction. Returns how many
 * generations it requested. A view whose generation cannot be requested (credits, input) fails
 * with the reason. Lock order: sheet, then view (the user's actions take the project and asset
 * rows first, then the sheet before its views, see `lockSheet` and `sendBackToDesigner`).
 */
export async function advanceSheetViews(
  sheetId: string,
  onError: (error: unknown) => string | null,
): Promise<number> {
  const ctx = await loadPackJob(sheetId);
  if (!ctx || ctx.sheet.status !== "in_review" || !ctx.look.fileId) return 0;
  const kind = packKindOf(ctx.asset.kind);
  if (!kind || !ctx.project.style) return 0;
  const style = ctx.project.style;
  const heroFileId = ctx.look.fileId;
  const heroViewId = heroViewIdOf(kind, ctx.look);
  const byViewId = new Map(ctx.views.map((v) => [v.viewId, v]));
  const accepted = new Map(
    ctx.views.flatMap((v) => (v.status === "accepted" && v.fileId ? [[v.viewId, v.fileId]] : [])),
  );
  const ready = ctx.views.filter(
    (v) =>
      v.status === "planned" &&
      v.prompt !== null &&
      v.generationId === null &&
      v.dependsOn.every((d) => {
        const dep = byViewId.get(d);
        return !dep || dep.status === "accepted";
      }),
  );
  let requested = 0;
  for (const view of ready) {
    let previousFileId: string | null = null;
    if (view.parentId) {
      const [parent] = await getDb()
        .select({ fileId: assetSheetView.fileId })
        .from(assetSheetView)
        .where(eq(assetSheetView.id, view.parentId))
        .limit(1);
      previousFileId = parent?.fileId ?? null;
    }
    const files = viewReferenceFiles(
      view,
      { heroFileId, heroViewId, userFileIds: ctx.look.references.map((r) => r.fileId) },
      accepted,
      previousFileId,
    );
    const progress = { stopped: false };
    try {
      const generationId = await getDb().transaction(async (tx: DbTx) => {
        const [sheetNow] = await tx
          .select({ status: assetSheet.status })
          .from(assetSheet)
          .where(eq(assetSheet.id, sheetId))
          .for("share");
        if (sheetNow?.status !== "in_review") {
          progress.stopped = true;
          return null;
        }
        const [locked] = await tx
          .select()
          .from(assetSheetView)
          .where(eq(assetSheetView.id, view.id))
          .for("update");
        if (!locked || locked.status !== "planned" || locked.generationId || !locked.prompt) {
          return null;
        }
        const { generationId: id } = await requestGeneration(
          {
            userId: ctx.project.ownerId,
            projectId: ctx.project.id,
            purpose: "asset_sheet",
            prompt: locked.prompt,
            referenceFileIds: files,
            label: `${ctx.asset.name}: ${locked.label}`,
            style,
            aspectRatio: locked.aspectRatio,
            // Every version of a view is its own seed (a re-roll keeps the prompt).
            variant: locked.id,
            // A fix, re-roll or retry carries its own confirmation; the views of the plan the
            // sheet's (each costs one view, at most MAX_VIEWS of them).
            maxCredits: locked.confirmedCredits ?? ctx.sheet.confirmedCredits,
          },
          tx,
        );
        await tx
          .update(assetSheetView)
          .set({ status: "pending", generationId: id })
          .where(eq(assetSheetView.id, view.id));
        return id;
      });
      // `requestGeneration` sent the run job on the same transaction.
      if (generationId) requested++;
    } catch (error) {
      const message = onError(error);
      if (message === null) throw error;
      await failSheetView(view.id, message);
    }
    if (progress.stopped) break;
  }
  return requested;
}

/**
 * Queues an advance of the pack (deduplicated per sheet; a follow-up may wait beside a run). Pass
 * `tx` to send it with the change that calls for it. Throws when it cannot be queued.
 */
export async function enqueueAdvance(sheetId: string, options: { tx?: DbTx } = {}): Promise<void> {
  await enqueue(assetSheetViewsAdvance, { sheetId }, options);
}

/**
 * The completion hook's part for views: the pending view that requested this generation moves to
 * `in_review` with its image (or `failed`). Returns the sheet to advance, or null.
 */
export async function applyViewGenerationResult(
  tx: DbTx,
  projectId: string,
  generationId: string,
  values:
    | { status: "in_review"; fileId: string | null; failure: null }
    | {
        status: "failed";
        failure: string;
      },
): Promise<string | null> {
  const [row] = await tx
    .update(assetSheetView)
    .set(values)
    .where(
      and(
        eq(assetSheetView.projectId, projectId),
        eq(assetSheetView.status, "pending"),
        eq(assetSheetView.generationId, generationId),
      ),
    )
    .returning({
      id: assetSheetView.id,
      sheetId: assetSheetView.sheetId,
      assetId: assetSheetView.assetId,
    });
  if (!row) return null;
  await logProjectEvent(tx, {
    projectId,
    userId: null,
    type: values.status === "in_review" ? "asset.sheet_view_ready" : "asset.sheet_view_failed",
    payload: { assetId: row.assetId, sheetId: row.sheetId, viewRowId: row.id, generationId },
  });
  return row.sheetId;
}

/**
 * Queues the contact sheet of a locked pack. Pass `tx` to send it with the lock. Throws when it
 * cannot be queued.
 */
export async function enqueueAssemble(sheetId: string, options: { tx?: DbTx } = {}): Promise<void> {
  await enqueue(assetSheetAssemble, { sheetId }, options);
}
