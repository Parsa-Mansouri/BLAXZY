/**
 * The Character Generator's request: the owner's whole file as the system prompt (verbatim, in
 * `prompt-text.ts`), and one user message with the reference images in index order followed by
 * the input JSON in the owner's field names.
 */
import type { DamiPrompt } from "../framework/define";
import { withCreativeDna } from "../shared/creative-dna-input";
import { designerMessage, ownerFixRequests } from "../shared/designer";
import { CHARACTER_GENERATOR_SYSTEM } from "./prompt-text";
import type { CharacterGeneratorParsedInput } from "./schema";

export { CHARACTER_GENERATOR_SYSTEM };

/** The input JSON as the owner's INPUT section names it. */
export function characterInputJson(input: CharacterGeneratorParsedInput): Record<string, unknown> {
  const { project, character } = input;
  return {
    project: {
      style: project.style,
      ...(project.styleDescriptor ? { style_descriptor: project.styleDescriptor } : {}),
      genre: project.genre,
      format: project.format,
      ...(project.eraSetting ? { era_setting: project.eraSetting } : {}),
      ...(project.lookLine ? { look_line: project.lookLine } : {}),
      ...(project.artDirectionNotes ? { art_direction_notes: project.artDirectionNotes } : {}),
    },
    ...(input.styleOverride ? { style_override: input.styleOverride } : {}),
    ...(input.environment ? { environment: input.environment } : {}),
    character: {
      name: character.name,
      ...(character.role ? { role: character.role } : {}),
      ...(character.kind && character.kind !== "human" ? { kind: character.kind } : {}),
      ...character.details,
      ...(character.isMinor ? { minor: true } : {}),
      ...(character.description ? { script_description: character.description } : {}),
      ...(character.facts.length > 0 ? { facts_from_script: character.facts } : {}),
    },
    ...(input.referenceImages.length > 0
      ? {
          reference_images: input.referenceImages.map((r, i) => ({
            index: i + 1,
            role: r.role,
            ...(r.note ? { note: r.note } : {}),
          })),
        }
      : {}),
    ...(input.userNotes ? { user_notes: input.userNotes } : {}),
    ...(input.previousPrompt ? { previous_prompt: input.previousPrompt } : {}),
    ...(input.fixRequests.length > 0 ? { fix_requests: ownerFixRequests(input.fixRequests) } : {}),
  };
}

export function buildCharacterGeneratorPrompt(input: CharacterGeneratorParsedInput): DamiPrompt {
  return {
    system: withCreativeDna([{ text: CHARACTER_GENERATOR_SYSTEM, cache: true }], input.creativeDna),
    messages: designerMessage(
      input.referenceImages.map((r) => r.fileId),
      JSON.stringify(characterInputJson(input), null, 2),
    ),
  };
}
