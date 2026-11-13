import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getBucket, getPresignS3 } from "./client";
import { StorageError } from "./errors";
import { findOwnedFile } from "./files";
import { attachmentDisposition } from "./sanitize";

const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

/** Only these types may render inline from the bucket origin; everything else is a download. */
function mayRenderInline(mimeType: string): boolean {
  const family = mimeType.split("/")[0];
  return (
    (family === "image" || family === "video" || family === "audio") && mimeType !== "image/svg+xml"
  );
}

export type DownloadLink = { url: string; expiresAt: Date };

/**
 * A short-lived presigned GET for a ready file the user owns. Missing, pending and foreign files
 * all fail with the same `not_found`. The response type comes from the row (not from what was
 * uploaded) and is private-cached. Images, video and audio display inline; any other type is
 * always an attachment, saved under `downloadName` when given.
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
    ResponseContentType: row.mimeType,
    ResponseCacheControl: "private, max-age=300",
    ResponseContentDisposition:
      input.downloadName !== undefined
        ? attachmentDisposition(input.downloadName)
        : mayRenderInline(row.mimeType)
          ? undefined
          : attachmentDisposition(row.originalName ?? "download"),
  });
  const url = await getSignedUrl(getPresignS3(), command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
  return { url, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000) };
}
