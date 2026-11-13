import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  PutObjectCommand,
  UploadPartCommand,
  type CompletedPart,
} from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { file } from "@/server/db/schema";
import { getBucket, getS3 } from "./client";
import { StorageError } from "./errors";
import {
  buildStorageKey,
  deleteObjectQuietly,
  findFile,
  markAbandoned,
  toFileInfo,
  type FileInfo,
  type FileRow,
} from "./files";
import {
  checkFileAllowed,
  matchesContentSignature,
  SIGNATURE_SAMPLE_BYTES,
  type FilePurpose,
} from "./purposes";
import { cleanDisplayName } from "./sanitize";

const MiB = 1024 * 1024;
/** Streams larger than this are sent as a multipart upload (S3 caps a single PUT at 5 GB). */
const DEFAULT_MULTIPART_THRESHOLD_BYTES = 64 * MiB;
/** S3 requires at least 5 MiB per part (except the last) and allows 10 000 parts. */
const DEFAULT_PART_SIZE_BYTES = 16 * MiB;
const MIN_PART_SIZE_BYTES = 5 * MiB;
/** Parts in flight at once; memory stays at about this many parts plus one being filled. */
const PART_CONCURRENCY = 3;

async function findReadyFile(fileId: string, ownerId?: string): Promise<FileRow> {
  const row = await findFile(fileId);
  if (!row || row.status !== "ready" || (ownerId !== undefined && row.ownerId !== ownerId)) {
    throw new StorageError("not_found", "File not found");
  }
  return row;
}

/**
 * Stream a ready file from the store (server and worker use). Without `ownerId` there is no
 * ownership check, so the caller must have authorised access; pass `ownerId` to also require
 * that the file belongs to that user (a mismatch is the same `not_found`). Consume or destroy
 * the stream.
 */
export async function openFileStream(
  fileId: string,
  options: { signal?: AbortSignal; ownerId?: string } = {},
): Promise<{ file: FileInfo; stream: Readable }> {
  const row = await findReadyFile(fileId, options.ownerId);
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
  options: { signal?: AbortSignal; ownerId?: string } = {},
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
  /** Tuning for streams (tests use small values; S3 still needs parts of at least 5 MiB). */
  multipart?: { thresholdBytes?: number; partSizeBytes?: number };
} & (
  | { bytes: Uint8Array }
  /** A stream needs its exact length up front; large ones go up as a multipart upload. */
  | { bytes: Readable; sizeBytes: number }
);

type PutObjectOptions = {
  key: string;
  mimeType: string;
  sizeBytes: number;
  signal?: AbortSignal;
  multipart?: PutFileInput["multipart"];
};

/** Single PUT for bytes and small streams, multipart above the threshold. */
async function putObject(body: Uint8Array | Readable, options: PutObjectOptions): Promise<void> {
  const { key, mimeType, sizeBytes, signal } = options;
  const threshold = options.multipart?.thresholdBytes ?? DEFAULT_MULTIPART_THRESHOLD_BYTES;
  if (body instanceof Uint8Array || sizeBytes <= threshold) {
    await getS3().send(
      new PutObjectCommand({
        Bucket: getBucket(),
        Key: key,
        Body: body,
        ContentType: mimeType,
        ContentLength: sizeBytes,
      }),
      { abortSignal: signal },
    );
    return;
  }
  const partSize = Math.max(
    options.multipart?.partSizeBytes ?? DEFAULT_PART_SIZE_BYTES,
    MIN_PART_SIZE_BYTES,
  );
  await putMultipart(body, { key, mimeType, sizeBytes, signal, partSize });
}

/**
 * Upload a stream of known length part by part. At most `PART_CONCURRENCY` parts are buffered
 * besides the one being filled, so memory stays flat whatever the size. Aborts the upload (so
 * the store frees the parts) on any failure or when the signal fires.
 */
