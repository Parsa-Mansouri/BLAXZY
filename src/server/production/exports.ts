/**
 * The finished film: accepted finals one by one (presigned downloads with organised names) and all
 * together as a ZIP (`export_bundle`, built by the `export.build` job by streaming from and to the
 * object store; an unchanged film reuses its last bundle).
 */
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { pageCurrentBlocks, type PromptBlock } from "@/server/blocks";
import { getDb, type DbExecutor } from "@/server/db/client";
import { exportBundle, project, type ExportStatus } from "@/server/db/schema";
import { exportBuild, enqueue } from "@/server/jobs";
import { listEpisodes } from "@/server/projects";
import { decodeOrderCursor, encodeOrderCursor } from "@/server/projects/cursor";
import {
  FILE_PURPOSES,
  getDownloadUrl,
  getOwnedFileInfo,
  openFileStream,
  putFileBytes,
  StorageError,
} from "@/server/storage";
import { isUuid, openLineage, openProject, parse, userIdSchema, type ProjectRow } from "./access";
import { ProductionInputError } from "./errors";
import { clipDownloadName, exportDownloadName, shotsCsv } from "./names";
import { notFinalMessage } from "./service";
import { deriveBlockStage } from "./stage";
import { latestLiveTake, latestLiveTakes, logEvent, type TakeRow } from "./takes";
import { assertZipFits, crc32Of, storedZipStream, ZipLimitError, type StoredEntry } from "./zip";

export type FinishedClip = {
  lineageId: string;
  orderIndex: number;
  title: string | null;
  durationSeconds: number | null;
  fileId: string;
  posterFileId: string | null;
  /** `<project-slug>_B012_<title-slug>.mp4` (a series: `<project-slug>_E01_B012_…`) */
  downloadName: string;
};

export type ExportView = {
  id: string;
  status: ExportStatus;
  clipCount: number;
  failure: string | null;
  /** Presigned (5 minutes), saved under `<project-slug>_clips.zip`; null until ready. */
  downloadUrl: string | null;
};

export const DEFAULT_CLIP_PAGE_SIZE = 50;
export const MAX_CLIP_PAGE_SIZE = 200;
const SCAN_BATCH = 500;

/** The largest ZIP an export stores (the storage limit of its purpose). */
const EXPORT_MAX_BYTES = FILE_PURPOSES.export_zip.maxBytes;

export const EXPORT_TOO_LARGE = `This film is larger than ${Math.floor(
  EXPORT_MAX_BYTES / 1024 ** 3,
)} GB, too large for one ZIP. Download the clips one by one.`;
export const EXPORT_CHANGED =
  "The film changed while the ZIP was being prepared. Ask for the ZIP again.";

const listInput = z.object({
  limit: z.number().int().min(1).max(MAX_CLIP_PAGE_SIZE).default(DEFAULT_CLIP_PAGE_SIZE),
  cursor: z.string().max(200).nullish(),
});

function decodeCursor(cursor: string): { orderIndex: number; id: string } {
  const decoded = decodeOrderCursor(cursor);
  if (!decoded) {
    throw new ProductionInputError("That page link is no longer valid. Reload the list.");
  }
  return decoded;
}

/** The accepted final of a block when the block is done, else null. */
function finalOf(block: PromptBlock, take: TakeRow | null): (TakeRow & { fileId: string }) | null {
  if (!take || deriveBlockStage(block, take) !== "done" || !take.fileId) return null;
  return { ...take, fileId: take.fileId };
}

async function episodeNumbers(projectId: string, ownerId: string): Promise<Map<string, number>> {
  const episodes = (await listEpisodes(projectId, ownerId)) ?? [];
  return new Map(episodes.map((e) => [e.id, e.number]));
}

/** The block's episode number in a series; null in a movie (its names carry no episode). */
function episodeOf(
  row: Pick<ProjectRow, "style">,
  episodes: ReadonlyMap<string, number>,
  block: Pick<PromptBlock, "episodeId">,
): number | null {
  if (row.style?.format !== "series") return null;
  return block.episodeId ? (episodes.get(block.episodeId) ?? 1) : 1;
}

