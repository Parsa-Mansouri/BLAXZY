/**
 * The Prop Generator's request, assembled as the owner's file says:
 * `SYSTEM = CORE + OBJECT_ORIENTATION + VIEW_LIBRARY + STUDIO_STANDARD + OBJECT_TEXT_RULE` (all
 * stable, one cached block). The user message is the user's reference images in index order,
 * then the approved Heroes of linked locations, then the owner's JSON template filled in.
 */
import type { DamiPrompt } from "../framework/define";
import {
  PROP_OBJECT_ORIENTATION,
  PROP_OBJECT_TEXT_RULE,
  PROP_STUDIO_STANDARD,
  PROP_VIEW_LIBRARY,
} from "../prop-shared/modules";
import { withCreativeDna } from "../shared/creative-dna-input";
import { designerMessage, ownerFixRequests, type DesignerScript } from "../shared/designer";
import { PROP_GENERATOR_CORE } from "./prompt-text";
import type { PropGeneratorParsedInput } from "./schema";

export { PROP_GENERATOR_CORE };

export const PROP_GENERATOR_SYSTEM = [
  PROP_GENERATOR_CORE,
  PROP_OBJECT_ORIENTATION,
  PROP_VIEW_LIBRARY,
  PROP_STUDIO_STANDARD,
  PROP_OBJECT_TEXT_RULE,
].join("\n\n");

/** Files attached to the request, in order: the user's references, then location Heroes. */
export function propImageFileIds(input: PropGeneratorParsedInput): string[] {
  return [
    ...input.referenceImages.map((r) => r.fileId),
    ...input.linkedLocations.flatMap((l) => (l.heroFileId ? [l.heroFileId] : [])),
  ];
}

/** The owner's `script_context` (a string): the logline and the scenes where the prop appears. */
export function propScriptContext(script: DesignerScript | undefined): string | null {
  if (!script || (script.scenes.length === 0 && !script.logline)) return null;
  const parts = script.logline ? [`Logline: ${script.logline}`] : [];
  for (const s of script.scenes) {
    parts.push(
      [
        `Scene ${s.sceneNumber}: ${s.heading}`,
        s.action,
        s.dialogueExcerpt ? `Dialogue: ${s.dialogueExcerpt}` : "",
        s.charactersPresent.length > 0 ? `Present: ${s.charactersPresent.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return parts.join("\n\n");
}

/** `source_mode` as the owner's STEP list defines it, from what the user gave. */
export function propSourceMode(
  input: PropGeneratorParsedInput,
): "prompt_only" | "reference_only" | "prompt_reference" | "auto" {
  const answers = input.guidedAnswers;
  const answered =
    answers !== undefined &&
    Object.entries(answers).some(([key, value]) =>
      key === "advanced"
        ? Object.values(value ?? {}).some((v) => v !== "ai_decides")
        : typeof value === "string" && value !== "ai_decides",
    );
  const text = input.userPrompt !== undefined || answered;
  const refs = input.referenceImages.length > 0;
  if (text && refs) return "prompt_reference";
  if (refs) return "reference_only";
  if (text) return "prompt_only";
  return "auto";
}

export function propInputJson(input: PropGeneratorParsedInput): Record<string, unknown> {
  const { asset, project } = input;
  let heroIndex = input.referenceImages.length;
  return {
    asset: {
      asset_id: asset.name,
      name: asset.name,
      category_hint: asset.categoryHint ?? "",
      script_description: asset.scriptDescription,
      scene_refs: asset.sceneRefs,
    },
    project: {
      style: project.style,
      style_descriptor: project.styleDescriptor ?? null,
      genre: project.genre,
      format: project.format,
      era_setting: project.eraSetting ?? "",
      orientation: project.orientation,
      ui_language: project.uiLanguage,
    },
    style_override: input.styleOverride ?? null,
    source_mode: propSourceMode(input),
    user_prompt: input.userPrompt ?? null,
    guided_answers: input.guidedAnswers ?? null,
    reference_images: input.referenceImages.map((r, i) => ({
      index: i + 1,
      role: r.role,
      preserve: r.note ?? "",
      change: "",
    })),
    script_context: propScriptContext(input.scriptContext),
    linked_characters: input.linkedCharacters.map((c) => ({
      character_id: c.name,
      name: c.name,
      age_group: c.ageGroup,
      build: c.build,
      handedness: c.handedness,
      usage_note: c.usageNote,
    })),
    linked_locations: input.linkedLocations.map((l) => ({
      location_id: l.name,
      name: l.name,
      location_summary: l.summary,
      anchor: l.anchor,
      hero_image_index: l.heroFileId ? ++heroIndex : null,
    })),
    clarify_answers: input.clarifyAnswers ?? null,
    previous_output: input.previousOutput ?? null,
    fix_requests: ownerFixRequests(input.fixRequests).map((r) => ({
      code: r.code,
      instruction: r.instruction,
      ...(r.custom_text ? { note: r.custom_text } : {}),
    })),
    user_notes: input.userNotes ?? null,
  };
}

export function buildPropGeneratorPrompt(input: PropGeneratorParsedInput): DamiPrompt {
  return {
    system: withCreativeDna([{ text: PROP_GENERATOR_SYSTEM, cache: true }], input.creativeDna),
    messages: designerMessage(
      propImageFileIds(input),
      JSON.stringify(propInputJson(input), null, 2),
    ),
  };
}
