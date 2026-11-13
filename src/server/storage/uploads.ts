import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, count, eq, gt, lt, asc } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { file } from "@/server/db/schema";
import { getBucket, getPresignS3, getS3 } from "./client";
import { StorageError } from "./errors";
import {
  buildStorageKey,
  deleteObjectQuietly,
  findOwnedFile,
  markAbandoned,
  toFileInfo,
  type FileInfo,
} from "./files";
import {
  checkFileAllowed,
  matchesContentSignature,
  normalizeMimeType,
  SIGNATURE_SAMPLE_BYTES,
  type FilePurpose,
} from "./purposes";
import { cleanDisplayName } from "./sanitize";

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
/** Unfinished tickets one user may hold at once (those created within the ticket lifetime). */
export const MAX_PENDING_UPLOADS_PER_OWNER = 50;
/** A pending row is only swept this long after creation (ticket lifetime plus a generous grace). */
const ABANDONED_AFTER_MINUTES = 60;
const SWEEP_BATCH_SIZE = 100;

export type CreateUploadInput = {
  ownerId: string;
  /** The caller must have checked that the owner may write to this project. */
  projectId?: string | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  purpose: FilePurpose;
};

export type UploadTicket = {
  fileId: string;
  /** Presigned URL; the browser sends the bytes here directly. */
  uploadUrl: string;
  method: "PUT";
  /** Headers the browser must send with the PUT, exactly as given. */
  headers: Record<string, string>;
  expiresAt: Date;
};

async function assertUnderPendingLimit(ownerId: string): Promise<void> {
  const since = new Date(Date.now() - UPLOAD_URL_TTL_SECONDS * 1000);
  const [row] = await getDb()
    .select({ n: count() })
    .from(file)
    .where(and(eq(file.ownerId, ownerId), eq(file.status, "pending"), gt(file.createdAt, since)));
  if ((row?.n ?? 0) >= MAX_PENDING_UPLOADS_PER_OWNER) {
    throw new StorageError(
      "too_many_uploads",
      "Too many uploads are waiting to finish; wait a few minutes and try again",
    );
  }
}

/**
 * Validate the declared file, record it as `pending` and return a presigned PUT bound to its
 * content type and length. Call `confirmUpload` once the browser's PUT has succeeded.
 */
export async function createUpload(input: CreateUploadInput): Promise<UploadTicket> {
  const mimeType = checkFileAllowed({
    purpose: input.purpose,
    name: input.originalName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  });
  await assertUnderPendingLimit(input.ownerId);
  const fileId = randomUUID();
  const originalName = cleanDisplayName(input.originalName);
  const storageKey = buildStorageKey({
    ownerId: input.ownerId,
    projectId: input.projectId,
    fileId,
    name: originalName,
  });

  await getDb()
    .insert(file)
    .values({
      id: fileId,
      ownerId: input.ownerId,
      projectId: input.projectId ?? null,
      storageKey,
      originalName,
      mimeType,
      sizeBytes: input.sizeBytes,
      status: "pending",
    });

  const command = new PutObjectCommand({
    Bucket: getBucket(),
    Key: storageKey,
    ContentType: mimeType,
    ContentLength: input.sizeBytes,
    // Conditional write: the store refuses (412) a PUT to a key that already holds an object, so
    // the reusable presigned URL cannot change the bytes after `confirmUpload` accepted them.
    IfNoneMatch: "*",
  });
  const uploadUrl = await getSignedUrl(getPresignS3(), command, {
    expiresIn: UPLOAD_URL_TTL_SECONDS,
    // Signed, so the store refuses a PUT with another type, length or without the condition.
    signableHeaders: new Set(["content-type", "content-length", "if-none-match"]),
  });
  return {
    fileId,
    uploadUrl,
    method: "PUT",
    headers: { "Content-Type": mimeType, "If-None-Match": "*" },
    expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000),
  };
}

async function headObject(key: string): Promise<HeadObjectCommandOutput | undefined> {
  try {
    return await getS3().send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }));
  } catch (err) {
    if (err instanceof NotFound || (err as { name?: string }).name === "NotFound") return undefined;
    throw err;
  }
}

/** Ranged GET of the first bytes, compared with the signature of the declared type. */
async function signatureMatches(key: string, mimeType: string, size: number): Promise<boolean> {
  const response = await getS3().send(
    new GetObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Range: `bytes=0-${SIGNATURE_SAMPLE_BYTES - 1}`,
    }),
  );
  if (!response.Body) return false;
  const sample = await response.Body.transformToByteArray();
  return matchesContentSignature(mimeType, sample, size <= SIGNATURE_SAMPLE_BYTES);
}

/**
 * Check the uploaded object against what was declared and mark the file `ready`. Idempotent:
 * confirming a ready file returns it unchanged. A mismatching object is deleted.
 */
export async function confirmUpload(input: { fileId: string; ownerId: string }): Promise<FileInfo> {
  const row = await findOwnedFile(input.fileId, input.ownerId);
  if (row.status === "ready") return toFileInfo(row);

  const head = await headObject(row.storageKey);
  if (!head) throw new StorageError("not_uploaded", "The file has not been uploaded yet");
  const sizeMatches = head.ContentLength === row.sizeBytes;
  const typeMatches = normalizeMimeType(head.ContentType ?? "") === row.mimeType;
  const matches =
    sizeMatches &&
    typeMatches &&
    (await signatureMatches(row.storageKey, row.mimeType, head.ContentLength ?? 0));
  if (!matches) {
    await getS3().send(new DeleteObjectCommand({ Bucket: getBucket(), Key: row.storageKey }));
    throw new StorageError(
      "upload_mismatch",
      "The uploaded file does not match what was declared; upload it again",
    );
  }

  const [updated] = await getDb()
    .update(file)
    .set({ status: "ready" })
    .where(and(eq(file.id, row.id), eq(file.status, "pending")))
    .returning();
  if (updated) return toFileInfo(updated);
  // No row updated: a concurrent confirm got there first, or the sweeper retired the ticket.
  const current = await findOwnedFile(input.fileId, input.ownerId);
  if (current.status !== "ready") throw new StorageError("not_found", "File not found");
  return toFileInfo(current);
}

/**
 * Retire `pending` uploads nobody finished: delete the object if present and mark the row
 * `abandoned` (rows are never deleted). Bounded per call; safe on several workers at once (the
 * status change is conditional, so each row is counted by exactly one sweeper). A row whose
 * object could not be deleted stays pending and is retried by the next sweep.
 */
export async function sweepAbandonedUploads(
  options: { olderThanMinutes?: number; now?: Date; batchSize?: number } = {},
): Promise<{ swept: number }> {
  const now = options.now ?? new Date();
  const cutoff = new Date(
    now.getTime() - (options.olderThanMinutes ?? ABANDONED_AFTER_MINUTES) * 60_000,
  );
  const rows = await getDb()
    .select({ id: file.id, storageKey: file.storageKey })
    .from(file)
    .where(and(eq(file.status, "pending"), lt(file.createdAt, cutoff)))
    .orderBy(asc(file.createdAt))
    .limit(Math.max(1, options.batchSize ?? SWEEP_BATCH_SIZE));
  let swept = 0;
  for (const row of rows) {
    if (!(await deleteObjectQuietly(row.storageKey))) continue;
    if (await markAbandoned(row.id)) swept += 1;
  }
  return { swept };
}
