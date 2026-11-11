import type {
  GenerationKind,
  GenerationPurpose,
  Orientation,
  ProjectStyle,
} from "@/server/db/schema";
import type { ModelChoice } from "./types";

export type AspectRatio = "16:9" | "9:16";

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

export function aspectRatioFor(orientation: Orientation): AspectRatio {
  return orientation === "portrait" ? "9:16" : "16:9";
}

/** The model and parameters the platform uses for a purpose in a project of this style. */
export function pickModel(purpose: GenerationPurpose, style: ProjectStyle): ModelChoice {
  const entry = MODEL_POLICY[purpose];
  if (!entry) throw new Error(`No model policy for purpose "${purpose}"`);
  const aspectRatio = entry.aspect === "project" ? aspectRatioFor(style.orientation) : entry.aspect;
  return { kind: entry.kind, model: entry.model, params: { ...entry.params, aspectRatio } };
}
