import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getBucket, getPresignS3 } from "./client";
import { StorageError } from "./errors";
import { findOwnedFile } from "./files";
import { attachmentDisposition } from "./sanitize";

const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

export type DownloadLink = { url: string; expiresAt: Date };

/**
 * A short-lived presigned GET for a ready file the user owns. Missing, pending and foreign files
 * all fail with the same `not_found`. With `downloadName` the browser saves the file under that
 * name instead of displaying it.
 */
export async function getDownloadUrl(input: {
  fileId: string;
  userId: string;
  downloadName?: string;
}): Promise<DownloadLink> {
  const row = await findOwnedFile(input.fileId, input.userId);
  if (row.status !== "ready") throw new StorageError("not_found", "File not found");
  const command = new GetObjectCommand({
    Bucket: getBucket(),
    Key: row.storageKey,
    ResponseContentDisposition:
      input.downloadName === undefined ? undefined : attachmentDisposition(input.downloadName),
  });
  const url = await getSignedUrl(getPresignS3(), command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
  return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000) };
}
