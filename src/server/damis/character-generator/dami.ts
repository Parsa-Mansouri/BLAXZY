import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { appliedFixProblems } from "../shared/designer";
import { buildCharacterGeneratorPrompt } from "./prompt";
import {
  characterGeneratorInputSchema,
  characterGeneratorOutputSchema,
  type CharacterGeneratorOutput,
  type CharacterGeneratorParsedInput,
} from "./schema";

/** The owner's checks the JSON schema cannot express (OUTPUT FORMAT and REFERENCE rules). */
export function checkCharacterBoard(
  output: CharacterGeneratorOutput,
  input: CharacterGeneratorParsedInput,
): string[] {
  const problems: string[] = [];
  const refs = input.referenceImages;
  if (!output.image_prompt.trim() && output.warnings.length === 0) {
    problems.push("image_prompt is empty: write the prompt, or explain in warnings why you cannot");
  }
  if (refs.length === 0) {
    if (output.mode !== "text_only") problems.push('mode must be "text_only": no reference images');
    if (output.reference_order.length > 0) {
      problems.push("reference_order must be empty in text_only mode");
    }
  } else {
    if (output.mode !== "reference") problems.push('mode must be "reference": images are attached');
    const expected = refs.map((r, i) => `${i + 1}:${r.role}`).join(",");
    const got = output.reference_order.map((r) => `${r.index}:${r.role}`).join(",");
    if (expected !== got) {
      problems.push(
        `reference_order must list the attached images in order with their roles: ${expected}`,
      );
    }
  }
  const override = input.styleOverride !== undefined;
  const styleChange = input.fixRequests.some((r) => r.code === "P12");
  if (output.style_source === "override" && !override && !styleChange) {
    problems.push('style_source must be "project": no style_override was given');
  }
  if (override && output.style_source !== "override") {
    problems.push('style_source must be "override": style_override was applied');
  }
  if (!output.style_used.trim()) problems.push("style_used is always filled");
  problems.push(
    ...appliedFixProblems(
      output.applied_fixes.map((f) => f.code),
      input.previousPrompt ? input.fixRequests : [],
    ),
  );
  return problems;
}

export const characterGenerator = defineDami({
  key: "character-generator",
  version: "5.0.0",
  description:
    "Writes the image prompt for a character's 16:9 reference board (close-up, front and back views in the project's world), from the character's details and optional reference photos; fix mode applies the reviewer's fix requests to the previous prompt.",
  input: characterGeneratorInputSchema,
  output: characterGeneratorOutputSchema,
  // The owner's recommended model.
  model: CLAUDE_MODELS.sonnet,
  // The file names no temperature; per docs/damis/README.md ("Settings that differ from the
  // files") a dami without a low temperature runs at medium effort.
  effort: "medium",
  maxOutputTokens: 8000,
  // The owner asks for "only valid JSON"; structured JSON output (the schema above) guarantees it.
  build: buildCharacterGeneratorPrompt,
  check: checkCharacterBoard,
});
