import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { sheetFixProblems } from "../shared/designer";
import { buildPropSheetPrompt } from "./prompt";
import {
  propSheetInputSchema,
  propSheetOutputSchema,
  type PropSheetOutput,
  type PropSheetParsedInput,
} from "./schema";

/** A view uses at most this many reference images (the owner's tool schema). */
export const MAX_PROP_VIEW_REFERENCES = 4;

/** Images per level, the approved Hero included (the VIEW LIBRARY's maximums). */
export const PROP_LEVEL_MAX_IMAGES = { simple: 2, standard: 7, production: 14 } as const;

type Level = keyof typeof PROP_LEVEL_MAX_IMAGES;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The non-default states of the locked spec (`dna.states`), by state id. */
export function nonDefaultStates(spec: Record<string, unknown>): string[] {
  const states = record(spec.dna)?.states;
  if (!Array.isArray(states)) return [];
  return states.flatMap((s: unknown) => {
    const state = record(s);
    return state && typeof state.state_id === "string" && state.is_default === false
      ? [state.state_id]
      : [];
  });
}

/** The backend's minimum level (the VIEW LIBRARY's minimum rules). */
export function minimumPropLevel(spec: Record<string, unknown>): Level | null {
  const c = record(spec.classification);
  if (!c) return null;
  if (c.interaction === "multi_state" || c.importance === "hero") return "production";
  return null;
}

const RANK: Record<Level, number> = { simple: 0, standard: 1, production: 2 };

/** True when the run is a fix round (the owner's FIX MODE). */
export function isPropSheetFix(input: PropSheetParsedInput): boolean {
  return (
    input.previousOutput !== undefined &&
    (input.fixRequests.length > 0 || input.userNotes !== undefined)
  );
}

/**
 * The owner's validators (section 4): `generation_order` has every view once and after its
 * dependencies, `reference_order[0]` is `approved_hero` (or the previous image in edit mode), at
 * most four references, the level's maximum image count, a state view for every non-default
 * state at production level, the minimum level, and every fix applied or explained.
 */
export function checkPropSheet(output: PropSheetOutput, input: PropSheetParsedInput): string[] {
  const problems: string[] = [];
  const ids = output.views.map((v) => v.view_id);
  if (new Set(ids).size !== ids.length) problems.push("every view_id must appear once in views");
  if (ids.includes("hero_34")) problems.push("views must not include hero_34: it is approved");
  const minimum = minimumPropLevel(input.lockedSpec);
  if (minimum && RANK[output.sheet_level] < RANK[minimum]) {
    problems.push(`sheet_level must be at least "${minimum}" for this asset`);
  }
  const max = PROP_LEVEL_MAX_IMAGES[output.sheet_level] - 1;
  if (output.views.length > max) {
    problems.push(`a ${output.sheet_level} sheet has at most ${max} views besides the Hero`);
  }
  if (output.sheet_level === "production") {
    for (const state of nonDefaultStates(input.lockedSpec)) {
      if (!ids.includes(`state_${state}`)) {
        problems.push(`a production sheet needs the view state_${state} (a non-default state)`);
      }
    }
  }
  const order = output.generation_order;
  const position = new Map(order.map((id, i) => [id, i]));
  if (order.length !== ids.length || ids.some((id) => !position.has(id))) {
    problems.push("generation_order must list every view_id of views exactly once");
  }
  const approved = new Set(input.approvedImages.map((a) => a.viewId));
  for (const view of output.views) {
    const at = position.get(view.view_id) ?? -1;
    for (const dep of view.depends_on) {
      const depAt = position.get(dep);
      if (depAt !== undefined && depAt >= at) {
        problems.push(
          `${view.view_id} depends on ${dep}, so it must come after it in generation_order`,
        );
      }
      if (depAt === undefined && !approved.has(dep)) {
        problems.push(`${view.view_id} depends on ${dep}, which is neither approved nor in views`);
      }
    }
    if (view.reference_order.length > MAX_PROP_VIEW_REFERENCES) {
      problems.push(`${view.view_id} uses more than ${MAX_PROP_VIEW_REFERENCES} reference images`);
    }
    if (!view.image_prompt.trim()) problems.push(`${view.view_id} has no image_prompt`);
    const previous = `previous:${view.view_id}`;
    if (view.edit_mode === "edit_previous_view") {
      const requests = input.fixRequests.filter((r) => r.viewId === view.view_id);
      if (requests.length === 0 || !requests.every((r) => r.editEligible)) {
        problems.push(
          `${view.view_id}: edit_previous_view only when every request for the view is edit_eligible`,
        );
      }
      if (!view.reference_order.some((r) => r.source === previous)) {
        problems.push(`${view.view_id}: edit_previous_view needs "${previous}" in reference_order`);
      }
    } else if (view.reference_order[0]?.source !== "approved_hero") {
      problems.push(`${view.view_id}: reference_order[0] must be approved_hero`);
    }
  }
  if (output.scale_card.dimensions_status !== "confirmed" && /\d/.test(output.scale_card.text)) {
    problems.push("scale_card.text has numbers, but the dimensions are not confirmed");
  }
  problems.push(
    ...sheetFixProblems(
      output.applied_fixes.map((f) => f.code),
      output.warnings,
      isPropSheetFix(input) ? input.fixRequests : [],
    ),
  );
  return problems;
}

export const sheetGeneratorProp = defineDami({
  key: "sheet-generator-prop",
  version: "1.0.0",
  description:
    "Writes the prompts for the remaining views of a prop's Adaptive Asset Sheet (orthographic, detail, state, interaction and scale views on the grey studio, in a dependency order) and the scale card's data, from the locked spec and the approved Hero; never redesigns.",
  input: propSheetInputSchema,
  output: propSheetOutputSchema,
  // The owner's recommended model.
  model: CLAUDE_MODELS.sonnet,
  // The owner asks for temperature 0.3; the SDK has no temperature (docs/damis/README.md): low.
  effort: "low",
  // The owner sizes max_tokens at 6000; doubled for headroom (thinking counts against it).
  maxOutputTokens: 12_000,
  build: buildPropSheetPrompt,
  check: checkPropSheet,
});
