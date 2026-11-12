/**
 * The guided questions a designer asks when the director would rather answer than write: pure
 * data plus the skip logic of each generator (deterministic, no dami call). Each generator keeps
 * its own list in its `questions.ts`; `designerQuestions` picks the list for an asset kind and
 * drops what the script or the project already answers. Every question also takes the user's own
 * words ("Not what you have in mind?") and "I'm not sure", sent as `ai_decides`.
 */
import type { AssetDetails, AssetKind } from "@/server/db/schema";

export type GuidedQuestion = {
  /** Stable key, unique within its generator; the key of `guidedAnswers`. */
  id: string;
  /** The question as the director reads it. */
  label: string;
  /** The answer's field name on the casting sheet ("Age", "Light"). */
  short: string;
  /** A hint in plain words under the question. */
  hint: string;
  kind: "choice" | "text";
  /** `choice`: the offered answers (the user may still write their own). */
  options?: { value: string; label: string }[];
  /** The director may leave it empty. */
  optional?: boolean;
  /** Behind "Add more detail" after the main questions (the prop's Advanced block). */
  advanced?: boolean;
  /** The answer the script suggests, chosen in advance (still shown for confirmation). */
  prefill?: string;
};

/** What the skip logic reads: the asset as detected, and the project's style. */
export type QuestionContext = {
  asset: { name: string; description: string | null; details: AssetDetails | null };
  project: { eraSetting?: string; genre?: string; visualStyle?: string };
};

export function choice(
  id: string,
  short: string,
  label: string,
  hint: string,
  options: readonly (string | { value: string; label: string })[],
  extra: Partial<GuidedQuestion> = {},
): GuidedQuestion {
  return {
    id,
    label,
    short,
    hint,
    kind: "choice",
    options: options.map((o) => (typeof o === "string" ? { value: o, label: o } : o)),
    ...extra,
  };
}

export function text(
  id: string,
  short: string,
  label: string,
  hint: string,
  extra: Partial<GuidedQuestion> = {},
): GuidedQuestion {
  return { id, label, short, hint, kind: "text", ...extra };
}

/** Which designer draws an asset kind (legacy creature, costume and other rows included). */
export type DesignerKey = "character" | "location" | "prop";

export function designerFor(kind: AssetKind): DesignerKey | null {
  switch (kind) {
    case "character":
    case "creature":
      return "character";
    case "location":
      return "location";
    case "prop":
    case "costume":
    case "other":
      return "prop";
    case "voice":
      return null;
  }
}
