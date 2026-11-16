/**
 * Cut detection and keyframe extraction for the video review (worker side; ffmpeg + sharp).
 * `frame-plan.ts` decides which moments to take; this file finds the cuts, grabs the frames and
 * stores them. A video is a path on disk or bytes (written to a temporary file, removed after).
 */
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpeg } from "@/server/providers/ffmpeg";
import { putFileBytes } from "@/server/storage/objects";
import type { DetectedCut } from "./frame-plan";

export {
  frameLabel,
  maxFramesFor,
  parseWindow,
  planFrames,
  windowLabel,
  type DetectedCut,
  type FrameReason,
  type PlannedFrame,
  type PlannedWindow,
} from "./frame-plan";

export type VideoSource = string | Uint8Array;

export type FfmpegCallOptions = { signal?: AbortSignal; timeoutMs?: number };

/** The scene-change score above which a frame counts as a cut (the owner's `gt(scene,0.3)`). */
export const CUT_SCENE_THRESHOLD = 0.3;
/** Cuts this close together are one cut (a fade or a flash is not two). */
export const MIN_CUT_GAP_S = 0.1;
/** The first frame always scores as a scene change on some ffmpeg builds; it is not a cut. */
const NO_CUT_BEFORE_S = 0.05;
/** The long edge of an extracted frame. */
export const FRAME_LONG_EDGE_PX = 768;
const FRAME_JPEG_QUALITY = 80;
/** Frames grabbed at the same time (each is a short ffmpeg process). */
export const FRAME_EXTRACT_CONCURRENCY = 3;

/** Runs `fn` with the video as a file path; bytes go to a temporary directory removed afterwards. */
async function withVideoFile<T>(video: VideoSource, fn: (path: string) => Promise<T>): Promise<T> {
  if (typeof video === "string") return fn(video);
  const dir = await mkdtemp(join(tmpdir(), "blaxzy-review-"));
  try {
    const path = join(dir, "clip.mp4");
    await writeFile(path, video);
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  }
}

/**
 * The `pts_time` of every frame `showinfo` logged, in seconds, sorted. Reads only
 * `Parsed_showinfo` lines with an `n:` counter (the per-frame lines), so the banner and the
 * summary line are ignored; a malformed number is skipped, never thrown on. Both `pts_time:4.2`
 * and `pts_time: 4.2` are accepted.
 */
export function parseShowinfoTimes(stderr: string): number[] {
  const times: number[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    if (!line.includes("showinfo") || !/\bn:\s*\d+/.test(line)) continue;
    const match = /pts_time:\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(line);
    if (!match) continue;
    const t = Number(match[1]);
    if (Number.isFinite(t) && t >= 0) times.push(t);
  }
  return times.sort((a, b) => a - b);
}

/** Cuts from raw times: drops the very start and merges cuts closer than `MIN_CUT_GAP_S`. */
export function cutsFromTimes(times: readonly number[]): DetectedCut[] {
  const cuts: DetectedCut[] = [];
  for (const t of times) {
    if (t < NO_CUT_BEFORE_S) continue;
    const prev = cuts[cuts.length - 1];
    if (prev && t - prev.t < MIN_CUT_GAP_S) continue;
    cuts.push({ t: Math.round(t * 1000) / 1000 });
  }
  return cuts;
}

/**
 * Scene changes of a clip (ffmpeg `select='gt(scene,0.3)',showinfo`), in seconds. ffmpeg logs to
 * stderr, of which `runFfmpeg` keeps the last 16 000 characters (about 60 cuts); a longer list
 * loses the earliest ones, which a 30 s clip never reaches. Throws when ffmpeg fails, is aborted
 * or times out.
 */
export async function detectCuts(
  video: VideoSource,
  options: FfmpegCallOptions & { threshold?: number } = {},
): Promise<DetectedCut[]> {
  const threshold = options.threshold ?? CUT_SCENE_THRESHOLD;
  return withVideoFile(video, async (path) => {
    const { stderr } = await runFfmpeg(
      [
        ...["-loglevel", "info", "-i", path, "-an", "-sn"],
        ...["-vf", `select='gt(scene,${threshold})',showinfo`],
        ...["-f", "null", "-"],
      ],
      { signal: options.signal, timeoutMs: options.timeoutMs },
    );
    return cutsFromTimes(parseShowinfoTimes(stderr));
  });
}

export type ExtractedFrame = {
  /** The requested time in seconds. */
  t: number;
  bytes: Uint8Array;
  width: number;
  height: number;
};

