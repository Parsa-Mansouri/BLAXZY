/**
 * Location packs and prop sheets: a sheet made of separate views (`asset_sheet_view`), each
 * generated in dependency order with the approved Hero and approved views as references, and
 * reviewed on its own. The backend never re-renders an approved view: the pack's human-facing
 * contact sheet is assembled with sharp once the pack is locked.
 *
 * This module holds the queries and the worker's side (storing a plan, re-writing a view,
 * advancing the generations, settling a view's image, assembling). The user's actions on views
 * (review, retry, lock) are in `preproduction.ts`. Nothing is overwritten: a fix or a re-roll is a
 * new version of the view, decisions change statuses.
 */
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { designerFor, isReverseView, LOCATION_HERO_VIEWS, SAMPLE_MODEL } from "@/server/damis";
import { getDb, type DbExecutor, type DbTx } from "@/server/db/client";
import {
  asset,
  assetLook,
  assetSheet,
  assetSheetView,
  damiRun,
  generation,
  project,
  review,
  type LookAspectRatio,
  type LookSpec,
  type ReviewFixRequest,
  type SheetSpec,
  type SheetViewReference,
  type SheetViewStatus,
} from "@/server/db/schema";
import { enqueueGeneration, requestGeneration } from "@/server/generation";
import { assetSheetAssemble, assetSheetViewsAdvance, enqueue } from "@/server/jobs";
import { isSampleProvider } from "@/server/providers";
import { putFileBytes, readFileBytes } from "@/server/storage";
import { logEvent, type AssetRow, type LookRow, type SheetRow } from "./looks";

export type PackViewRow = typeof assetSheetView.$inferSelect;
export type PackKind = "location" | "prop";

/** The pack kind of an asset (its designer), or null for characters and voices. */
export function packKindOf(kind: AssetRow["kind"]): PackKind | null {
  const designer = designerFor(kind);
  return designer === "location" || designer === "prop" ? designer : null;
}

/** A view of a pack as the screens show it (its latest version). */
export type PackView = {
  id: string;
  viewId: string;
  versionNumber: number;
  label: string;
  position: number;
  status: SheetViewStatus;
  purpose: string | null;
  fileId: string | null;
  aspectRatio: LookAspectRatio;
  /** The reviewer's checklist. */
  mustShow: string[];
  mustNotShow: string[];
  reviewFocus: string[];
  /** Parts the view proposes that the spec does not define: approved with the view. */
  newHypotheses: string[];
  editMode: "full" | "edit_previous_view";
  /** The dami's notes about this view; `DESIGN_CHANGE_REQUESTED:` ones offer the design route. */
  warnings: string[];
  /** Views it waits for (not approved yet), by label. */
  waitingFor: string[];
  /** A version answers a rejected one (a fix or a re-roll). */
  parentId: string | null;
  failure: string | null;
  isSample: boolean;
  createdAt: Date;
  decidedAt: Date | null;
};

/** Whether the pack can be locked, and what is missing (the owner's lock rules). */
export type PackLockGate = { canLock: boolean; missing: string[] };

/** The locked spec's identity card (location DNA, prop DNA and scale), for the screens. */
export type DnaCard = {
  summary: string;
  /** Location fixed anchors / prop signature details, as "name: where". */
  anchors: string[];
  identity: string[];
  constraints: string[];
  mutable: string[];
};

const MAX_VIEWS = 20;

/** The latest version of every view of a sheet, in generation order. */
export async function latestViewRows(db: DbExecutor, sheetId: string): Promise<PackViewRow[]> {
  const rows = await db
    .selectDistinctOn([assetSheetView.viewId])
    .from(assetSheetView)
    .where(eq(assetSheetView.sheetId, sheetId))
    .orderBy(assetSheetView.viewId, desc(assetSheetView.versionNumber))
    .limit(MAX_VIEWS);
  return rows.sort((a, b) => a.position - b.position || a.viewId.localeCompare(b.viewId));
}