async function putMultipart(
  stream: Readable,
  input: {
    key: string;
    mimeType: string;
    sizeBytes: number;
    signal: AbortSignal | undefined;
    partSize: number;
  },
): Promise<void> {
  const { key, signal, partSize } = input;
  const s3 = getS3();
  const bucket = getBucket();
  const { UploadId: uploadId } = await s3.send(
    new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: input.mimeType }),
    { abortSignal: signal },
  );
  if (!uploadId) throw new Error("The store did not return a multipart upload id");

  const parts: CompletedPart[] = [];
  const inFlight = new Set<Promise<void>>();
  let failure: unknown;
  let total = 0;
  let partNumber = 0;

  const sendPart = (body: Buffer): void => {
    const number = ++partNumber;
    const task = s3
      .send(
        new UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: number,
          Body: body,
          ContentLength: body.byteLength,
        }),
        { abortSignal: signal },
      )
      .then((response) => {
        parts.push({ ETag: response.ETag, PartNumber: number });
      })
      .catch((err: unknown) => {
        failure ??= err;
      })
      .finally(() => {
        inFlight.delete(task);
      });
    inFlight.add(task);
  };
  /** Wait until fewer than `limit` parts are in flight, then surface a failed part. */
  const drain = async (limit: number): Promise<void> => {
    while (inFlight.size >= limit && failure === undefined) await Promise.race(inFlight);
    if (failure !== undefined) throw failure;
    signal?.throwIfAborted();
  };

  try {
    let buffered: Buffer[] = [];
    let bufferedBytes = 0;
    for await (const chunk of stream) {
      const piece = Buffer.from(chunk as Uint8Array);
      total += piece.byteLength;
      if (total > input.sizeBytes) break;
      buffered.push(piece);
      bufferedBytes += piece.byteLength;
      if (bufferedBytes < partSize) continue;
      let all = Buffer.concat(buffered);
      while (all.byteLength >= partSize) {
        await drain(PART_CONCURRENCY);
        sendPart(Buffer.from(all.subarray(0, partSize)));
        all = all.subarray(partSize);
      }
      buffered = all.byteLength > 0 ? [Buffer.from(all)] : [];
      bufferedBytes = all.byteLength;
    }
    if (total !== input.sizeBytes) {
      throw new StorageError(
        "upload_mismatch",
        `The stream produced ${total} bytes but ${input.sizeBytes} were declared`,
      );
    }
    if (bufferedBytes > 0) {
      await drain(PART_CONCURRENCY);
      sendPart(Buffer.concat(buffered));
    }
    await drain(1);
    await Promise.all(inFlight);
    if (failure !== undefined) throw failure;
    parts.sort((a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0));
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
      { abortSignal: signal },
    );
  } catch (err) {
    stream.destroy();
    await Promise.allSettled(inFlight);
    await s3
      .send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }))
      .catch(() => undefined);
    throw err;
  }
}

/**
 * Store bytes produced on the server (for example a worker's output) as a new `ready` file.
 * The row is written as `pending` first, so a failed upload never looks available; if the upload
 * or the final update fails the object is deleted (best effort) and the row is marked
 * `abandoned`, never left pending. Bytes held in memory are checked against the type's content
 * signature before anything is written; streams are not inspected.
 */
export async function putFileBytes(input: PutFileInput): Promise<FileInfo> {
  const sizeBytes = "sizeBytes" in input ? input.sizeBytes : input.bytes.byteLength;
  const mimeType = checkFileAllowed({
    purpose: input.purpose,
    name: input.name,
    mimeType: input.mimeType,
    sizeBytes,
  });
  if (input.bytes instanceof Uint8Array) {
    const sample = input.bytes.subarray(0, SIGNATURE_SAMPLE_BYTES);
    if (!matchesContentSignature(mimeType, sample, sizeBytes <= SIGNATURE_SAMPLE_BYTES)) {
      throw new StorageError("upload_mismatch", "The file content does not match its type");
    }
  }
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
  try {
    await putObject(input.bytes, {
      key: storageKey,
      mimeType,
      sizeBytes,
      signal: input.signal,
      multipart: input.multipart,
    });
    const [row] = await db
      .update(file)
      .set({ status: "ready" })
      .where(and(eq(file.id, fileId), eq(file.status, "pending")))
      .returning();
    // No row: the sweeper retired this ticket while a very slow upload was running.
    if (!row) throw new Error(`File row ${fileId} was retired during upload`);
    return toFileInfo(row);
  } catch (err) {
    await deleteObjectQuietly(storageKey);
    await markAbandoned(fileId).catch(() => undefined);
    throw err;
  }
}
