/**
 * Location packs and prop sheets from the worker:
 * - `asset.sheet.plan`: the sheet maker (sheet-generator-location or -prop) writes the views of a
 *   new pack (stored as planned views), or re-writes one rejected view in a fix round
 *   (`viewRowId`: the location dami with `only_views`, the prop dami with its fix mode);
 * - `asset.sheet.views.advance`: requests every planned view whose dependencies are approved;
 * - `asset.sheet.assemble`: builds the locked pack's contact sheet.
 */
import {
  advanceSheetViews,
  AssetInputError,
  assemblePackSheet,
  enqueueAdvance,
  failSheet,
  failSheetView,
  heroViewIdOf,
  loadDesignContext,
  loadPackJob,
  loadViewRejection,
  loadViewRow,
  packKindOf,
  storePackPlan,
  storeViewFix,
  type PackJobContext,
  type PackKind,
  type PackViewRow,
  type PlannedView,
} from "../../src/server/assets";
import {
  designerProject,
  findReviewOption,
  getReviewCatalog,
  runDami,
  sheetGeneratorLocation,
  sheetGeneratorProp,
  type LocationSheetInput,
  type LocationSheetOutput,
  type PropSheetInput,
  type PropSheetOutput,
} from "../../src/server/damis";
import type { LookAspectRatio, ProjectStyle, SheetSpec } from "../../src/server/db/schema";
import {
  assetSheetAssemble,
  assetSheetPlan,
  assetSheetViewsAdvance,
  defineHandler,
  type JobContext,
} from "../../src/server/jobs";
import { classifyAssetFailure } from "./asset-failure";
import { handleFailure } from "./script-failure";

const CATALOG = {
  location: "sheet-generator-location",
  prop: "sheet-generator-prop",
} as const;

/* ------------------------------------------------------------------------------------------ */
/* The dami's answer as stored views                                                           */
/* ------------------------------------------------------------------------------------------ */

function locationViews(output: LocationSheetOutput, heroViewId: string): PlannedView[] {
  const order = output.generation_order;
  const sorted = [...output.views].sort(
    (a, b) => order.indexOf(a.view_id) - order.indexOf(b.view_id),
  );
  return sorted.map((v) => ({
    viewId: v.view_id,
    label: v.name,
    purpose: null,
    prompt: v.image_prompt,
    aspectRatio: v.aspect_ratio,
    referenceOrder: v.reference_order.map((r) => ({
      index: r.index,
      source:
        r.source_view_id === heroViewId
          ? "approved_hero"
          : r.source_view_id.startsWith("previous:")
            ? r.source_view_id
            : `approved_view:${r.source_view_id}`,
      role: r.source_view_id,
    })),
    dependsOn: v.depends_on.filter((d) => d !== heroViewId),
    mustShow: v.must_show.map((m) => `${m.anchor_id.replace(/_/g, " ")}: ${m.expected_position}`),
    mustNotShow: v.must_not_show,
    reviewFocus: v.review_focus,
    newHypotheses: v.new_hypotheses,
    editMode: v.edit_mode,
    warnings: output.warnings.filter((w) => w.includes(v.view_id)),
  }));
}

function propViews(output: PropSheetOutput): PlannedView[] {
  const order = output.generation_order;
  const sorted = [...output.views].sort(
    (a, b) => order.indexOf(a.view_id) - order.indexOf(b.view_id),
  );
  return sorted.map((v) => ({
    viewId: v.view_id,
    label: v.label,
    purpose: v.purpose,
    prompt: v.image_prompt,
    aspectRatio: v.aspect_ratio as LookAspectRatio,
    referenceOrder: v.reference_order,
    dependsOn: v.depends_on.filter((d) => d !== "hero_34"),
    mustShow: v.must_show,
    mustNotShow: v.must_not_show,
    reviewFocus: v.review_focus,
    newHypotheses: v.new_hypotheses.map((h) => `${h.area}: ${h.proposal}`),
    editMode: v.edit_mode,
    warnings: output.warnings.filter((w) => w.includes(v.view_id)),
  }));
}

/** The previous answer with every view's current prompt (the dami's `previous_output`). */
function previousOutput(ctx: PackJobContext): Record<string, unknown> {
  const output = ctx.sheet.spec?.output ?? {};
  const prompts = new Map(ctx.views.map((v) => [v.viewId, v]));
  const views = Array.isArray(output.views) ? (output.views as unknown[]) : [];
  return {
    ...output,
    views: views.map((v) => {
      if (!v || typeof v !== "object" || !("view_id" in v) || typeof v.view_id !== "string") {
        return v;
      }
      const row = prompts.get(v.view_id);
      return { ...v, image_prompt: row?.prompt ?? "" };
    }),
  };
}

