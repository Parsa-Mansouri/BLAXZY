import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { sheetFixProblems } from "../shared/designer";
import { buildCharacterSheetPrompt } from "./prompt";
import {
  characterSheetInputSchema,
  characterSheetOutputSchema,
  type CharacterSheetOutput,
  type CharacterSheetParsedInput,
} from "./schema";

/** True when the run is a correction round (the owner's FIX REQUESTS section). */
export function isCharacterSheetFix(input: CharacterSheetParsedInput): boolean {
  return (
    input.previousPrompt !== undefined &&
    (input.fixRequests.length > 0 || input.userNotes !== undefined)
  );
}

/** The owner's checks the JSON schema cannot express (OUTPUT FORMAT and REFERENCE rules). */
export function checkCharacterSheet(
  output: CharacterSheetOutput,
  input: CharacterSheetParsedInput,
): string[] {
  const problems: string[] = [];
  const refs = input.referenceImages;
  if (refs[0]?.role !== "approved") {
    problems.push("the approved image must be reference image 1");
  }
  if (!output.image_prompt.trim()) {
    if (output.warnings.length === 0) {
      problems.push("image_prompt is empty: write the prompt, or explain in warnings why not");
    }
    return problems;
  }
  const slots = output.detail_cells.map((c) => c.slot).join(",");
  if (slots !== "1,2,3,4,5,6") {
    problems.push("detail_cells must have exactly six entries, slots 1 to 6, in order");
  }
  if (!output.style_used.trim()) problems.push("style_used is always filled");
  const expected = refs.map((r, i) => `${i + 1}:${r.role}`);
  for (const r of output.reference_order) {
    if (!expected.includes(`${r.index}:${r.role}`)) {
      problems.push(
        `reference_order entry ${r.index}:${r.role} does not match the attached images (${expected.join(", ")})`,
      );
    }
  }
  if (!output.reference_order.some((r) => r.index === 1 && r.role === "approved")) {
    problems.push("reference_order must start with the approved image (index 1)");
  }
  const previousSheet = refs.some((r) => r.role === "previous_sheet");
  if (output.edit_mode === "edit_previous_sheet" && !previousSheet) {
    problems.push('edit_mode "edit_previous_sheet" needs the previous sheet attached: use "full"');
  }
  problems.push(
    ...sheetFixProblems(
      output.applied_fixes.map((f) => f.code),
      output.warnings,
      isCharacterSheetFix(input) ? input.fixRequests : [],
    ),
  );
  return problems;
}

export const sheetGeneratorCharacter = defineDami({
  key: "sheet-generator-character",
  version: "4.1.0",
  description:
    "Writes the image prompt for a character's 16:9 sheet on a neutral grey studio (face, headless front and back full-body figures, six numbered detail frames) from the approved board; fix mode applies the reviewer's fix requests to the previous prompt and may edit the previous sheet.",
  input: characterSheetInputSchema,
  output: characterSheetOutputSchema,
  // The owner's recommended model.
  model: CLAUDE_MODELS.sonnet,
  // The file names no temperature; per docs/damis/README.md a translation job that must not
  // redesign runs at low effort.
  effort: "low",
  maxOutputTokens: 8000,
  // The owner asks for "only valid JSON"; structured JSON output (the schema above) guarantees it.
  build: buildCharacterSheetPrompt,
  check: checkCharacterSheet,
});
