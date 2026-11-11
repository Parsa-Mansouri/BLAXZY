/**
 * The sample provider's placeholder clips: a real MP4 (H.264, yuv420p, faststart; a silent AAC
 * track when sound is on) rendered locally with ffmpeg, no network.
 *
 * The still parts (dark ground, label, "SAMPLE" badge, watermark, progress track) and a timecode
 * per frame are drawn as SVG with sharp, like the sample images, so no font setup is needed in
 * ffmpeg. ffmpeg composites them with two moving elements (a light sweep and a playhead) and
 * encodes. Everything derives from the spec: the same spec gives the same clip, and a final made
 * with its draft's digest is visibly the same clip at a higher resolution.
 */
import { once } from "node:events";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GenerationPurpose } from "@/server/db/schema";
import { runFfmpeg } from "../ffmpeg";
import type { AspectRatio } from "../policy";
import type { ProviderResult } from "../types";
import {
  background,
  digestUnit,
  escapeXml,
  FONT,
  LABEL_COLOR,
  MONO,
  MUTED,
  paletteFor,
  PURPOSE_TEXT,
  sampleBadge,
  textLines,
  watermark,
  wrapText,
} from "./render";

export type VideoResolution = "480p" | "1080p";

export type SampleVideoSpec = {
  purpose: GenerationPurpose;
  label: string;
  aspectRatio: AspectRatio;
  resolution: VideoResolution;
  /** Whole seconds, 1..15. */
  durationSeconds: number;
  sound: boolean;
  /** Hex digest; the seed of the colours and the motion (a final reuses its draft's). */
  digest: string;
};

export const SAMPLE_VIDEO_FPS = 24;

/** Pixel size of a clip: draft 854x480, final 1920x1080 (swapped for 9:16). */
export function sampleVideoSize(spec: Pick<SampleVideoSpec, "resolution" | "aspectRatio">): {
  width: number;
  height: number;
} {
  const [long, short] = spec.resolution === "1080p" ? [1920, 1080] : [854, 480];
  return spec.aspectRatio === "9:16"
    ? { width: short, height: long }
    : { width: long, height: short };
}

type Layout = {
  width: number;
  height: number;
  m: number;
  inset: number;
  track: { x: number; y: number; w: number };
  dot: number;
  sweepW: number;
  timecode: { x: number; y: number; w: number; h: number; size: number };
};

function layoutFor(spec: SampleVideoSpec): Layout {
  const { width, height } = sampleVideoSize(spec);
  const m = Math.min(width, height);
  const inset = Math.round(m * 0.05);
  const trackX = inset * 2;
  const trackY = height - Math.round(m * 0.16);
  const size = Math.max(12, Math.round(m * 0.04));
  const tcH = Math.round(size * 1.6);
  return {
    width,
    height,
    m,
    inset,
    track: { x: trackX, y: trackY, w: width - trackX * 2 },
    dot: even(Math.max(10, Math.round(m * 0.04))),
    sweepW: even(Math.round(m * 0.22)),
    timecode: {
      x: trackX,
      y: trackY - Math.round(m * 0.03) - tcH,
      w: even(Math.round(size * 0.62 * 24)),
      h: even(tcH),
      size,
    },
  };
}

function even(n: number): number {
  return n % 2 === 0 ? n : n + 1;
}

