/**
 * The Character Sheet Generator's request: the owner's whole file as the system prompt (verbatim,
 * in `prompt-text.ts`), and one user message with the reference images in index order (the
 * approved board first) followed by the input JSON in the owner's field names.
 */
import type { DamiPrompt } from "../framework/define";
import { designerMessage, ownerFixRequests } from "../shared/designer";
import { CHARACTER_SHEET_SYSTEM } from "./prompt-text";
import type { CharacterSheetParsedInput } from "./schema";

export { CHARACTER_SHEET_SYSTEM };

/** The input JSON as the owner's INPUT section names it. */
export function characterSheetInputJson(input: CharacterSheetParsedInput): Record<string, unknown> {
  const { project, character } = input;
  return {
    project: {
      style: project.style,
      ...(project.styleDescriptor ? { style_descriptor: project.styleDescriptor } : {}),
      genre: project.genre,
      format: project.format,
      ...(project.eraSetting ? { era_setting: project.eraSetting } : {}),
      ...(project.artDirectionNotes ? { art_direction_notes: project.artDirectionNotes } : {}),
    },
    character: {
      name: character.name,
      ...(character.role ? { role: character.role } : {}),
      ...character.details,
      ...(character.isMinor ? { minor: true } : {}),
    },
    reference_images: input.referenceImages.map((r, i) => ({
      index: i + 1,
      role: r.role,
      ...(r.note ? { note: r.note } : {}),
    })),
    ...(input.boardPrompt ? { board_prompt: input.boardPrompt } : {}),
    ...(input.boardAssumptions.length > 0 ? { board_assumptions: input.boardAssumptions } : {}),
    render_cell_numbers: input.renderCellNumbers,
    ...(input.userNotes ? { user_notes: input.userNotes } : {}),
    ...(input.previousPrompt ? { previous_prompt: input.previousPrompt } : {}),
    ...(input.previousDetailCells ? { previous_detail_cells: input.previousDetailCells } : {}),
    ...(input.fixRequests.length > 0 ? { fix_requests: ownerFixRequests(input.fixRequests) } : {}),
  };
}

export function buildCharacterSheetPrompt(input: CharacterSheetParsedInput): DamiPrompt {
  return {
    system: [{ text: CHARACTER_SHEET_SYSTEM, cache: true }],
    messages: designerMessage(
      input.referenceImages.map((r) => r.fileId),
      JSON.stringify(characterSheetInputJson(input), null, 2),
    ),
  };
}