function approvedImages(ctx: PackJobContext, kind: PackKind) {
  const hero = ctx.look.fileId;
  if (!hero) throw new AssetInputError("The approved Hero is missing. Start again.");
  return [
    { fileId: hero, viewId: heroViewIdOf(kind, ctx.look) },
    ...ctx.views
      .filter((v) => v.status === "accepted" && v.fileId)
      .slice(0, 5)
      .map((v) => ({ fileId: v.fileId ?? "", viewId: v.viewId })),
  ];
}

type FixRound = {
  view: PackViewRow;
  requests: {
    code: string;
    instruction: string;
    note?: string;
    viewId: string;
    editEligible: boolean;
  }[];
  note: string | undefined;
};

/* ------------------------------------------------------------------------------------------ */
/* Running the sheet makers                                                                     */
/* ------------------------------------------------------------------------------------------ */

async function runMaker(
  ctx: PackJobContext,
  kind: PackKind,
  fix: FixRound | null,
  signal: AbortSignal,
): Promise<{ views: PlannedView[]; spec: SheetSpec; runId: string; warnings: string[] }> {
  const style = ctx.project.style as ProjectStyle;
  const run = { userId: ctx.project.ownerId, projectId: ctx.project.id, signal };
  const lookOutput = ctx.look.spec?.output ?? {};
  const fixPart = fix
    ? {
        previousOutput: previousOutput(ctx),
        fixRequests: fix.requests,
        ...(fix.note ? { userNotes: fix.note.slice(0, 4000) } : {}),
      }
    : {};
  if (kind === "location") {
    const design = await loadDesignContext(ctx.asset);
    const heroViewId = heroViewIdOf(kind, ctx.look);
    const input: LocationSheetInput = {
      project: designerProject(style),
      lockedSpec: lookOutput,
      mode: "lock",
      approvedImages: approvedImages(ctx, kind),
      ...(fix ? { onlyViews: [fix.view.viewId] } : {}),
      excludeAssets: design.excludeAssets.filter((n) => n !== ctx.asset.name),
      ...fixPart,
    };
    const result = await runDami(sheetGeneratorLocation, input, run);
    const output = result.output;
    const { views: _views, ...rest } = output;
    void _views;
    return {
      views: locationViews(output, heroViewId),
      runId: result.runId,
      warnings: output.warnings,
      spec: {
        maker: "sheet-generator-location",
        referenceFileIds: [],
        referenceOrder: [],
        editMode: "full",
        detailCells: [],
        styleUsed: typeof lookOutput.style_used === "string" ? lookOutput.style_used : "",
        assumptions: output.assumptions,
        warnings: output.warnings,
        appliedFixes: output.applied_fixes.map((code) => ({ code, change: "" })),
        generationOrder: output.generation_order,
        output: {
          ...rest,
          views: output.views.map(({ image_prompt: _p, ...v }) => {
            void _p;
            return v;
          }),
        },
      },
    };
  }
  const design = await loadDesignContext(ctx.asset);
  const input: PropSheetInput = {
    lockedSpec: lookOutput,
    approvedImages: approvedImages(ctx, kind),
    userReferenceImages: ctx.look.references.slice(0, 4).map((r) => ({
      fileId: r.fileId,
      role: r.role,
      ...(r.note ? { note: r.note } : {}),
    })),
    linkedCharacters: design.linkedCharacters.map((c) => ({
      name: c.name,
      ageGroup: c.ageGroup,
      build: c.build,
      handedness: c.handedness,
    })),
    project: designerProject(style),
    ...fixPart,
  };
  const result = await runDami(sheetGeneratorProp, input, run);
  const output = result.output;
  const views = propViews(output);
  return {
    views: fix ? views.filter((v) => v.viewId === fix.view.viewId) : views,
    runId: result.runId,
    warnings: output.warnings,
    spec: {
      maker: "sheet-generator-prop",
      referenceFileIds: [],
      referenceOrder: [],
      editMode: "full",
      detailCells: [],
      styleUsed: typeof lookOutput.style_used === "string" ? lookOutput.style_used : "",
      assumptions: output.assumptions,
      warnings: output.warnings,
      appliedFixes: output.applied_fixes.map((f) => ({
        code: f.code,
        change: f.change,
        viewId: f.view_id,
      })),
      generationOrder: output.generation_order,
      sheetLevel: output.sheet_level,
      scaleCard: {
        dimensionsCm: output.scale_card.dimensions_cm,
        dimensionsStatus: output.scale_card.dimensions_status,
        relativeReference: output.scale_card.relative_reference,
        text: output.scale_card.text,
      },
      output: {
        ...output,
        views: output.views.map(({ image_prompt: _p, ...v }) => {
          void _p;
          return v;
        }),
      },
    },
  };
}