/** The still frame: everything that does not move. */
export function sampleVideoSvg(spec: SampleVideoSpec): string {
  const l = layoutFor(spec);
  const { width, height, m, inset } = l;
  const p = paletteFor(spec.digest);
  const labelSize = Math.round(m * 0.085);
  const maxChars = Math.max(8, Math.floor((width * 0.8) / (labelSize * 0.6)));
  const lines = wrapText(spec.label || "Untitled", maxChars, 3);
  const blockHeight = labelSize * (1 + (lines.length - 1) * 1.18);
  const purposeSize = Math.round(m * 0.032);
  const top = height / 2 - blockHeight / 2 - m * 0.03;
  const purposeY = Math.round(top - labelSize * 0.6);
  const metaSize = Math.round(m * 0.026);
  const quality = `${spec.resolution.toUpperCase()} · ${spec.aspectRatio} · ${spec.durationSeconds}s`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  ${background(width, height, p)}
  <rect x="${inset}" y="${inset}" width="${width - inset * 2}" height="${height - inset * 2}" rx="${Math.round(m * 0.014)}"
    fill="none" stroke="${p.accent}" stroke-opacity="0.35" stroke-width="2"/>
  ${watermark(width, height)}
  ${sampleBadge(inset + Math.round(m * 0.03), inset + Math.round(m * 0.03), m)}
  <text x="${width - inset - Math.round(m * 0.03)}" y="${inset + Math.round(m * 0.03) + metaSize * 1.3}" font-family="${MONO}"
    font-size="${metaSize}" fill="${MUTED}" text-anchor="end">${escapeXml(quality)}</text>
  <text x="${width / 2}" y="${purposeY}" font-family="${FONT}" font-weight="600" font-size="${purposeSize}"
    letter-spacing="${purposeSize * 0.2}" fill="${p.accent}" text-anchor="middle">${escapeXml(PURPOSE_TEXT[spec.purpose].toUpperCase())}</text>
  ${textLines(lines, width / 2, top + labelSize * 0.7, labelSize, "middle")}
  <line x1="${l.track.x}" y1="${l.track.y}" x2="${l.track.x + l.track.w}" y2="${l.track.y}" stroke="${p.accentSoft}"
    stroke-width="${Math.max(2, Math.round(m * 0.006))}" stroke-linecap="round"/>
  <text x="${width / 2}" y="${height - Math.round(m * 0.075)}" font-family="${FONT}" font-size="${Math.round(m * 0.024)}"
    fill="${MUTED}" fill-opacity="0.75" text-anchor="middle">Placeholder video · not a real generation</text>
  <text x="${width - inset - Math.round(m * 0.03)}" y="${height - Math.round(m * 0.075)}" font-family="${MONO}"
    font-size="${Math.round(m * 0.02)}" fill="${MUTED}" fill-opacity="0.45" text-anchor="end">#${escapeXml(spec.digest.slice(0, 8))}</text>
</svg>`;
}

function dotSvg(size: number, color: string): string {
  const r = size / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <circle cx="${r}" cy="${r}" r="${r - 1}" fill="${color}"/></svg>`;
}

function sweepSvg(width: number, height: number, color: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="0">
    <stop offset="0" stop-color="${color}" stop-opacity="0"/>
    <stop offset="0.5" stop-color="${color}" stop-opacity="0.16"/>
    <stop offset="1" stop-color="${color}" stop-opacity="0"/>
  </linearGradient></defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/></svg>`;
}

/** SMPTE-style timecode at 24 fps and the frame counter, e.g. `00:00:03:12  F085/240`. */
export function timecodeText(frame: number, durationSeconds: number): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  const seconds = Math.floor(frame / SAMPLE_VIDEO_FPS);
  const total = durationSeconds * SAMPLE_VIDEO_FPS;
  return `00:00:${pad(seconds)}:${pad(frame % SAMPLE_VIDEO_FPS)}  F${pad(frame + 1, 3)}/${total}`;
}

function timecodeSvg(text: string, l: Layout): string {
  const { w, h, size } = l.timecode;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <text x="0" y="${Math.round(h * 0.72)}" font-family="${MONO}" font-size="${size}" fill="${LABEL_COLOR}"
    fill-opacity="0.85">${escapeXml(text)}</text></svg>`;
}

async function svgToPng(svg: string, path: string): Promise<void> {
  const { default: sharp } = await import("sharp");
  await sharp(Buffer.from(svg)).png({ compressionLevel: 1 }).toFile(path);
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function eachLimited<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++] as T;
      await fn(item);
    }
  });
  await Promise.all(lanes);
}

