import { isPromptImage, type DamiPrompt } from "./define";

/** Images sent to Claude are downscaled so their long edge is at most this many pixels. */
export const MAX_IMAGE_EDGE_PX = 1568;

/** An image ready for the Messages API (base64 bytes). */
export type ResolvedImage = { mediaType: "image/jpeg" | "image/png"; data: string };

/** Loads one image by file id. Injectable through `DamiRunnerDeps.resolveImage`. */
export type ImageResolver = (fileId: string, signal?: AbortSignal) => Promise<ResolvedImage>;

/** The distinct image file ids a prompt refers to, in first-seen order. */
export function promptImageIds(prompt: DamiPrompt): string[] {
  const ids = new Set<string>();
  for (const message of prompt.messages) {
    for (const part of message.content) if (isPromptImage(part)) ids.add(part.image.fileId);
  }
  return [...ids];
}

/**
 * Downscales image bytes to `MAX_IMAGE_EDGE_PX` on the long edge (never enlarges) and re-encodes
 * them: PNG when the image has transparency, JPEG otherwise. sharp is loaded on first use.
 */
export async function prepareImageBytes(bytes: Uint8Array): Promise<ResolvedImage> {
  const { default: sharp } = await import("sharp");
  const source = sharp(bytes, { failOn: "error" }).rotate();
  const { hasAlpha } = await source.metadata();
  const resized = source.resize({
    width: MAX_IMAGE_EDGE_PX,
    height: MAX_IMAGE_EDGE_PX,
    fit: "inside",
    withoutEnlargement: true,
  });
  const buffer = hasAlpha
    ? await resized.png({ compressionLevel: 9 }).toBuffer()
    : await resized.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  return { mediaType: hasAlpha ? "image/png" : "image/jpeg", data: buffer.toString("base64") };
}

/** The production resolver: reads the file from object storage, then `prepareImageBytes`. */
export const storageImageResolver: ImageResolver = async (fileId, signal) => {
  const { readFileBytes } = await import("@/server/storage/objects");
  return prepareImageBytes(await readFileBytes(fileId, { signal }));
};

/** Resolves every image of a prompt (in parallel), keyed by file id. */
export async function resolvePromptImages(
  prompt: DamiPrompt,
  resolve: ImageResolver,
  signal?: AbortSignal,
): Promise<Map<string, ResolvedImage>> {
  const ids = promptImageIds(prompt);
  const resolved = await Promise.all(ids.map((id) => resolve(id, signal)));
  return new Map(ids.map((id, i) => [id, resolved[i]]));
}
