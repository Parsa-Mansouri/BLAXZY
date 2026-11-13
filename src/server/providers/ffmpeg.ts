/**
 * ffmpeg for media work in the worker (sample video, posters, probing). Never loaded by a page
 * render: everything here runs only when called.
 *
 * The binary: `FFMPEG_PATH` when set; else the `ffmpeg-static` package when it is installed
 * (local development); else `ffmpeg` on the PATH (the worker Docker image installs it and sets
 * `FFMPEG_PATH`). `ffmpeg-static` is imported at run time only, never bundled or traced: the
 * import carries the bundler-ignore comments (Next) and the worker bundle keeps it external
 * (esbuild `--external:ffmpeg-static`), so neither image ships its binary.
 */
import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { envSchema } from "@/server/env";
import { ProviderError } from "./errors";

/** ffmpeg cannot be found or started on this server. */
export class FfmpegUnavailableError extends ProviderError {
  constructor(readonly detail: string) {
    super(
      "Video rendering is not available on this server (ffmpeg is missing). Contact support.",
      false,
    );
    this.name = "FfmpegUnavailableError";
  }
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The `ffmpeg-static` binary when the package and its binary are installed, else null. */
async function ffmpegStaticPath(): Promise<string | null> {
  try {
    const imported: { default: unknown } = await import(
      /* webpackIgnore: true */ /* turbopackIgnore: true */ "ffmpeg-static"
    );
    const resolved = imported.default;
    if (typeof resolved === "string" && (await isExecutableFile(resolved))) return resolved;
  } catch {
    // Not installed (production images): fall through.
  }
  return null;
}

/** Runs `<binary> -version`; true when it starts and exits 0. */
function answersVersion(binary: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(/* turbopackIgnore: true */ binary, ["-hide_banner", "-version"], {
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

let resolving: Promise<string> | undefined;

async function resolveUncached(): Promise<string> {
  // Deliberately not getEnv(): that parses the whole environment and throws without DATABASE_URL,
  // storage settings and so on, while scripts/dev-generation and the media tests only render or
  // probe. The variable is still validated with its own schema entry.
  const configured = envSchema.shape.FFMPEG_PATH.parse(process.env.FFMPEG_PATH);
  if (configured) {
    if (await isExecutableFile(configured)) return configured;
    throw new FfmpegUnavailableError(`FFMPEG_PATH=${configured} is not an executable file`);
  }
  const bundled = await ffmpegStaticPath();
  if (bundled) return bundled;
  if (await answersVersion("ffmpeg")) return "ffmpeg";
  throw new FfmpegUnavailableError(
    "ffmpeg not found: set FFMPEG_PATH, install the ffmpeg-static package, or put ffmpeg on the PATH",
  );
}

/**
 * The ffmpeg binary to run (cached per process; a failed lookup is retried on the next call).
 * Throws `FfmpegUnavailableError`.
 */
export function resolveFfmpeg(): Promise<string> {
  if (!resolving) {
    const attempt = resolveUncached();
    resolving = attempt;
    attempt.catch(() => {
      if (resolving === attempt) resolving = undefined;
    });
  }
  return resolving;
}

/** Whether ffmpeg can be used here (tests skip video rendering when it cannot). */
export async function ffmpegAvailable(): Promise<boolean> {
  try {
    await resolveFfmpeg();
    return true;
  } catch {
    return false;
  }
}

const STDERR_TAIL = 4_000;

/** A hung ffmpeg is stopped after this long (a sample clip renders in seconds). */
export const FFMPEG_TIMEOUT_MS = 5 * 60 * 1000;

/** After SIGTERM, a process that has not exited within this long is sent SIGKILL. */
export const FFMPEG_KILL_GRACE_MS = 5_000;

export type RunFfmpegOptions = {
  signal?: AbortSignal;
  allowFailure?: boolean;
  /** Overrides `FFMPEG_TIMEOUT_MS` for this call. */
  timeoutMs?: number;
  /** Overrides `FFMPEG_KILL_GRACE_MS` for this call. */
  killGraceMs?: number;
};

/** ffmpeg did not finish within its timeout and was killed. */
export class FfmpegTimeoutError extends Error {
  constructor(timeoutMs: number, stderr: string) {
    super(`ffmpeg timed out after ${timeoutMs} ms: ${stderr.slice(-STDERR_TAIL)}`);
    this.name = "FfmpegTimeoutError";
  }
}

/**
 * Runs ffmpeg with `args` (no shell). Resolves with its stderr (ffmpeg logs there); rejects with
 * the stderr tail when it exits non-zero. When `signal` aborts or the timeout passes, the process
 * gets SIGTERM and, if it is still alive after the grace period, SIGKILL; the promise settles only
 * once the process has exited.
 */
export async function runFfmpeg(
  args: string[],
  options: RunFfmpegOptions = {},
): Promise<{ code: number | null; stderr: string }> {
  const binary = await resolveFfmpeg();
  const timeoutMs = options.timeoutMs ?? FFMPEG_TIMEOUT_MS;
  const killGraceMs = options.killGraceMs ?? FFMPEG_KILL_GRACE_MS;
  const { signal } = options;
  if (signal?.aborted) throw signal.reason ?? new Error("aborted");
  return new Promise((resolve, reject) => {
    // The binary is chosen at run time; tell Next not to trace it (that would pull in the project).
    const child = spawn(/* turbopackIgnore: true */ binary, ["-hide_banner", "-nostdin", ...args], {
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let stderr = "";
    let stopped: "abort" | "timeout" | null = null;
    let killTimer: NodeJS.Timeout | undefined;
    const stop = (why: "abort" | "timeout") => {
      if (stopped) return;
      stopped = why;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
    };
    const onAbort = () => stop("abort");
    const timeout = setTimeout(() => stop("timeout"), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
    };
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL * 4);
    });
    child.once("error", (err) => {
      cleanup();
      reject(new FfmpegUnavailableError(`ffmpeg failed to start: ${err.message}`));
    });
    child.once("close", (code) => {
      cleanup();
      if (stopped === "abort") reject(signal?.reason ?? new Error("ffmpeg was aborted"));
      else if (stopped === "timeout") reject(new FfmpegTimeoutError(timeoutMs, stderr));
      else if (code === 0 || options.allowFailure) resolve({ code, stderr });
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-STDERR_TAIL)}`));
    });
  });
}

export type MediaProbe = {
  durationSeconds: number | null;
  video: { codec: string; pixelFormat: string | null; width: number; height: number } | null;
  audio: { codec: string } | null;
};

/** Parses the stream summary ffmpeg prints for an input (`ffmpeg -i file`). */
export function parseProbe(stderr: string): MediaProbe {
  const duration = /Duration: (\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(stderr);
  const durationSeconds = duration
    ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
    : null;
  const videoLine = /Stream #\d+:\d+[^\n]*: Video: ([^\n]+)/.exec(stderr)?.[1] ?? null;
  let video: MediaProbe["video"] = null;
  if (videoLine) {
    const codec = /^(\w+)/.exec(videoLine)?.[1] ?? "unknown";
    const size = /(?:^|[\s,])(\d{2,5})x(\d{2,5})(?=[\s,\[]|$)/.exec(videoLine);
    const pixelFormat = /\b(yuv\w+|rgb\w+|rgba|gray\w*|pal8|nv12)\b/.exec(videoLine)?.[1] ?? null;
    video = {
      codec,
      pixelFormat,
      width: size ? Number(size[1]) : 0,
      height: size ? Number(size[2]) : 0,
    };
  }
  const audioLine = /Stream #\d+:\d+[^\n]*: Audio: (\w+)/.exec(stderr);
  return { durationSeconds, video, audio: audioLine?.[1] ? { codec: audioLine[1] } : null };
}

/** Duration and streams of a media file on disk (via ffmpeg; no ffprobe needed). */
export async function probeMedia(path: string, signal?: AbortSignal): Promise<MediaProbe> {
  const { stderr } = await runFfmpeg(["-i", path], { signal, allowFailure: true });
  if (!/Input #0/.test(stderr))
    throw new Error(`ffmpeg could not read ${path}: ${stderr.slice(-500)}`);
  return parseProbe(stderr);
}