/** The fix round of a view version waiting for its prompt (its parent's review). */
async function fixRoundOf(view: PackViewRow, kind: PackKind): Promise<FixRound | null> {
  if (!view.parentId) return null;
  const rejection = await loadViewRejection(view.parentId);
  if (!rejection) return null;
  const catalog = getReviewCatalog(CATALOG[kind]);
  return {
    view,
    note: rejection.note ?? undefined,
    requests: rejection.fixRequests.map((r) => ({
      code: r.code,
      instruction: r.instruction,
      ...(r.customText ? { note: r.customText } : {}),
      viewId: view.viewId,
      editEligible: findReviewOption(catalog, r.code)?.editEligible ?? false,
    })),
  };
}

async function planPack(sheetId: string, viewRowId: string | undefined, context: JobContext) {
  const ctx = await loadPackJob(sheetId);
  if (!ctx) return;
  const kind = packKindOf(ctx.asset.kind);
  if (!kind) return;
  const fixView = viewRowId ? await loadViewRow(viewRowId) : null;
  if (viewRowId) {
    // A fix round: only while the view still waits for its prompt and the pack is in review.
    if (!fixView || fixView.sheetId !== sheetId || fixView.status !== "planned" || fixView.prompt) {
      return;
    }
    if (ctx.sheet.status !== "in_review") return;
  } else if (ctx.sheet.status !== "pending" || ctx.sheet.spec) {
    return;
  }
  try {
    if (ctx.asset.status !== "active") throw new AssetInputError("This asset was removed.");
    if (ctx.look.status !== "accepted" || !ctx.look.fileId) {
      throw new AssetInputError("The Hero these views are built from was replaced. Start again.");
    }
    if (!ctx.project.style) throw new AssetInputError("Choose the project's style first.");
    if (fixView) {
      const fix = await fixRoundOf(fixView, kind);
      if (!fix) throw new AssetInputError("The review this view answers is missing. Start again.");
      const result = await runMaker(ctx, kind, fix, context.signal);
      const view = result.views.find((v) => v.viewId === fixView.viewId);
      if (!view) {
        throw new AssetInputError(
          result.warnings[0] ?? "This view could not be written again. Try again.",
        );
      }
      await storeViewFix({
        viewRowId: fixView.id,
        view: {
          ...view,
          warnings: [
            ...new Set([
              ...view.warnings,
              ...result.warnings.filter((w) => w.startsWith("DESIGN_CHANGE_REQUESTED:")),
            ]),
          ],
        },
        damiRunId: result.runId,
      });
    } else {
      const result = await runMaker(ctx, kind, null, context.signal);
      await storePackPlan({
        sheetId,
        spec: result.spec,
        views: result.views,
        damiRunId: result.runId,
      });
    }
    await enqueueAdvance(sheetId);
  } catch (error) {
    await handleFailure(
      error,
      assetSheetPlan,
      context,
      async (d) => {
        if (fixView) await failSheetView(fixView.id, d.message);
        else await failSheet(sheetId, d.message, d.runId);
      },
      classifyAssetFailure,
    );
  }
}

/** Plans a new pack, or re-writes one rejected view (`viewRowId`). */
export const assetSheetPlanHandler = defineHandler(assetSheetPlan, (payload, context) =>
  planPack(payload.sheetId, payload.viewRowId, context),
);

/** Requests every planned view whose dependencies are approved. */
export const assetSheetViewsAdvanceHandler = defineHandler(
  assetSheetViewsAdvance,
  async (payload) => {
    await advanceSheetViews(payload.sheetId, (error) => {
      const decision = classifyAssetFailure(error);
      return decision.retryable ? null : decision.message;
    });
  },
);

/** Builds a locked pack's contact sheet. */
export const assetSheetAssembleHandler = defineHandler(
  assetSheetAssemble,
  async (payload, context) => {
    await assemblePackSheet(payload.sheetId, context.signal);
  },
);
