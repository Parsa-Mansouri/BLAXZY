import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { appliedFixProblems } from "../shared/designer";
import { buildPropGeneratorPrompt } from "./prompt";
import {
  propGeneratorInputSchema,
  propGeneratorOutputSchema,
  type PropGeneratorOutput,
  type PropGeneratorParsedInput,
} from "./schema";

const MAX_QUESTIONS = 3;
const MAX_HERO_REFERENCES = 4;

/** True when the run is a fix round (the owner's STEP 9). */
export function isPropFix(input: PropGeneratorParsedInput): boolean {
  return (
    input.previousOutput !== undefined &&
    (input.fixRequests.length > 0 || input.userNotes !== undefined)
  );
}

/** The prop is not a prop (a building, a room, a set): the owner's `NOT_A_PROP:` warning. */
export function notAProp(output: Pick<PropGeneratorOutput, "warnings">): boolean {
  return output.warnings.some((w) => w.startsWith("NOT_A_PROP:"));
}

/** The owner's validators (section 8) and the limits his schema states in words. */
export function checkPropSpec(
  output: PropGeneratorOutput,
  input: PropGeneratorParsedInput,
): string[] {
  const problems: string[] = [];
  if (output.classification.families.length === 0) {
    problems.push("classification.families needs at least one family");
  }
  const questions = output.clarifying_questions;
  if (questions.length > MAX_QUESTIONS) {
    problems.push(`ask at most ${MAX_QUESTIONS} clarifying questions`);
  }
  for (const q of questions) {
    if (q.options.length < 2 || q.options.length > 4) {
      problems.push(`question "${q.id}" needs 2 to 4 options`);
    }
    if (!q.options.includes(q.default)) {
      problems.push(`question "${q.id}": default must be one of its options`);
    }
    if (input.clarifyAnswers && q.id in input.clarifyAnswers) {
      problems.push(`question "${q.id}" was answered in clarify_answers: do not ask it again`);
    }
  }
  const blocking = questions.filter((q) => q.blocking).length;
  const maxBlocking = input.sector === "wizard" ? 1 : MAX_QUESTIONS;
  if (blocking > maxBlocking) {
    problems.push(`at most ${maxBlocking} blocking question(s) in the ${input.sector}`);
  }
  const hero = output.hero_view;
  if (hero === null) {
    if (blocking === 0 && !notAProp(output)) {
      problems.push(
        'hero_view is null only when a blocking clarifying question exists (or with a "NOT_A_PROP:" warning)',
      );
    }
  } else {
    if (blocking > 0) problems.push("hero_view must be null while a blocking question is open");
    if (!hero.image_prompt.trim()) problems.push("hero_view.image_prompt must not be empty");
    if (hero.reference_order.length > MAX_HERO_REFERENCES) {
      problems.push(`hero_view.reference_order takes at most ${MAX_HERO_REFERENCES} images`);
    }
    const userRefs = input.referenceImages.length;
    const heroes = input.linkedLocations.filter((l) => l.heroFileId);
    for (const r of hero.reference_order) {
      const user = /^user_reference:(\d+)$/.exec(r.source);
      const location = /^location_hero:(.+)$/.exec(r.source);
      if (user) {
        const n = Number(user[1]);
        if (n < 1 || n > userRefs) {
          problems.push(`reference_order source "${r.source}" is not an attached reference`);
        }
      } else if (location) {
        if (!heroes.some((l) => l.name === location[1])) {
          problems.push(`reference_order source "${r.source}" is not an attached location Hero`);
        }
      } else {
        problems.push(
          `reference_order source "${r.source}" must be user_reference:<n> or location_hero:<location_id>`,
        );
      }
    }
    if (hero.hero_source === "from_reference" && userRefs === 0) {
      problems.push('hero_source "from_reference" needs a reference image');
    }
    if (hero.hero_source === "from_location" && heroes.length === 0) {
      problems.push('hero_source "from_location" needs an attached location Hero');
    }
    if (!output.dna.states.some((s) => s.state_id === hero.state_id)) {
      problems.push(`hero_view.state_id "${hero.state_id}" is not one of dna.states`);
    }
  }
  if (!output.dna.states.some((s) => s.is_default)) {
    problems.push("dna.states needs at least one state with is_default true");
  }
  if (!isPropFix(input) && output.changes_identity) {
    problems.push("changes_identity is always false on a first generation");
  }
  if (input.styleOverride === undefined && output.style_source !== "project_style") {
    problems.push('style_source must be "project_style": no style_override was given');
  }
  if (!output.style_used.trim()) problems.push("style_used must name the effective style");
  problems.push(
    ...appliedFixProblems(
      output.applied_fixes.map((f) => f.code),
      isPropFix(input) ? input.fixRequests : [],
    ),
  );
  return problems;
}

/**
 * The backend's minimum rules (section 8), applied silently: a multi-state or hero prop is
 * always PRODUCTION, and at that level every non-default state gets a state view.
 */
export function enforceSheetPlan(output: PropGeneratorOutput): PropGeneratorOutput {
  const { classification, sheet_plan: plan } = output;
  const production =
    classification.interaction === "multi_state" || classification.importance === "hero";
  const level = production ? "production" : plan.level;
  const views = [...plan.views];
  if (level === "production") {
    for (const state of output.dna.states) {
      const viewId = `state_${state.state_id}`;
      if (!state.is_default && !views.some((v) => v.view_id === viewId)) {
        views.push({ view_id: viewId, purpose: `The object ${state.name.toLowerCase()}.` });
      }
    }
  }
  if (level === plan.level && views.length === plan.views.length) return output;
  return { ...output, sheet_plan: { ...plan, level, views } };
}

export const propGenerator = defineDami({
  key: "prop-generator",
  version: "1.0.0",
  description:
    "Designs one prop: script analysis, classification, a specification with confirmed, inferred and unknown fields, clarifying questions, DNA, project links, a sheet plan and the Hero Design prompt (hero_34 on the grey studio); fix mode applies the reviewer's fix requests to the previous answer.",
  input: propGeneratorInputSchema,
  output: propGeneratorOutputSchema,
  // The owner's recommended model (vision for references).
  model: CLAUDE_MODELS.sonnet,
  // The owner asks for temperature 0.5 on a first run and 0.3 in fix mode. The SDK has no
  // temperature (docs/damis/README.md): medium effort here, and the worker passes `low` for fix
  // rounds (`PROP_FIX_EFFORT`).
  effort: "medium",
  // The owner sizes max_tokens at 6000; doubled for headroom (thinking counts against it).
  maxOutputTokens: 12_000,
  build: buildPropGeneratorPrompt,
  check: checkPropSpec,
  finalize: enforceSheetPlan,
});

/** Effort for fix rounds (the owner's temperature 0.3). */
export const PROP_FIX_EFFORT = "low" as const;
