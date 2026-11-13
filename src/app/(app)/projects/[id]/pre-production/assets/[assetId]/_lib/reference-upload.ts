import { fileMime, fileProblem, uploadViaTicket } from "@/lib/upload";
import { confirmReferenceUploadAction, createAssetUploadAction } from "../actions";

const MB = 1024 * 1024;
export const MAX_PHOTO_BYTES = 25 * MB;

export const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const IMAGE_ACCEPT = Object.keys(IMAGE_TYPES)
  .map((ext) => `.${ext}`)
  .join(",");

/** Why a file cannot be a reference photo, or null when it can. */
export function photoProblem(file: File): string | null {
  return fileProblem(file, {
    types: IMAGE_TYPES,
    maxBytes: MAX_PHOTO_BYTES,
    messages: {
      type: "This file type cannot be used. Choose a PNG, JPEG or WebP.",
      empty: "This file is empty. Choose another one.",
      size: "This photo is larger than 25 MB. Export a smaller version and try again.",
    },
  });
}

/**
 * Uploads one reference photo straight to storage and confirms it; nothing starts on the server.
 * Returns the file's id to send with a design or a review. Never throws.
 */
export async function uploadReferencePhoto(
  assetId: string,
  file: File,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<{ ok: true; fileId: string } | { ok: false; error: string; aborted?: boolean }> {
  const problem = photoProblem(file);
  if (problem) return { ok: false, error: problem };
  const result = await uploadViaTicket({
    createTicket: () =>
      createAssetUploadAction(assetId, {
        name: file.name,
        type: fileMime(file, IMAGE_TYPES),
        size: file.size,
      }),
    file,
    confirm: (fileId) => confirmReferenceUploadAction(fileId),
    onProgress,
    signal,
    uploadFailedMessage: "The upload failed. Check your connection and add the photo again.",
  });
  return result.ok ? { ok: true, fileId: result.fileId } : result;
}
