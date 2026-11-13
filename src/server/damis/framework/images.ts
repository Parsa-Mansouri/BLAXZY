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

/** Most distinct images one request may carry (the API accepts about 100; stay well under). */
export const MAX_PROMPT_IMAGES = 40;

/** Total size of all base64 image data of one request (the API limit is 32 MB per request). */
export const MAX_PROMPT_IMAGE_BYTES = 20 * 1024 * 1024;

/** Images loaded and decoded at the same time (each decode holds the full bitmap in memory). */
export const IMAGE_LOAD_CONCURRENCY = 3;

/** sharp refuses to decode images with more pixels than this (a decompression-bomb guard). */
export const MAX_INPUT_PIXELS = 100_000_000;

/** Decoded formats we accept, whatever MIME type the file was stored under. */
export const ALLOWED_IMAGE_FORMATS: readonly string[] = ["png", "jpeg", "webp", "gif"];

/**
 * An image that can never be used (not an allowed format, undecodable, too many or too large for
 * one request, no such file). The run fails with an input error; retrying cannot help. Every other
 * failure while loading (network, storage outage) is retryable.
 */
export class ImageUnusableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ImageUnusableError";
  }
}

/** True for failures that retrying cannot fix: unusable images and storage "no such file" errors. */
export function isUnusableImageError(error: unknown): boolean {
  return (
    error instanceof ImageUnusableError || (error instanceof Error && error.name === "StorageError")
  );
}

/**
 * Downscales image bytes to `MAX_IMAGE_EDGE_PX` on the long edge (never enlarges) and re-encodes
 * them: PNG when the image has transparency, JPEG otherwise. sharp is loaded on first use. Throws
 * `ImageUnusableError` for a format outside `ALLOWED_IMAGE_FORMATS`, an oversized or corrupt image.
 */
export async function prepareImageBytes(bytes: Uint8Array): Promise<ResolvedImage> {
  const { default: sharp } = await import("sharp");
  try {
    const source = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).rotate();
    const { hasAlpha, format } = await source.metadata();
    if (!format || !ALLOWED_IMAGE_FORMATS.includes(format)) {
      throw new ImageUnusableError(
        `Unsupported image format "${format ?? "unknown"}": use PNG, JPEG, WebP or GIF`,
      );
    }
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
  } catch (error) {
    if (error instanceof ImageUnusableError) throw error;
    throw new ImageUnusableError(
      `The image could not be decoded: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

/** The production resolver: reads the file from object storage, then `prepareImageBytes`. */
export const storageImageResolver: ImageResolver = async (fileId, signal) => {
  const { readFileBytes } = await import("@/server/storage/objects");
  return prepareImageBytes(await readFileBytes(fileId, { signal }));
};

/**
 * Resolves every image of a prompt, keyed by file id, at most `IMAGE_LOAD_CONCURRENCY` at a time.
 * Throws `ImageUnusableError` when the prompt has more than `MAX_PROMPT_IMAGES` images or the
 * loaded data exceeds `MAX_PROMPT_IMAGE_BYTES`; the first loading error stops the rest.
 */
export async function resolvePromptImages(
  prompt: DamiPrompt,
  resolve: ImageResolver,
  signal?: AbortSignal,
): Promise<Map<string, ResolvedImage>> {
  const ids = promptImageIds(prompt);
  if (ids.length > MAX_PROMPT_IMAGES) {
    throw new ImageUnusableError(
      `The request has ${ids.length} images; at most ${MAX_PROMPT_IMAGES} can be sent`,
    );
  }
  const resolved = new Map<string, ResolvedImage>();
  let next = 0;
  let totalBytes = 0;
  let failure: { error: unknown } | undefined;
  const worker = async () => {
    while (!failure && next < ids.length) {
      const id = ids[next++]!;
      try {
        signal?.throwIfAborted();
        const image = await resolve(id, signal);
        totalBytes += image.data.length;
        if (totalBytes > MAX_PROMPT_IMAGE_BYTES) {
          throw new ImageUnusableError(
            `The images of this request are larger than ${MAX_PROMPT_IMAGE_BYTES / (1024 * 1024)} MB in total`,
          );
        }
        resolved.set(id, image);
      } catch (error) {
        failure ??= { error };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(IMAGE_LOAD_CONCURRENCY, ids.length) }, worker));
  if (failure) throw failure.error;
  return new Map(ids.map((id) => [id, resolved.get(id)!]));
}