function toClip(
  row: ProjectRow,
  episodes: ReadonlyMap<string, number>,
  block: PromptBlock,
  final: TakeRow & { fileId: string },
): FinishedClip {
  return {
    lineageId: block.lineageId,
    orderIndex: block.orderIndex,
    title: block.title,
    durationSeconds: block.durationSeconds,
    fileId: final.fileId,
    posterFileId: final.posterFileId,
    downloadName: clipDownloadName({
      projectTitle: row.title,
      episodeNumber: episodeOf(row, episodes, block),
      orderIndex: block.orderIndex,
      title: block.title,
    }),
  };
}

/** One page of the finished clips (blocks with an accepted final), in story order. */
export async function listFinishedClips(
  projectId: string,
  userId: string,
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<{ items: FinishedClip[]; nextCursor: string | null } | null> {
  const { limit, cursor } = parse(listInput, opts);
  const db = getDb();
  const owned = await openProject(db, projectId, userId);
  if (!owned) return null;
  const takes = await latestLiveTakes(db, projectId);
  const finished = [...takes.values()]
    .filter((t) => t.stage === "final" && t.status === "accepted")
    .map((t) => t.lineageId);
  const rows = await pageCurrentBlocks(
    projectId,
    { limit: limit + 1, after: cursor ? decodeCursor(cursor) : null, lineageIds: finished },
    db,
  );
  const page = rows.slice(0, limit);
  const episodes = await episodeNumbers(projectId, userId);
  const items: FinishedClip[] = [];
  for (const block of page) {
    const final = finalOf(block, takes.get(block.lineageId) ?? null);
    if (final) items.push(toClip(owned, episodes, block, final));
  }
  const last = page.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last ? encodeOrderCursor(last.orderIndex, last.id) : null,
  };
}

/** A presigned download of a block's accepted final, saved under its organised name. */
export async function getClipDownloadUrl(input: {
  lineageId: string;
  userId: string;
}): Promise<string | null> {
  const { lineageId, userId } = parse(
    z.object({ lineageId: z.string(), userId: userIdSchema }),
    input,
  );
  const db = getDb();
  const opened = await openLineage(db, lineageId, userId);
  if (!opened) return null;
  const final = finalOf(opened.block, await latestLiveTake(db, lineageId));
  if (!final) return null;
  const episodes = await episodeNumbers(opened.project.id, userId);
  const clip = toClip(opened.project, episodes, opened.block, final);
  try {
    const link = await getDownloadUrl({
      fileId: clip.fileId,
      userId,
      downloadName: clip.downloadName,
    });
    return link.url;
  } catch (error) {
    // Only a missing file reads as "no clip"; anything else is a real failure.
    if (error instanceof StorageError && error.code === "not_found") return null;
    throw error;
  }
}

/* ------------------------------------------------------------------------------------------ */
/* The whole film                                                                              */
/* ------------------------------------------------------------------------------------------ */

type FilmClip = FinishedClip & { block: PromptBlock; takeId: string; episodeNumber: number | null };

/** Every current block in story order with its final (if done), and the film's content key. */
async function loadFilm(
  db: DbExecutor,
  row: ProjectRow,
): Promise<{ clips: FilmClip[]; total: number; contentKey: string }> {
  const takes = await latestLiveTakes(db, row.id);
  const episodes = await episodeNumbers(row.id, row.ownerId);
  const clips: FilmClip[] = [];
  let total = 0;
  let after: { orderIndex: number; id: string } | null = null;
  for (;;) {
    const page: PromptBlock[] = await pageCurrentBlocks(row.id, { limit: SCAN_BATCH, after }, db);
    for (const block of page) {
      total++;
      const final = finalOf(block, takes.get(block.lineageId) ?? null);
      if (final) {
        clips.push({
          ...toClip(row, episodes, block, final),
          block,
          takeId: final.id,
          episodeNumber: episodeOf(row, episodes, block),
        });
      }
    }
    const last = page.at(-1);
    if (page.length < SCAN_BATCH || !last) break;
    after = { orderIndex: last.orderIndex, id: last.id };
  }
  const contentKey = createHash("sha256")
    .update(clips.map((c) => c.takeId).join(","))
    .digest("hex");
  return { clips, total, contentKey };
}

