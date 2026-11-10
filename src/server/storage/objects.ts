import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { file } from "@/server/db/schema";
import { getBucket, getS3 } from "./client";
import { StorageError } from "./errors";
import { buildStorageKey, findFile, toFileInfo, type FileInfo, type FileRow } from "./files";
import { checkFileAllowed, type FilePurpose } from "./purposes";
import { cleanDisplayName } from "./sanitize";

async function findReadyFile(fileId: string): Promise<FileRow> {
  const row = await findFile(fileId);
  if (!row || row.status !== "ready") throw new StorageError("not_found", "File not found");
  return row;
}

/**
 * Stream a ready file from the store (server and worker use; no ownership check, so callers
 * must have authorised access). Consume or destroy the stream.
 */
export async function openFileStream(
  fileId: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ file: FileInfo; stream: Readable }> {
  const row = await findReadyFile(fileId);
  const response = await getS3().send(
    new GetObjectCommand({ Bucket: getBucket(), Key: row.storageKey }),
    { abortSignal: options.signal },
  );
  if (!(response.Body instanceof Readable)) {
    throw new Error(`Object for file ${fileId} has no readable body`);
  }
  return { file: toFileInfo(row), stream: response.Body };
}

/** The whole file in memory. Use `openFileStream` for large media. */
export async function readFileBytes(
  fileId: string,
  options: { signal?: AbortSignal } = {},
): Promise<Uint8Array> {
  const { stream } = await openFileStream(fileId, options);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return new Uint8Array(Buffer.concat(chunks));
}

export type PutFileInput = {
  ownerId: string;
  projectId?: string | null;
  name: string;
  mimeType: string;
  purpose: FilePurpose;
  signal?: AbortSignal;
} & (
  | { bytes: Uint8Array }
  /** A stream needs its exact length up front (single PUT, up to 5 GB). */
  | { bytes: Readable; sizeBytes: number }
);

/**
 * Store bytes produced on the server (for example a worker's output) as a new `ready` file.
 * The row is written as `pending` first, so a failed upload never looks available.
 */
export async function putFileBytes(input: PutFileInput): Promise<FileInfo> {
  const sizeBytes = "sizeBytes" in input ? input.sizeBytes : input.bytes.byteLength;
  const mimeType = checkFileAllowed({
    purpose: input.purpose,
    name: input.name,
    mimeType: input.mimeType,
    sizeBytes,
  });
  const fileId = randomUUID();
  const originalName = cleanDisplayName(input.name);
  const storageKey = buildStorageKey({
    ownerId: input.ownerId,
    projectId: input.projectId,
    fileId,
    name: originalName,
  });

  const db = getDb();
  await db.insert(file).values({
    id: fileId,
    ownerId: input.ownerId,
    projectId: input.projectId ?? null,
    storageKey,
    originalName,
    mimeType,
    sizeBytes,
    status: "pending",
  });
  await getS3().send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: storageKey,
      Body: input.bytes,
      ContentType: mimeType,
      ContentLength: sizeBytes,
    }),
    { abortSignal: input.signal },
  );
  const [row] = await db
    .update(file)
    .set({ status: "ready" })
    .where(eq(file.id, fileId))
    .returning();
  if (!row) throw new Error(`File row ${fileId} disappeared during upload`);
  return toFileInfo(row);
}
