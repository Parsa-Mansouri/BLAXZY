/**
 * Shared internals of the designers (character, location and prop generators) on the service
 * side: the guided questions of an asset, its reference photos, and props that wait for the
 * locations they stand in. Not exported from the module index.
 */
import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import {
  designerFor,
  designerQuestions,
  MAX_DESIGN_REFERENCES,
  nameKey,
  REFERENCE_ROLES,
  type GuidedQuestion,
} from "@/server/damis";
import { getDb, type DbExecutor } from "@/server/db/client";
import {
  asset,
  assetLook,
  type AssetLookStatus,
  type LookReference,
  type ProjectStyle,
} from "@/server/db/schema";
import { assetLookGenerate, enqueue } from "@/server/jobs";
import { FILE_PURPOSES, getOwnedFileInfo } from "@/server/storage";
import type { AssetRow } from "./looks";
import { AssetInputError } from "./service";

/** The guided questions still to ask for an asset (skip logic per generator). */
export function questionsFor(row: AssetRow, style: ProjectStyle | null): GuidedQuestion[] {
  return designerQuestions(row.kind, {
    asset: { name: row.name, description: row.description, details: row.details },
    project: {
      ...(style?.eraSetting ? { eraSetting: style.eraSetting } : {}),
      ...(style ? { genre: style.genre, visualStyle: style.visualStyle } : {}),
    },
  });
}

export const MAX_REFERENCE_NOTE = 1000;

export const referenceInputSchema = z.object({
  fileId: z.string(),
  role: z.string().trim().min(1).max(40),
  note: z
    .string()
    .trim()
    .max(MAX_REFERENCE_NOTE, `Keep each photo's note under ${MAX_REFERENCE_NOTE} characters.`)
    .optional(),
});
export type ReferenceInput = z.output<typeof referenceInputSchema>;

const uuid = z.uuid();
const NOT_USABLE = "One of the photos is not available. Add it again.";

/**
 * The user's reference photos, checked: ready images the user owns (of this project or none), at
 * most four, each with a role this asset's designer reads. Returns them as stored on the look.
 */
export async function checkReferences(
  row: AssetRow,
  userId: string,
  references: readonly ReferenceInput[],
): Promise<LookReference[]> {
  if (references.length === 0) return [];
  const designer = designerFor(row.kind);
  if (!designer) throw new AssetInputError("Voices take a recording, not photos.");
  if (references.length > MAX_DESIGN_REFERENCES) {
    throw new AssetInputError(`Use at most ${MAX_DESIGN_REFERENCES} photos.`);
  }
  const roles = new Set<string>(REFERENCE_ROLES[designer].map((r) => r.value));
  const seen = new Set<string>();
  const out: LookReference[] = [];
  const purpose = FILE_PURPOSES.asset_image;
  const allowed: Readonly<Record<string, readonly string[]>> = purpose.types;
  for (const ref of references) {
    if (!uuid.safeParse(ref.fileId).success) throw new AssetInputError(NOT_USABLE);
    if (seen.has(ref.fileId)) throw new AssetInputError("The same photo was added twice.");
    seen.add(ref.fileId);
    if (!roles.has(ref.role)) throw new AssetInputError("Choose what each photo is for.");
    const file = await getOwnedFileInfo(ref.fileId, userId);
    if (!file || file.status !== "ready") throw new AssetInputError(NOT_USABLE);
    if (file.projectId !== null && file.projectId !== row.projectId) {
      throw new AssetInputError(NOT_USABLE);
    }
    if (!(file.mimeType in allowed) || (file.sizeBytes ?? 0) > purpose.maxBytes) {
      throw new AssetInputError("Photos must be .png, .jpg or .webp images.");
    }
    out.push({ fileId: ref.fileId, role: ref.role, ...(ref.note ? { note: ref.note } : {}) });
  }
  if (designer === "location" && out.filter((r) => r.role === "hero").length > 1) {
    throw new AssetInputError("Only one photo can be the place itself.");
  }
  return out;
}

/** Look statuses of a location still being designed: a prop placed there waits for it. */
const IN_FLIGHT: readonly AssetLookStatus[] = ["pending", "needs_input", "in_review"];

/**
 * The locations a prop stands in (the detector's `locationIds`) whose Hero is still being made or
 * reviewed, by name. A prop drawn by the prop designer waits for them, so it can match the
 * approved location. Empty for other designers.
 */
export async function locationsInFlight(db: DbExecutor, row: AssetRow): Promise<string[]> {
  if (designerFor(row.kind) !== "prop") return [];
  const names = [...new Set((row.details?.locationIds ?? []).map(nameKey))];
  if (names.length === 0) return [];
  const locations = await db
    .select({ id: asset.id, name: asset.name })
    .from(asset)
    .where(
      and(
        eq(asset.projectId, row.projectId),
        eq(asset.kind, "location"),
        eq(asset.status, "active"),
        ne(asset.priority, "skipped"),
        inArray(sql`lower(${asset.name})`, names),
      ),
    );
  if (locations.length === 0) return [];
  const latest = await db
    .selectDistinctOn([assetLook.assetId], { assetId: assetLook.assetId, status: assetLook.status })
    .from(assetLook)
    .where(
      inArray(
        assetLook.assetId,
        locations.map((l) => l.id),
      ),
    )
    .orderBy(assetLook.assetId, desc(assetLook.versionNumber));
  const busy = new Set(latest.filter((l) => IN_FLIGHT.includes(l.status)).map((l) => l.assetId));
  return locations.filter((l) => busy.has(l.id)).map((l) => l.name);
}

/** A pending look no job has worked on yet (no prompt, no dami run, no generation). */
export function untouched(look: {
  status: AssetLookStatus;
  prompt: string | null;
  damiRunId: string | null;
  generationId: string | null;
}): boolean {
  return (
    look.status === "pending" &&
    look.prompt === null &&
    look.damiRunId === null &&
    look.generationId === null
  );
}

/**
 * Starts the props that waited for a location of the project once none of their locations is
 * still being designed. Called after a location's look is accepted, fails, is replaced or the
 * location is removed. Bounded by the project's pending looks.
 */
export async function wakeWaitingLooks(projectId: string): Promise<number> {
  const db = getDb();
  const waiting = await db
    .select({ look: assetLook, asset })
    .from(assetLook)
    .innerJoin(asset, eq(asset.id, assetLook.assetId))
    .where(
      and(
        eq(assetLook.projectId, projectId),
        eq(assetLook.status, "pending"),
        isNull(assetLook.prompt),
        isNull(assetLook.damiRunId),
        isNull(assetLook.generationId),
        isNull(assetLook.parentId),
      ),
    )
    .limit(200);
  let woken = 0;
  for (const { look, asset: row } of waiting) {
    if (designerFor(row.kind) !== "prop") continue;
    if ((await locationsInFlight(db, row)).length > 0) continue;
    try {
      // A job already queued for the look has the same dedupe key: this send is then a no-op.
      await enqueue(assetLookGenerate, { lookId: look.id });
      woken++;
    } catch (error) {
      console.error(`[assets] could not wake look ${look.id}:`, error);
    }
  }
  return woken;
}