/** The pack's views for a screen, with their sample flag and what they wait for. */
export async function listPackViews(db: DbExecutor, sheetId: string): Promise<PackView[]> {
  const rows = await latestViewRows(db, sheetId);
  if (rows.length === 0) return [];
  const meta = await db
    .select({ id: assetSheetView.id, provider: generation.provider, model: damiRun.model })
    .from(assetSheetView)
    .leftJoin(generation, eq(generation.id, assetSheetView.generationId))
    .leftJoin(damiRun, eq(damiRun.id, assetSheetView.damiRunId))
    .where(
      inArray(
        assetSheetView.id,
        rows.map((r) => r.id),
      ),
    );
  const byId = new Map(meta.map((m) => [m.id, m]));
  const byViewId = new Map(rows.map((r) => [r.viewId, r]));
  return rows.map((row): PackView => {
    const m = byId.get(row.id);
    const sample =
      (m?.provider !== null && m?.provider !== undefined && isSampleProvider(m.provider)) ||
      m?.model === SAMPLE_MODEL;
    return {
      id: row.id,
      viewId: row.viewId,
      versionNumber: row.versionNumber,
      label: row.label,
      position: row.position,
      status: row.status,
      purpose: row.purpose,
      fileId: row.fileId,
      aspectRatio: row.aspectRatio,
      mustShow: row.mustShow,
      mustNotShow: row.mustNotShow,
      reviewFocus: row.reviewFocus,
      newHypotheses: row.newHypotheses,
      editMode: row.editMode,
      warnings: row.warnings,
      waitingFor: row.dependsOn
        .map((d) => byViewId.get(d))
        .filter((d): d is PackViewRow => d !== undefined && d.status !== "accepted")
        .map((d) => d.label),
      parentId: row.parentId,
      failure: row.failure,
      isSample: sample,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
    };
  });
}

/** The prop views that must be approved before a lock, by sheet level. */
function requiredPropViews(level: SheetSpec["sheetLevel"], views: readonly PackViewRow[]) {
  if (level === "simple") return [];
  if (level === "production") return [...views];
  return views.filter(
    (v) => v.viewId.startsWith("state_") || !/^(detail|material)_|^interaction$/.test(v.viewId),
  );
}

/**
 * The owner's lock rules. Location: the Hero (the accepted look) and the Reverse view approved.
 * Prop: simple locks with the Hero and the scale card; standard needs its orthographic, back,
 * scale and state views; production needs every planned view. No view may still be generating.
 */
export function packLockGate(
  kind: PackKind,
  spec: SheetSpec | null,
  views: readonly PackViewRow[],
): PackLockGate {
  const missing: string[] = [];
  if (!spec) return { canLock: false, missing: ["The views are still being planned."] };
  if (kind === "location") {
    const reverse = views.filter((v) => isReverseView(v.viewId));
    if (reverse.length === 0 || reverse.some((v) => v.status !== "accepted")) {
      missing.push(reverse[0]?.label ?? "Reverse");
    }
  } else {
    for (const v of requiredPropViews(spec.sheetLevel, views)) {
      if (v.status !== "accepted") missing.push(v.label);
    }
  }
  const generating = views.some((v) => v.status === "pending");
  if (generating) missing.push("Views still being made");
  return { canLock: missing.length === 0, missing };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((v) => (record(v) ? [record(v) ?? {}] : [])) : [];
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** The DNA card of an accepted location or prop design (null for characters). */
export function dnaCardOf(kind: PackKind, spec: LookSpec | null): DnaCard | null {
  const output = spec?.output;
  const dna = record(output?.dna);
  if (!output || !dna) return null;
  if (kind === "location") {
    const vi = record(dna.visual_identity) ?? {};
    return {
      summary: str(output.location_summary) || (spec?.summary ?? ""),
      anchors: list(dna.fixed_anchors).map((a) => `${str(a.name)}: ${str(a.where)}`),
      identity: [
        str(dna.geometry),
        str(vi.era),
        str(vi.architectural_style),
        strings(vi.materials).join(", "),
        strings(vi.base_palette).join(", "),
        str(vi.wear_level),
        str(vi.scale),
      ].filter(Boolean),
      constraints: strings(dna.continuity_constraints),
      mutable: strings(dna.mutable_elements),
    };
  }
  const geometry = record(dna.geometry) ?? {};
  return {
    summary: [str(dna.object_type), str(dna.front_definition)].filter(Boolean).join(" · "),
    anchors: list(dna.signature_details).map(
      (d) =>
        `${str(d.description)}: ${str(d.face)}${str(d.position) ? `, ${str(d.position)}` : ""}`,
    ),
    identity: [
      str(geometry.silhouette),
      str(geometry.proportions),
      list(dna.materials)
        .map((m) => [str(m.material), str(m.finish), str(m.color)].filter(Boolean).join(" "))
        .join("; "),
      strings(dna.palette).join(", "),
    ].filter(Boolean),
    constraints: [...strings(dna.must_keep), ...strings(dna.must_not).map((m) => `Never: ${m}`)],
    mutable: strings(dna.mutable),
  };
}

/** The Hero's view id of a location pack (interior `hero_wide`, exterior `establishing_wide`). */
export function heroViewIdOf(kind: PackKind, look: Pick<LookRow, "spec">): string {
  if (kind === "prop") return "hero_34";
  const layout = record(look.spec?.output.layout);
  return layout?.space_kind === "exterior" ? "establishing_wide" : "hero_wide";
}

/* ------------------------------------------------------------------------------------------ */
/* Worker: loading, planning, fixing                                                           */
/* ------------------------------------------------------------------------------------------ */

export type PackJobContext = {
  sheet: SheetRow;
  look: LookRow;
  asset: AssetRow;
  project: { id: string; ownerId: string; style: typeof project.$inferSelect.style };
  views: PackViewRow[];
};

/** Everything a pack job needs, or null when the sheet, its look or its project is gone. */
export async function loadPackJob(sheetId: string): Promise<PackJobContext | null> {
  const db = getDb();
  const [row] = await db
    .select({ sheet: assetSheet, look: assetLook, asset, project })
    .from(assetSheet)
    .innerJoin(assetLook, eq(assetLook.id, assetSheet.lookId))
    .innerJoin(asset, eq(asset.id, assetSheet.assetId))
    .innerJoin(project, eq(project.id, assetSheet.projectId))
    .where(and(eq(assetSheet.id, sheetId), isNull(project.archivedAt)))
    .limit(1);
  if (!row) return null;
  return {
    sheet: row.sheet,
    look: row.look,
    asset: row.asset,
    project: { id: row.project.id, ownerId: row.project.ownerId, style: row.project.style },
    views: await latestViewRows(db, sheetId),
  };
}

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
 * and reviewed one by one). False when another run stored it first.
 */
