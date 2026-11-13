import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/server/db/client";
import { file, type FileStatus } from "@/server/db/schema";
import { getBucket, getS3 } from "./client";
import { StorageError } from "./errors";
import { sanitizeFileName } from "./sanitize";

export type FileRow = typeof file.$inferSelect;

/** A file record as other modules see it (the storage key stays internal). */
export type FileInfo = {
  id: string;
  ownerId: string;
  projectId: string | null;
  originalName: string | null;
  mimeType: string;
  sizeBytes: number | null;
  status: FileStatus;
  createdAt: Date;
};

/**
 * Terminal status of an upload that never completed (ticket expired unused, or a server-side
 * write failed). The row is kept (data is append-only) but every reader treats it as missing.
 * The `status` column is free text; `FileStatus` should list this value.
 */
export const ABANDONED_STATUS = "abandoned";

function isAbandoned(row: FileRow): boolean {
  return (row.status as string) === ABANDONED_STATUS;
}

/** Move a `pending` row to `abandoned`. False when it was no longer pending (someone else won). */
export async function markAbandoned(fileId: string): Promise<boolean> {
  const rows = await getDb()
    .update(file)
    .set({ status: sql<FileStatus>`${ABANDONED_STATUS}` })
    .where(and(eq(file.id, fileId), eq(file.status, "pending")))
    .returning({ id: file.id });
  return rows.length > 0;
}

/** Delete an object; a missing object is fine. Returns false (never throws) when the store fails. */
export async function deleteObjectQuietly(key: string): Promise<boolean> {
  try {
    await getS3().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
    return true;
  } catch {
    return false;
  }
}

export function toFileInfo(row: FileRow): FileInfo {
  return {
    id: row.id,
    ownerId: row.ownerId,
    projectId: row.projectId,
    originalName: row.originalName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    status: row.status,
    createdAt: row.createdAt,
  };
}

const uuid = z.uuid();
const ownerIdPattern = /^[A-Za-z0-9_-]{1,128}$/;

/** `u/<ownerId>/<projectId or "_">/<fileId>/<sanitized name>` */
export function buildStorageKey(input: {
  ownerId: string;
  projectId?: string | null;
  fileId: string;
  name: string;
}): string {
  if (!ownerIdPattern.test(input.ownerId)) throw new Error("Invalid owner id");
  if (input.projectId && !uuid.safeParse(input.projectId).success) {
    throw new Error("Invalid project id");
  }
  return `u/${input.ownerId}/${input.projectId ?? "_"}/${input.fileId}/${sanitizeFileName(input.name)}`;
}

/** The row, or undefined for a missing row or a malformed id. */
export async function findFile(fileId: string): Promise<FileRow | undefined> {
  if (!uuid.safeParse(fileId).success) return undefined;
  const [row] = await getDb().select().from(file).where(eq(file.id, fileId)).limit(1);
  return row;
}

/** The file's record when it exists and belongs to the user, else null (for other modules). */
export async function getOwnedFileInfo(fileId: string, userId: string): Promise<FileInfo | null> {
  const row = await findFile(fileId);
  return row && row.ownerId === userId && !isAbandoned(row) ? toFileInfo(row) : null;
}

/** The row if it exists and belongs to the user; otherwise the same `not_found` either way. */
export async function findOwnedFile(fileId: string, userId: string): Promise<FileRow> {
  const row = await findFile(fileId);
  if (!row || row.ownerId !== userId || isAbandoned(row))
    throw new StorageError("not_found", "File not found");
  return row;
}
