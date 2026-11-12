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

/** PUTs the file to the presigned URL, reporting progress. */
export function putFile(
  url: string,
  headers: Record<string, string>,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error()));
    xhr.onerror = () => reject(new Error());
    xhr.onabort = () => reject(new Error());
    xhr.send(file);
  });
}

/** Why a file cannot be a reference photo, or null when it can. */
export function photoProblem(file: File): string | null {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!IMAGE_TYPES[extension]) return "This file type cannot be used. Choose a PNG, JPEG or WebP.";
  if (file.size === 0) return "This file is empty. Choose another one.";
  if (file.size > MAX_PHOTO_BYTES) {
    return "This photo is larger than 25 MB. Export a smaller version and try again.";
  }
  return null;
}

/**
 * Uploads one reference photo straight to storage and confirms it; nothing starts on the server.
 * Returns the file's id to send with a design or a review.
 */
export async function uploadReferencePhoto(
  assetId: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<{ ok: true; fileId: string } | { ok: false; error: string }> {
  const problem = photoProblem(file);
  if (problem) return { ok: false, error: problem };
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const ticket = await createAssetUploadAction(assetId, {
    name: file.name,
    type: IMAGE_TYPES[extension] ?? "",
    size: file.size,
  });
  if (!ticket.ok) return { ok: false, error: ticket.error };
  try {
    await putFile(ticket.data.uploadUrl, ticket.data.headers, file, onProgress);
  } catch {
    return {
      ok: false,
      error: "The upload failed. Check your connection and add the photo again.",
    };
  }
  const confirmed = await confirmReferenceUploadAction(ticket.data.fileId);
  if (!confirmed.ok) return { ok: false, error: confirmed.error };
  return { ok: true, fileId: ticket.data.fileId };
}