export async function storePackPlan(input: {
  sheetId: string;
  spec: SheetSpec;
  views: PlannedView[];
  damiRunId: string;
}): Promise<boolean> {
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
    await logEvent(tx, sheet.projectId, null, "asset.sheet_planned", {
      assetId: sheet.assetId,
      sheetId: sheet.id,
      views: input.views.map((v) => v.viewId),
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

/** The review that rejected a view version (its fix requests), or null. */
export async function loadViewRejection(
  viewRowId: string,
): Promise<{ fixRequests: ReviewFixRequest[]; note: string | null } | null> {
  const [row] = await getDb()
    .select({ fixRequests: review.fixRequests, note: review.note })
    .from(review)
    .where(
      and(
        eq(review.subjectType, "asset_sheet_view"),
        eq(review.subjectId, viewRowId),
        eq(review.decision, "rejected"),
      ),
    )
    .orderBy(desc(review.createdAt))
    .limit(1);
  return row ?? null;
}

export async function loadViewRow(viewRowId: string): Promise<PackViewRow | null> {
  const [row] = await getDb()
    .select()
    .from(assetSheetView)
    .where(eq(assetSheetView.id, viewRowId))
    .limit(1);
  return row ?? null;
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
    await logEvent(tx, row.projectId, null, "asset.sheet_view_failed", {
      assetId: row.assetId,
      sheetId: row.sheetId,
      viewRowId,
      failure,
    });
    return true;
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Worker: advancing the generations                                                           */
/* ------------------------------------------------------------------------------------------ */

/** The most images one view attaches (the owner tunes prompts for four). */
const MAX_VIEW_FILES = 4;

/**
 * The files a view attaches, in its reference order: the Hero, approved views, the previous
 * version (edit mode) and the user's own photos. Unknown or missing sources are skipped.
 */
export function viewReferenceFiles(
  view: Pick<PackViewRow, "referenceOrder" | "parentId">,
  ctx: { heroFileId: string; heroViewId: string; userFileIds: readonly string[] },
  accepted: ReadonlyMap<string, string>,
  previousFileId: string | null,
): string[] {
  const files: string[] = [];
  for (const ref of [...view.referenceOrder].sort((a, b) => a.index - b.index)) {
    let file: string | null | undefined = null;
    const s = ref.source;
    if (s === "approved_hero" || s === ctx.heroViewId || LOCATION_HERO_VIEWS.includes(s)) {
      file = ctx.heroFileId;
    } else if (s.startsWith("previous:")) {
      file = previousFileId;
    } else if (s.startsWith("user_reference:")) {
      file = ctx.userFileIds[Number(s.slice("user_reference:".length)) - 1];
    } else {
      file = accepted.get(s.startsWith("approved_view:") ? s.slice("approved_view:".length) : s);
    }
    if (file && !files.includes(file)) files.push(file);
    if (files.length === MAX_VIEW_FILES) break;
  }
  if (!files.includes(ctx.heroFileId) && files.length < MAX_VIEW_FILES) {
    files.unshift(ctx.heroFileId);
  }
  return files;
}

/**
 * Requests every planned view (with a prompt) whose dependencies are approved, each in its own
 * transaction with the view row locked. Returns how many generations it requested. A view whose
 * generation cannot be requested (credits, input) fails with the reason. Only a pack in review
 * advances.
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
    try {
      const generationId = await getDb().transaction(async (tx: DbTx) => {
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
          },
          tx,
        );
        await tx
          .update(assetSheetView)
          .set({ status: "pending", generationId: id })
          .where(eq(assetSheetView.id, view.id));
        return id;
      });
      if (generationId) {
        await enqueueGeneration(generationId);
        requested++;
      }
    } catch (error) {
      const message = onError(error);
      if (message === null) throw error;
      await failSheetView(view.id, message);
    }
  }
  return requested;
}

/** Queues an advance of the pack (deduplicated per sheet; a follow-up may wait beside a run). */
export async function enqueueAdvance(sheetId: string): Promise<void> {
  try {
    await enqueue(assetSheetViewsAdvance, { sheetId });
  } catch (error) {
    console.error(`[assets] could not enqueue the views of ${sheetId}:`, error);
  }
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
  await logEvent(
    tx,
    projectId,
    null,
    values.status === "in_review" ? "asset.sheet_view_ready" : "asset.sheet_view_failed",
    { assetId: row.assetId, sheetId: row.sheetId, viewRowId: row.id, generationId },
  );
  return row.sheetId;
}

/* ------------------------------------------------------------------------------------------ */
/* Worker: the contact sheet                                                                    */
/* ------------------------------------------------------------------------------------------ */

const W = 2400;
const H = 1500;
const PAD = 40;
const GREY = { r: 58, g: 58, b: 60, alpha: 1 };

function xml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

function textSvg(
  width: number,
  height: number,
  lines: { text: string; size: number; bold?: boolean }[],
) {
  let y = 0;
  const parts = lines.map((l) => {
    y += l.size * 1.4;
    return `<text x="0" y="${y}" font-family="Helvetica, Arial, sans-serif" font-size="${l.size}" fill="#e8e6e1"${l.bold ? ' font-weight="700"' : ""}>${xml(l.text)}</text>`;
  });
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${parts.join("")}</svg>`,
  );
}

/**
 * The pack's contact sheet (`pack_contact_sheet.png` / `prop_sheet.png`): the Hero large on the
 * left, the approved views in a labelled grid on the right, and the DNA card (plus the prop's
 * scale card) below. Composed with sharp from the stored images; nothing is re-rendered.
 */
export async function composeContactSheet(input: {
  heroBytes: Uint8Array;
  heroLabel: string;
  views: { label: string; bytes: Uint8Array }[];
  title: string;
  card: DnaCard | null;
  scaleText: string | null;
}): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const heroW = 1360;
  const heroH = 900;
  const composites: { input: Buffer; left: number; top: number }[] = [];
  const fit = (bytes: Uint8Array, w: number, h: number) =>
    sharp(bytes).resize(w, h, { fit: "contain", background: GREY }).png().toBuffer();
  composites.push({ input: await fit(input.heroBytes, heroW, heroH), left: PAD, top: PAD + 60 });
  composites.push({
    input: textSvg(heroW, 60, [
      { text: `${input.title} · ${input.heroLabel}`, size: 34, bold: true },
    ]),
    left: PAD,
    top: PAD - 4,
  });
  const gridX = PAD * 2 + heroW;
  const gridW = W - gridX - PAD;
  const cols = 2;
  const cellW = Math.floor((gridW - PAD) / cols);
  const cellH = Math.floor(cellW * 0.5625);
  const shown = input.views.slice(0, 8);
  for (const [i, view] of shown.entries()) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const left = gridX + col * (cellW + PAD);
    const top = PAD + row * (cellH + 54);
    composites.push({ input: await fit(view.bytes, cellW, cellH), left, top });
    composites.push({
      input: textSvg(cellW, 40, [{ text: cut(view.label, 40), size: 24 }]),
      left,
      top: top + cellH + 4,
    });
  }
  const cardTop = PAD + 60 + heroH + PAD;
  const card = input.card;
  const lines: { text: string; size: number; bold?: boolean }[] = [];
  if (card) {
    lines.push({ text: cut(card.summary, 140), size: 26, bold: true });
    for (const a of card.anchors.slice(0, 4)) lines.push({ text: cut(a, 150), size: 22 });
    for (const c of card.constraints.slice(0, 3)) lines.push({ text: cut(c, 150), size: 22 });
  }
  if (input.scaleText)
    lines.push({ text: `Scale: ${cut(input.scaleText, 140)}`, size: 24, bold: true });
  if (lines.length > 0) {
    composites.push({ input: textSvg(heroW, H - cardTop - PAD, lines), left: PAD, top: cardTop });
  }
  return sharp({ create: { width: W, height: H, channels: 4, background: GREY } })
    .composite(composites)
    .png()
    .toBuffer();
}

/**
 * Builds and stores a locked pack's contact sheet as the sheet's file (once: only while the
 * accepted sheet has none). Logs `asset.sheet_ready`. False when there is nothing to do.
 */
export async function assemblePackSheet(sheetId: string, signal?: AbortSignal): Promise<boolean> {
  const ctx = await loadPackJob(sheetId);
  if (!ctx || ctx.sheet.status !== "accepted" || ctx.sheet.fileId || !ctx.look.fileId) return false;
  const kind = packKindOf(ctx.asset.kind);
  if (!kind) return false;
  const accepted = ctx.views.filter((v) => v.status === "accepted" && v.fileId);
  const read = (id: string) => readFileBytes(id, signal ? { signal } : {});
  const png = await composeContactSheet({
    heroBytes: await read(ctx.look.fileId),
    heroLabel: kind === "location" ? "Hero" : "Hero 3/4",
    views: await Promise.all(
      accepted.map(async (v) => ({ label: v.label, bytes: await read(v.fileId ?? "") })),
    ),
    title: ctx.asset.name,
    card: dnaCardOf(kind, ctx.look.spec),
    scaleText: ctx.sheet.spec?.scaleCard?.text ?? null,
  });
  const file = await putFileBytes({
    ownerId: ctx.project.ownerId,
    projectId: ctx.project.id,
    name: kind === "location" ? "pack_contact_sheet.png" : "prop_sheet.png",
    mimeType: "image/png",
    purpose: "sheet_image",
    bytes: new Uint8Array(png),
    ...(signal ? { signal } : {}),
  });
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(assetSheet)
      .set({ fileId: file.id })
      .where(
        and(
          eq(assetSheet.id, sheetId),
          eq(assetSheet.status, "accepted"),
          isNull(assetSheet.fileId),
        ),
      )
      .returning();
    if (!row) return false;
    await logEvent(tx, row.projectId, null, "asset.sheet_ready", {
      assetId: row.assetId,
      sheetId: row.id,
      contactSheet: true,
    });
    return true;
  });
}

/** Queues the contact sheet of a locked pack. */
export async function enqueueAssemble(sheetId: string): Promise<void> {
  try {
    await enqueue(assetSheetAssemble, { sheetId });
  } catch (error) {
    console.error(`[assets] could not enqueue the contact sheet of ${sheetId}:`, error);
  }
}

/** The accepted views of the accepted packs of these assets (Production's per-shot references). */
export async function acceptedPackViews(
  db: DbExecutor,
  sheetIds: readonly string[],
): Promise<Map<string, { viewId: string; label: string; fileId: string }[]>> {
  const out = new Map<string, { viewId: string; label: string; fileId: string }[]>();
  if (sheetIds.length === 0) return out;
  const rows = await db
    .select({
      sheetId: assetSheetView.sheetId,
      viewId: assetSheetView.viewId,
      label: assetSheetView.label,
      fileId: assetSheetView.fileId,
    })
    .from(assetSheetView)
    .where(
      and(inArray(assetSheetView.sheetId, [...sheetIds]), eq(assetSheetView.status, "accepted")),
    )
    .orderBy(asc(assetSheetView.position));
  for (const r of rows) {
    if (!r.fileId) continue;
    const views = out.get(r.sheetId) ?? [];
    views.push({ viewId: r.viewId, label: r.label, fileId: r.fileId });
    out.set(r.sheetId, views);
  }
  return out;
}