/** Resizes a still to `FRAME_LONG_EDGE_PX` on the long edge (never enlarging) and encodes a JPEG. */
async function toReviewJpeg(
  path: string,
): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const { default: sharp } = await import("sharp");
  const { data, info } = await sharp(await readFile(path))
    .resize({
      width: FRAME_LONG_EDGE_PX,
      height: FRAME_LONG_EDGE_PX,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: FRAME_JPEG_QUALITY, mozjpeg: true })
    .toBuffer({ resolveWithObject: true });
  return { bytes: new Uint8Array(data), width: info.width, height: info.height };
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

/**
 * Grabs one frame per time (seek before the input: fast, and accurate for re-encoded clips).
 * A time past the last frame falls back to the clip's last frame. Frames come back in the order
 * of `times`.
 */
export async function extractFrames(
  video: VideoSource,
  times: readonly number[],
  options: FfmpegCallOptions = {},
): Promise<ExtractedFrame[]> {
  if (times.length === 0) return [];
  return withVideoFile(video, async (path) => {
    const dir = await mkdtemp(join(tmpdir(), "blaxzy-frames-"));
    try {
      const results: ExtractedFrame[] = new Array(times.length);
      let next = 0;
      const lane = async () => {
        while (next < times.length) {
          const index = next++;
          const t = times[index]!;
          options.signal?.throwIfAborted();
          const out = join(dir, `grab_${index}.png`);
          const base = { signal: options.signal, timeoutMs: options.timeoutMs };
          await runFfmpeg(
            [
              "-loglevel",
              "error",
              "-ss",
              Math.max(0, t).toFixed(3),
              "-i",
              path,
              "-frames:v",
              "1",
              "-y",
              out,
            ],
            base,
          );
          if (!(await exists(out))) await grabLast(path, out, base);
          if (!(await exists(out))) throw new Error(`ffmpeg produced no frame at ${t}s`);
          results[index] = { t, ...(await toReviewJpeg(out)) };
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(FRAME_EXTRACT_CONCURRENCY, times.length) }, lane),
      );
      return results;
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}

/** Writes the clip's last frame to `out` (each decoded frame overwrites the file; the last stays). */
async function grabLast(path: string, out: string, options: FfmpegCallOptions): Promise<void> {
  await runFfmpeg(
    ["-loglevel", "error", "-sseof", "-0.5", "-i", path, "-update", "1", "-y", out],
    options,
  );
}

/** The clip's final frame as a review JPEG (stored as PREV_END for the next block). */
export async function lastFrame(
  video: VideoSource,
  options: FfmpegCallOptions = {},
): Promise<Omit<ExtractedFrame, "t">> {
  return withVideoFile(video, async (path) => {
    const dir = await mkdtemp(join(tmpdir(), "blaxzy-last-"));
    try {
      const out = join(dir, "last.png");
      await grabLast(path, out, options);
      if (!(await exists(out))) throw new Error("ffmpeg produced no final frame");
      return await toReviewJpeg(out);
    } finally {
      await rm(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
}

export type StoredReviewFrame = { id: string; t: number; fileId: string };

/**
 * Stores extracted frames as `review_frame` files (existing `file` table, no new tables) and
 * returns each one's file id, keyed by its plan id. `takeKey` only names the files. Frames are
 * uploaded two at a time; on failure the frames already stored stay (the file sweeper owns
 * orphans), and the error is thrown.
 */
export async function storeReviewFrames(input: {
  ownerId: string;
  projectId: string | null;
  takeKey: string;
  frames: readonly { id: string; t: number; bytes: Uint8Array }[];
  signal?: AbortSignal;
}): Promise<StoredReviewFrame[]> {
  const out: StoredReviewFrame[] = new Array(input.frames.length);
  let next = 0;
  const lane = async () => {
    while (next < input.frames.length) {
      const index = next++;
      const frame = input.frames[index]!;
      input.signal?.throwIfAborted();
      const info = await putFileBytes({
        ownerId: input.ownerId,
        projectId: input.projectId,
        name: `${input.takeKey}-${frame.id}-t${frame.t.toFixed(1)}.jpg`,
        mimeType: "image/jpeg",
        purpose: "review_frame",
        bytes: frame.bytes,
        signal: input.signal,
      });
      out[index] = { id: frame.id, t: frame.t, fileId: info.id };
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, input.frames.length) }, lane));
  return out;
}
