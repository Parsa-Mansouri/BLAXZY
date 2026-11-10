import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { file } from "@/server/db/schema";
import { getBucket, getPresignS3, getS3 } from "./client";
import { StorageError } from "./errors";
import { buildStorageKey, findOwnedFile, toFileInfo, type FileInfo } from "./files";
import { checkFileAllowed, normalizeMimeType, type FilePurpose } from "./purposes";
import { cleanDisplayName } from "./sanitize";

const UPLOAD_URL_TTL_SECONDS = 15 * 60;

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
  });
  const uploadUrl = await getSignedUrl(getPresignS3(), command, {
    expiresIn: UPLOAD_URL_TTL_SECONDS,
    // Signed, so the store refuses a PUT with another type or length.
    signableHeaders: new Set(["content-type", "content-length"]),
  });
  return {
    fileId,
    uploadUrl,
    method: "PUT",
    headers: { "Content-Type": mimeType },
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
  if (!sizeMatches || !typeMatches) {
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
  // No row updated: a concurrent confirm got there first.
  return toFileInfo(updated ?? { ...row, status: "ready" });
}
