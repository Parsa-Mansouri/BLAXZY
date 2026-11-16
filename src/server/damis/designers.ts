/**
 * The three designers by asset kind: which generator draws a kind, its guided questions (with
 * their skip logic), its review catalog and the roles a reference photo can take. Pure data.
 */
import type { AssetKind } from "@/server/db/schema";
import { characterQuestions } from "./character-generator/questions";
import { CHARACTER_REFERENCE_ROLES } from "./character-generator/schema";
import { locationQuestions } from "./location-generator/questions";
import { LOCATION_REFERENCE_ROLES } from "./location-generator/schema";
import { propQuestions } from "./prop-generator/questions";
import { PROP_REFERENCE_ROLES } from "./prop-generator/schema";
import {
  designerFor,
  type DesignerKey,
  type GuidedQuestion,
  type QuestionContext,
} from "./shared/guided-questions";
import type { ReviewCatalogKey } from "./shared/review-catalog-types";

export { designerFor, type DesignerKey, type GuidedQuestion, type QuestionContext };

/** The guided questions still to ask for an asset (none for voices). */
export function designerQuestions(kind: AssetKind, context: QuestionContext): GuidedQuestion[] {
  switch (designerFor(kind)) {
    case "character":
      return characterQuestions(context);
    case "location":
      return locationQuestions(context);
    case "prop":
      return propQuestions(context);
    case null:
      return [];
  }
}

export const DESIGNER_CATALOGS: Readonly<Record<DesignerKey, ReviewCatalogKey>> = {
  character: "character-generator",
  location: "location-generator",
  prop: "prop-generator",
};

export const DESIGNER_DAMI_KEYS: Readonly<Record<DesignerKey, string>> = {
  character: "character-generator",
  location: "location-generator",
  prop: "prop-generator",
};

/** A reference photo's role: what the designer takes from it. */
export type ReferenceRoleChoice = { value: string; label: string; hint: string };

export const REFERENCE_ROLES = {
  character: [
    { value: "face", label: "Face", hint: "Their face and hair come from this photo." },
    { value: "outfit", label: "Outfit", hint: "Their clothes, shoes and accessories." },
    { value: "full_body", label: "Whole figure", hint: "Their build, proportions and look." },
    { value: "other", label: "Something else", hint: "Say what to take from it." },
  ],
  location: [
    { value: "hero", label: "This is the place", hint: "The photo becomes the main view." },
    { value: "layout", label: "Layout", hint: "How the space is arranged and built." },
    { value: "mood", label: "Mood", hint: "Only its light, colours and atmosphere." },
    { value: "detail", label: "A detail", hint: "One element, reproduced exactly." },
    { value: "other", label: "Something else", hint: "Say what to take from it." },
  ],
  prop: [
    { value: "identity", label: "This is the object", hint: "Its shape and details, exactly." },
    { value: "material", label: "Material", hint: "Its surface, finish and colour." },
    { value: "detail", label: "A detail", hint: "One part or marking, exactly." },
    { value: "mood", label: "Mood", hint: "Only the feel it gives." },
    { value: "other", label: "Something else", hint: "Say what to take from it." },
  ],
} as const satisfies Readonly<Record<DesignerKey, readonly ReferenceRoleChoice[]>>;

// Compile-time guarantee that the roles above are the ones each dami accepts.
type Values<T extends readonly { value: string }[]> = T[number]["value"];
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const rolesMatch: [
  Same<Values<(typeof REFERENCE_ROLES)["character"]>, (typeof CHARACTER_REFERENCE_ROLES)[number]>,
  Same<Values<(typeof REFERENCE_ROLES)["location"]>, (typeof LOCATION_REFERENCE_ROLES)[number]>,
  Same<Values<(typeof REFERENCE_ROLES)["prop"]>, (typeof PROP_REFERENCE_ROLES)[number]>,
] = [true, true, true];
void rolesMatch;

/** Where on a look a change applies (the character board's three views). */
export const LOOK_FRAMES: Readonly<Record<DesignerKey, readonly { id: string; label: string }[]>> =
  {
    character: [
      { id: "closeup", label: "The close-up" },
      { id: "front", label: "The front view" },
      { id: "back", label: "The back view" },
    ],
    location: [],
    prop: [],
  };
