/**
 * Sample-mode Character Generator: a deterministic board prompt built from the input alone, in
 * the owner's layout (close-up on the left third, front and back full figures on the right), with
 * the reference images named by their order, fixes applied on top of the previous prompt, and
 * every detail it chose itself listed in `assumptions`.
 */
import {
  characterGeneratorInputSchema,
  type CharacterGeneratorOutput,
  type CharacterGeneratorParsedInput,
  type CharacterDetailField,
} from "../character-generator/schema";
import { collapseWhitespace, truncate } from "./util";

/** Concrete descriptors per owner style (STYLE LOCK, rule 4). */
const STYLE_FAMILIES: Record<string, string> = {
  Realistic:
    "realistic live-action look with natural proportions, real skin texture and photographic depth",
  Noir: "realistic noir look with hard-edged shadow shapes, high contrast and a restrained palette",
  Futuristic:
    "clean futuristic live-action look with sleek surfaces and integrated light, natural proportions",
  "Horror Visual Style":
    "realistic horror look with uneasy, uneven light and muted colour, faces still clearly readable",
  "3D Animation":
    "stylized 3D animation with consistent proportions, smooth rendered skin and clean soft shading",
  Anime: "anime style with clean line art, cel-shaded colour and graphic hair clumps",
  Claymation:
    "claymation look with handmade clay surfaces, visible fingerprints and soft studio-like light",
};

const ORDINALS = ["first", "second", "third", "fourth"];

const DEFAULTS: Partial<Record<CharacterDetailField, string>> = {
  age: "in their thirties",
  gender: "presenting as the script implies",
  hair: "practical, neatly kept hair",
  body: "an average build",
  outfit: "everyday clothes that fit the story's era and setting",
  personality: "a calm, attentive manner",
};

function styleUsed(input: CharacterGeneratorParsedInput): {
  style: string;
  source: "project" | "override";
} {
  const restyle = input.previousPrompt
    ? input.fixRequests.find((r) => r.code === "P12")
    : undefined;
  if (restyle) return { style: restyle.customText ?? restyle.instruction, source: "override" };
  if (input.styleOverride) return { style: input.styleOverride, source: "override" };
  if (input.project.styleDescriptor) {
    return { style: input.project.styleDescriptor, source: "project" };
  }
  const family = STYLE_FAMILIES[input.project.style];
  return { style: family ?? `${input.project.style} style`, source: "project" };
}

function environmentOf(input: CharacterGeneratorParsedInput): string {
  if (input.environment) return input.environment;
  const era = input.project.eraSetting ? ` (${input.project.eraSetting})` : "";
  return `a quiet, characteristic corner of the story's world${era}, in soft daylight`;
}

function referenceSentences(input: CharacterGeneratorParsedInput): string[] {
  return input.referenceImages.map((r, i) => {
    const which = `the ${ORDINALS[i] ?? `${i + 1}th`} reference image`;
    switch (r.role) {
      case "face":
        return `Use ${which} as the exact facial identity of the character, keeping its face shape, skin tone and hairstyle in all three views.`;
      case "outfit":
        return `Dress the character in the outfit shown in ${which}, reproducing its cut, colours, materials and footwear.`;
      case "full_body":
        return `Take the body type and proportions from ${which}.`;
      case "other":
        return `Use ${which} as a visual cue${r.note ? `: ${truncate(r.note, 200)}` : ""}.`;
    }
  });
}

export function sampleCharacterGenerator(raw: unknown): CharacterGeneratorOutput {
  const input = characterGeneratorInputSchema.parse(raw);
  const { character } = input;
  const { style, source } = styleUsed(input);
  const environment = environmentOf(input);
  const assumptions: string[] = [];
  const warnings: string[] = [];
  const hasFace = input.referenceImages.some((r) => r.role === "face");
  const hasOutfit = input.referenceImages.some((r) => r.role === "outfit");

  const detail = (field: CharacterDetailField): string | undefined => {
    const given = character.details[field];
    if (given) return given;
    if ((field === "hair" || field === "skin_tone") && hasFace) return undefined;
    if (field === "outfit" && hasOutfit) return undefined;
    const fallback = DEFAULTS[field];
    if (fallback) assumptions.push(`Chose ${fallback} for the ${field.replace("_", " ")}.`);
    return fallback;
  };

  const hair = detail("hair");
  const outfit = detail("outfit");
  const traits = [
    detail("age"),
    detail("gender"),
    character.details.skin_tone,
    character.details.face ? `face: ${character.details.face}` : undefined,
    hair ? `hair: ${hair}` : undefined,
    detail("body"),
    outfit ? `wearing ${outfit}` : undefined,
    character.details.accessories ? `with ${character.details.accessories}` : undefined,
    character.details.marks ? `marks: ${character.details.marks}` : undefined,
    detail("personality"),
  ].filter((t): t is string => Boolean(t));
  const description = character.description
    ? ` From the script: ${truncate(character.description, 400)}.`
    : "";
  if (!input.environment) assumptions.push(`Placed the character in ${environment}.`);

  const fresh = [
    `A ${style} character reference board of ${character.name} on one 16:9 landscape canvas, set in ${environment}.`,
    "The left third holds a close-up portrait of the face and upper shoulders, facing the camera, the entire face fully visible and sharp.",
    "The right two thirds hold two full-body views of the same character side by side, head to toe with both feet in frame: a front view at a slight three-quarter angle and a back view at a slight three-quarter angle, in a neutral standing pose with relaxed arms.",
    `The character: ${traits.join(", ")}.${description}`,
    ...referenceSentences(input),
    ...(input.userNotes ? [`Director's note: ${truncate(input.userNotes, 600)}.`] : []),
    `One continuous backdrop of ${environment} behind all three views, lit softly so the face, outfit and colours stay readable, uncluttered where the character stands.`,
    `Rendered entirely as ${style}. No text, labels, borders, grid lines, watermarks or extra people.`,
  ].join(" ");

  const fixing = input.previousPrompt !== undefined;
  const fixes = fixing ? input.fixRequests : [];
  const prompt = fixing
    ? `${collapseWhitespace(input.previousPrompt ?? "").replace(/[.\s]+$/, "")}. ${fixes
        .map((f) => (f.customText ? `${f.instruction} (${f.customText})` : f.instruction))
        .join(" ")}${input.userNotes ? ` Director's note: ${input.userNotes}` : ""}`
    : fresh;

  if (hasFace && character.details.hair) {
    warnings.push("The face photo shows the hair; it wins over the written hair description.");
  }

  return {
    character_name: character.name,
    mode: input.referenceImages.length > 0 ? "reference" : "text_only",
    image_prompt: truncate(prompt, 6000),
    aspect_ratio: "16:9",
    environment_used: truncate(environment, 200),
    style_used: truncate(style, 400),
    style_source: source,
    reference_order: input.referenceImages.map((r, i) => ({ index: i + 1, role: r.role })),
    applied_fixes: fixes.map((f) => ({
      code: f.code,
      change: truncate(`Added to the prompt: ${f.instruction}`, 300),
    })),
    assumptions: fixing ? [] : assumptions,
    warnings,
  };
}