async function toExportView(
  bundle: typeof exportBundle.$inferSelect,
  row: Pick<ProjectRow, "title">,
): Promise<ExportView> {
  let downloadUrl: string | null = null;
  if (bundle.status === "ready" && bundle.fileId) {
    try {
      downloadUrl = (
        await getDownloadUrl({
          fileId: bundle.fileId,
          userId: bundle.userId,
          downloadName: exportDownloadName(row.title),
        })
      ).url;
    } catch (error) {
      if (!(error instanceof StorageError && error.code === "not_found")) throw error;
    }
  }
  return {
    id: bundle.id,
    status: bundle.status,
    clipCount: bundle.clipCount,
    failure: bundle.failure,
    downloadUrl,
  };
}

/**
 * Asks for a ZIP of every finished clip (all blocks must be done). Reuses the newest ready (or
 * still pending) bundle of the same clips; otherwise creates a pending one and queues
 * `export.build` in the same transaction.
 */
export async function requestExport(input: {
  projectId: string;
  userId: string;
}): Promise<ExportView | null> {
  const { projectId, userId } = parse(
    z.object({ projectId: z.string(), userId: userIdSchema }),
    input,
  );
  const outcome = await getDb().transaction(async (tx) => {
    const owned = await openProject(tx, projectId, userId, true);
    if (!owned) return null;
    const film = await loadFilm(tx, owned);
    if (film.total === 0) throw new ProductionInputError("There are no shots yet.");
    if (film.clips.length !== film.total) {
      throw new ProductionInputError(notFinalMessage(film.total - film.clips.length));
    }
    const [existing] = await tx
      .select()
      .from(exportBundle)
      .where(
        and(
          eq(exportBundle.projectId, projectId),
          eq(exportBundle.contentKey, film.contentKey),
          inArray(exportBundle.status, ["ready", "pending"]),
        ),
      )
      .orderBy(desc(exportBundle.createdAt))
      .limit(1);
    if (existing) return { bundle: existing, project: owned };
    const [bundle] = await tx
      .insert(exportBundle)
      .values({
        projectId,
        userId,
        status: "pending",
        clipCount: film.clips.length,
        contentKey: film.contentKey,
      })
      .returning();
    if (!bundle) throw new Error("export_bundle insert returned no row");
    await logEvent(tx, projectId, userId, "production.export_requested", {
      exportId: bundle.id,
      clips: film.clips.length,
    });
    await enqueue(exportBuild, { exportId: bundle.id }, { tx });
    return { bundle, project: owned };
  });
  if (!outcome) return null;
  return toExportView(outcome.bundle, outcome.project);
}

/** The export, or null when it is missing or not the user's. */
export async function getExport(exportId: string, userId: string): Promise<ExportView | null> {
  if (!isUuid(exportId)) return null;
  const [row] = await getDb()
    .select({ bundle: exportBundle, title: project.title })
    .from(exportBundle)
    .innerJoin(project, eq(project.id, exportBundle.projectId))
    .where(
      and(
        eq(exportBundle.id, exportId),
        eq(exportBundle.userId, userId),
        eq(project.ownerId, userId),
        isNull(project.archivedAt),
      ),
    )
    .limit(1);
  return row ? toExportView(row.bundle, { title: row.title }) : null;
}

/* ------------------------------------------------------------------------------------------ */
/* Building the ZIP (worker)                                                                   */
/* ------------------------------------------------------------------------------------------ */

/** pending → failed with a user-readable reason. Returns whether this call changed it. */
export async function failExport(exportId: string, failure: string): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(exportBundle)
      .set({ status: "failed", failure, finishedAt: new Date() })
      .where(and(eq(exportBundle.id, exportId), eq(exportBundle.status, "pending")))
      .returning();
    if (!row) return false;
    await logEvent(tx, row.projectId, null, "production.export_failed", { exportId, failure });
    return true;
  });
}

async function isPendingExport(exportId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ status: exportBundle.status })
    .from(exportBundle)
    .where(eq(exportBundle.id, exportId))
    .limit(1);
  return row?.status === "pending";
}