/** ffmpeg arguments that composite and encode the clip in `dir` (exported for tests). */
export function sampleVideoArgs(spec: SampleVideoSpec, dir: string, output: string): string[] {
  const l = layoutFor(spec);
  const d = String(spec.durationSeconds);
  const fps = String(SAMPLE_VIDEO_FPS);
  // Motion from the seed: the sweep's period, phase and direction.
  const period = (3 + digestUnit(spec.digest, 6) * 2).toFixed(3);
  const phase = digestUnit(spec.digest, 7).toFixed(3);
  const travel = l.width + l.sweepW;
  const sweepX =
    digestUnit(spec.digest, 8) < 0.5
      ? `-${l.sweepW}+${travel}*mod(t/${period}+${phase},1)`
      : `${l.width}-${travel}*mod(t/${period}+${phase},1)`;
  const dotX = `${l.track.x}+${l.track.w - l.dot}*t/${d}`;
  const dotY = l.track.y - l.dot / 2;
  const final = spec.resolution === "1080p";

  const filter = [
    `[0:v][2:v]overlay=x='${sweepX}':y=0:shortest=1[a]`,
    `[a][3:v]overlay=x='${dotX}':y=${dotY}:shortest=1[b]`,
    `[b][1:v]overlay=x=${l.timecode.x}:y=${l.timecode.y}:eof_action=repeat[c]`,
    `[c]format=yuv420p[v]`,
  ].join(";");

  const args = [
    "-loglevel",
    "error",
    ...["-loop", "1", "-framerate", fps, "-t", d, "-i", join(dir, "still.png")],
    ...["-framerate", fps, "-i", join(dir, "tc_%04d.png")],
    ...["-loop", "1", "-framerate", fps, "-t", d, "-i", join(dir, "sweep.png")],
    ...["-loop", "1", "-framerate", fps, "-t", d, "-i", join(dir, "dot.png")],
  ];
  if (spec.sound) {
    args.push("-f", "lavfi", "-t", d, "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  }
  args.push("-filter_complex", filter, "-map", "[v]");
  if (spec.sound) args.push("-map", "4:a", "-c:a", "aac", "-b:a", "48k", "-flags:a", "+bitexact");
  args.push(
    ...["-c:v", "libx264", "-preset", "veryfast", "-crf", final ? "26" : "30"],
    ...["-pix_fmt", "yuv420p", "-profile:v", "high", "-r", fps, "-g", String(SAMPLE_VIDEO_FPS * 2)],
    ...["-t", d, "-movflags", "+faststart", "-map_metadata", "-1"],
    ...["-fflags", "+bitexact", "-flags:v", "+bitexact"],
    "-y",
    output,
  );
  return args;
}

/**
 * Renders the clip and its poster (a JPEG frame from one second in). Returns the MP4 as a stream
 * of known length; `dispose` removes the temporary files.
 */
export async function renderSampleVideo(
  spec: SampleVideoSpec,
  options: { signal?: AbortSignal } = {},
): Promise<ProviderResult> {
  const dir = await mkdtemp(join(tmpdir(), "blaxzy-video-"));
  const dispose = () => rm(dir, { recursive: true, force: true, maxRetries: 3 });
  try {
    const l = layoutFor(spec);
    const p = paletteFor(spec.digest);
    await svgToPng(sampleVideoSvg(spec), join(dir, "still.png"));
    await svgToPng(sweepSvg(l.sweepW, l.height, p.accent), join(dir, "sweep.png"));
    await svgToPng(dotSvg(l.dot, p.accent), join(dir, "dot.png"));
    const frames = Array.from({ length: spec.durationSeconds * SAMPLE_VIDEO_FPS }, (_, i) => i);
    await eachLimited(frames, 32, async (frame) => {
      options.signal?.throwIfAborted();
      const name = `tc_${String(frame).padStart(4, "0")}.png`;
      await svgToPng(timecodeSvg(timecodeText(frame, spec.durationSeconds), l), join(dir, name));
    });

    const output = join(dir, "clip.mp4");
    await runFfmpeg(sampleVideoArgs(spec, dir, output), { signal: options.signal });
    const posterPath = join(dir, "poster.jpg");
    const at = Math.min(1, spec.durationSeconds / 2).toFixed(2);
    await runFfmpeg(
      [
        "-loglevel",
        "error",
        "-ss",
        at,
        "-i",
        output,
        "-frames:v",
        "1",
        "-q:v",
        "3",
        "-y",
        posterPath,
      ],
      { signal: options.signal },
    );
    const poster = new Uint8Array(await readFile(posterPath));
    const { size } = await stat(output);
    const stream = createReadStream(output);
    return {
      mimeType: "video/mp4",
      stream,
      sizeBytes: size,
      poster: { bytes: poster, mimeType: "image/jpeg" },
      dispose: async () => {
        if (!stream.closed) {
          const closed = once(stream, "close");
          stream.destroy();
          await closed;
        }
        await dispose();
      },
    };
  } catch (err) {
    await dispose();
    throw err;
  }
}

/** For tests: write the result's MP4 to `path` and dispose of it. */
export async function saveResult(result: ProviderResult, path: string): Promise<void> {
  try {
    if ("bytes" in result) await writeFile(path, result.bytes);
    else await writeFile(path, result.stream);
  } finally {
    await result.dispose?.();
  }
}
