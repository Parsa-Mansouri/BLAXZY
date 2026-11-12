import type {
  GenerationKind,
  GenerationPurpose,
  Orientation,
  ProjectStyle,
} from "@/server/db/schema";
import type { ModelChoice } from "./types";

/** Every ratio an image may take; videos only take `VIDEO_ASPECT_RATIOS`. */
export const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const VIDEO_ASPECT_RATIOS = ["16:9", "9:16"] as const;
export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number];

export function isAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === "string" && (ASPECT_RATIOS as readonly string[]).includes(value);
}

export function isVideoAspectRatio(value: unknown): value is VideoAspectRatio {
  return typeof value === "string" && (VIDEO_ASPECT_RATIOS as readonly string[]).includes(value);
}

type PolicyEntry = {
  kind: GenerationKind;
  model: string;
  /** `project` follows the project's orientation; a fixed ratio ignores it. */
  aspect: "project" | AspectRatio;
  params: Readonly<Record<string, unknown>>;
};

/**
 * The platform's model policy: which model and parameters each purpose uses. THE single place to
 * change model ids, resolutions or ratios; nothing else in the codebase names a model. The choice
 * is stored on every `generation` row, so Pro can show it (and later let users override it).
 *
 * Sheets are always landscape: a turnaround with several views reads best side by side.
 */
export const MODEL_POLICY: Readonly<Record<GenerationPurpose, PolicyEntry>> = {
  asset_look: {
    kind: "image",
    model: "nano_banana_pro",
    aspect: "project",
    params: { resolution: "2k" },
  },
  asset_sheet: {
    kind: "image",
    model: "nano_banana_pro",
    aspect: "16:9",
    params: { resolution: "2k" },
  },
  block_draft: {
    kind: "video",
    model: "seedance_2_5",
    aspect: "project",
    params: { resolution: "480p", quality: "draft" },
  },
  block_final: {
    kind: "video",
    model: "seedance_2_5",
    aspect: "project",
    params: { resolution: "1080p", quality: "final" },
  },
};

export function aspectRatioFor(orientation: Orientation): VideoAspectRatio {
  return orientation === "portrait" ? "9:16" : "16:9";
}

/** Shortest and longest clip a video generation may ask for, in seconds. */
export const VIDEO_DURATION_LIMITS = { min: 1, max: 15, default: 5 } as const;

/** Whole seconds within `VIDEO_DURATION_LIMITS` (the default for a missing or invalid value). */
export function clampDurationSeconds(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return VIDEO_DURATION_LIMITS.default;
  return Math.min(
    VIDEO_DURATION_LIMITS.max,
    Math.max(VIDEO_DURATION_LIMITS.min, Math.round(value)),
  );
}

/** What a caller decides about a video (ignored for images). */
export type VideoOptions = { durationSeconds?: number; sound?: boolean };

/** What a caller may override for one generation. */
export type GenerationOverrides = {
  /** Instead of the policy's ratio. Images take any `ASPECT_RATIOS`; videos 16:9 or 9:16. */
  aspectRatio?: AspectRatio;
};

/**
 * The model and parameters the platform uses for a purpose in a project of this style. Video
 * params also carry `durationSeconds` (clamped to 1..15 s, default 5) and `sound` (default
 * false) next to the policy's `resolution`. `overrides.aspectRatio` replaces the policy's ratio
 * (throws for a video ratio other than 16:9 or 9:16).
 */
export function pickModel(
  purpose: GenerationPurpose,
  style: ProjectStyle,
  video: VideoOptions = {},
  overrides: GenerationOverrides = {},
): ModelChoice {
  const entry = MODEL_POLICY[purpose];
  if (!entry) throw new Error(`No model policy for purpose "${purpose}"`);
  if (
    overrides.aspectRatio &&
    entry.kind === "video" &&
    !isVideoAspectRatio(overrides.aspectRatio)
  ) {
    throw new Error(`A video cannot be ${overrides.aspectRatio}: use 16:9 or 9:16`);
  }
  const aspectRatio =
    overrides.aspectRatio ??
    (entry.aspect === "project" ? aspectRatioFor(style.orientation) : entry.aspect);
  const params: Record<string, unknown> = { ...entry.params, aspectRatio };
  if (entry.kind === "video") {
    params.durationSeconds = clampDurationSeconds(video.durationSeconds);
    params.sound = video.sound ?? false;
  }
  return { kind: entry.kind, model: entry.model, params };
}