/**
 * Builds a pending export: the accepted finals in story order under their download names, plus
 * `shots.csv`, as a stored ZIP streamed from the object store into one upload of exactly known
 * length (a CRC pass over each clip first, so nothing is held in memory or on disk). Fails the
 * export (no retry) when the film changed since it was requested or does not fit one ZIP; other
 * errors are thrown for the job to retry. Returns whether a ZIP was stored.
 */
export async function buildExport(exportId: string, signal?: AbortSignal): Promise<boolean> {
  if (!isUuid(exportId)) return false;
  const db = getDb();
  const [found] = await db
    .select({ bundle: exportBundle, project })
    .from(exportBundle)
    .innerJoin(project, eq(project.id, exportBundle.projectId))
    .where(and(eq(exportBundle.id, exportId), isNull(project.archivedAt)))
    .limit(1);
  if (!found || found.bundle.status !== "pending") return false;
  const { bundle, project: row } = found;
  const film = await loadFilm(db, row);
  if (film.contentKey !== bundle.contentKey || film.clips.length !== film.total) {
    await failExport(exportId, EXPORT_CHANGED);
    return false;
  }

  const csv = new TextEncoder().encode(
    shotsCsv(
      film.clips.map((c) => ({
        order: c.orderIndex + 1,
        episode: c.episodeNumber,
        title: c.title ?? "",
        durationSeconds: c.durationSeconds,
        fileName: c.downloadName,
        scriptExcerpt: c.block.scriptExcerpt,
      })),
    ),
  );
  const sized: { clip: FilmClip; size: number }[] = [];
  for (const clip of film.clips) {
    const info = await getOwnedFileInfo(clip.fileId, row.ownerId);
    if (!info || info.status !== "ready" || !info.sizeBytes) {
      throw new Error(`clip file ${clip.fileId} is not available`);
    }
    sized.push({ clip, size: info.sizeBytes });
  }
  let total: number;
  try {
    total = assertZipFits(
      [
        { name: "shots.csv", size: csv.byteLength },
        ...sized.map((s) => ({ name: s.clip.downloadName, size: s.size })),
      ],
      EXPORT_MAX_BYTES,
    );
  } catch (error) {
    if (error instanceof ZipLimitError) {
      await failExport(exportId, EXPORT_TOO_LARGE);
      return false;
    }
    throw error;
  }

  const entries: StoredEntry[] = [
    {
      name: "shots.csv",
      size: csv.byteLength,
      crc: (await crc32Of(csv)).crc,
      open: async () => csv,
    },
  ];
  for (const { clip, size } of sized) {
    const { stream } = await openFileStream(clip.fileId, { signal, ownerId: row.ownerId });
    const sum = await crc32Of(stream);
    if (sum.size !== size) throw new Error(`clip file ${clip.fileId} changed size`);
    entries.push({
      name: clip.downloadName,
      size,
      crc: sum.crc,
      open: async () =>
        (await openFileStream(clip.fileId, { signal, ownerId: row.ownerId })).stream,
    });
  }

  // The CRC pass can take long: a run that lost the race (another attempt finished, or the export
  // failed meanwhile) stops before uploading a ZIP nobody would use.
  if (!(await isPendingExport(exportId))) return false;

  const stored = await putFileBytes({
    ownerId: row.ownerId,
    projectId: row.id,
    name: exportDownloadName(row.title),
    mimeType: "application/zip",
    purpose: "export_zip",
    bytes: storedZipStream(entries),
    sizeBytes: total,
    signal,
  });
  return getDb().transaction(async (tx) => {
    const [ready] = await tx
      .update(exportBundle)
      .set({ status: "ready", fileId: stored.id, failure: null, finishedAt: new Date() })
      .where(and(eq(exportBundle.id, exportId), eq(exportBundle.status, "pending")))
      .returning({ id: exportBundle.id });
    if (!ready) return false;
    await logEvent(tx, row.id, null, "production.export_ready", {
      exportId,
      fileId: stored.id,
      clips: film.clips.length,
      sizeBytes: total,
    });
    return true;
  });
}
