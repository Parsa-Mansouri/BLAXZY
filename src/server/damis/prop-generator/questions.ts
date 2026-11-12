/**
 * The prop's guided questions: the owner's five (what it is, importance, usage, scale, what must
 * stay) plus the Advanced block behind "Add more detail". Skip logic is deterministic: "what is
 * it" is skipped when the script names and describes the prop; importance, usage and scale are
 * always shown, with the script's suggestion chosen in advance. Answers go to the Prop Generator
 * as `guided_answers` (Advanced ones as `guided_answers.advanced`); "I'm not sure" is sent as
 * `ai_decides`.
 */
import type { AssetDetails } from "@/server/db/schema";
import {
  choice,
  text,
  type GuidedQuestion,
  type QuestionContext,
} from "../shared/guided-questions";
import type { PropAdvancedField } from "./schema";

/** Guided answer keys of the Advanced block: `advanced.<field>`. */
export const ADVANCED_PREFIX = "advanced.";

const ADVANCED: readonly {
  field: PropAdvancedField;
  short: string;
  label: string;
  hint: string;
}[] = [
  {
    field: "materials",
    short: "Materials",
    label: "What is it made of, and how is it finished?",
    hint: "Brushed brass and walnut; matte black plastic.",
  },
  {
    field: "colors",
    short: "Colours",
    label: "Which colours?",
    hint: "Name them: oxblood red, faded teal.",
  },
  {
    field: "period_style",
    short: "Period",
    label: "Which period or style?",
    hint: "Victorian, 1970s Soviet, far future.",
  },
  {
    field: "wear",
    short: "Wear",
    label: "How worn is it?",
    hint: "Brand new, scuffed edges, rusted through.",
  },
  {
    field: "asymmetric_details",
    short: "One side",
    label: "Any details on one side only?",
    hint: "A dent on the left, a keyhole off-centre.",
  },
  {
    field: "detachable_parts",
    short: "Parts",
    label: "Any parts that come off?",
    hint: "A lid, a strap, a cap.",
  },
  {
    field: "mechanics",
    short: "Moves",
    label: "Does anything move or open?",
    hint: "Hinged on the right, slides out, folds in half.",
  },
  {
    field: "hand_interaction",
    short: "Hands",
    label: "How do hands hold or use it?",
    hint: "Gripped by the handle, cradled in both palms.",
  },
  {
    field: "production_limits",
    short: "Limits",
    label: "Any production limits?",
    hint: "Must fit in a coat pocket; must look cheap to make.",
  },
  {
    field: "forbidden",
    short: "Never",
    label: "Anything it must never have?",
    hint: "No logos, no visible screws.",
  },
];

/** The importance the script suggests: a hero prop is seen often and close. */
function suggestedImportance(details: AssetDetails): string {
  if (details.categoryHint === "hero_prop") return "hero";
  if (details.categoryHint === "set_dressing" || details.categoryHint === "prop_group") {
    return "background";
  }
  return (details.sceneRefs ?? []).length >= 3 ? "hero" : "standard";
}

/** How the script uses it: states make it multi-state, hand props are carried. */
function suggestedUsage(details: AssetDetails): string {
  if ((details.states ?? []).length > 0 || details.categoryHint === "functional_prop") {
    return "multi_state";
  }
  if (details.categoryHint === "hand_prop" || (details.users ?? []).length > 0) return "carried";
  return "static";
}

export function propQuestions(context: QuestionContext): GuidedQuestion[] {
  const details = context.asset.details ?? {};
  const questions: GuidedQuestion[] = [];
  if (!context.asset.description?.trim()) {
    questions.push(
      text(
        "what_is_it",
        "Object",
        "What are we making?",
        "Name it and say what kind of thing it is: a brass pocket watch, a wooden crate.",
      ),
    );
  }
  questions.push(
    choice(
      "importance",
      "Importance",
      "How important is it?",
      "Hero props are seen up close and often; background ones fill a space.",
      [
        { value: "background", label: "Background" },
        { value: "standard", label: "Standard" },
        { value: "hero", label: "Hero" },
      ],
      { prefill: suggestedImportance(details) },
    ),
    choice(
      "usage",
      "Usage",
      "How is it used?",
      "Whether it stays put, is carried, or changes (opens, lights up, breaks).",
      [
        { value: "static", label: "It stays where it is" },
        { value: "carried", label: "Someone carries it" },
        { value: "multi_state", label: "It opens, changes or moves" },
      ],
      { prefill: suggestedUsage(details) },
    ),
    choice(
      "scale",
      "Size",
      "How big is it?",
      "Compared with people, not in centimetres.",
      [
        { value: "small: fits in one hand", label: "Fits in one hand" },
        { value: "medium: held with two hands", label: "Held with two hands" },
        { value: "large: about as tall as a table", label: "As tall as a table" },
        { value: "large: about as tall as a person", label: "As tall as a person" },
      ],
      details.categoryHint === "hand_prop" ? { prefill: "small: fits in one hand" } : {},
    ),
    text(
      "must_keep",
      "Must stay",
      "What must stay exactly as it is?",
      "The engraving on the lid, the cracked glass. Also anything it must not have.",
      { optional: true },
    ),
    ...ADVANCED.map((a) =>
      text(`${ADVANCED_PREFIX}${a.field}`, a.short, a.label, a.hint, {
        optional: true,
        advanced: true,
      }),
    ),
  );
  return questions;
}
