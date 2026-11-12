/**
 * The character's guided questions: the detail fields of Character Generator v5 (age, gender,
 * skin tone, face, hair, body, outfit, accessories, personality, marks). Answers go to the dami as
 * `character.<field>`; "I'm not sure" leaves the field to the dami (logged in its assumptions).
 * Facts the detector read from the script are offered as the answer in advance.
 */
import type { AssetFact } from "@/server/db/schema";
import {
  choice,
  text,
  type GuidedQuestion,
  type QuestionContext,
} from "../shared/guided-questions";
import type { CharacterDetailField } from "./schema";

const QUESTIONS: readonly (GuidedQuestion & { id: CharacterDetailField })[] = [
  {
    ...choice(
      "age",
      "Age",
      "How old do they look?",
      "Pick how they look on screen, not their birth year.",
      [
        "A child",
        "A teenager",
        "In their twenties",
        "In their thirties or forties",
        "In their fifties or sixties",
        "Seventy or older",
      ],
    ),
    id: "age",
  },
  {
    ...choice("gender", "Gender", "How do they present?", "As the audience reads them.", [
      "A woman",
      "A man",
      "Non-binary or hard to tell",
    ]),
    id: "gender",
  },
  {
    ...text(
      "skin_tone",
      "Skin",
      "What is their skin tone or heritage?",
      "For example: deep brown skin, Persian, pale and freckled.",
      { optional: true },
    ),
    id: "skin_tone",
  },
  {
    ...text(
      "face",
      "Face",
      "What stands out in their face?",
      "Eyes, nose, jaw, lines, a beard: whatever we should notice first.",
      { optional: true },
    ),
    id: "face",
  },
  {
    ...text(
      "hair",
      "Hair",
      "What is their hair like?",
      "Length, colour and how it is worn. A grey braid, a shaved head.",
    ),
    id: "hair",
  },
  {
    ...choice("body", "Build", "What is their build?", "Their height and frame.", [
      "Slight and small",
      "Average",
      "Athletic",
      "Heavy-set",
      "Tall and lean",
      "Short and stocky",
    ]),
    id: "body",
  },
  {
    ...text(
      "outfit",
      "Outfit",
      "What do they wear?",
      "Garments, fabrics and colours, head to toe. The outfit we first see them in.",
    ),
    id: "outfit",
  },
  {
    ...text(
      "accessories",
      "Carries",
      "Anything they always wear or carry?",
      "Glasses, a ring, a bag, a walking stick.",
      { optional: true },
    ),
    id: "accessories",
  },
  {
    ...choice(
      "personality",
      "Manner",
      "What should their look say about them?",
      "The first impression their face and posture give.",
      [
        "Warm and open",
        "Guarded and watchful",
        "Tired and worn down",
        "Determined",
        "Playful",
        "Severe",
      ],
    ),
    id: "personality",
  },
  {
    ...text(
      "marks",
      "Marks",
      "Any scars, tattoos or other marks?",
      "Where they are and what they look like.",
      { optional: true },
    ),
    id: "marks",
  },
];

const FACT_FIELDS: Record<CharacterDetailField, RegExp> = {
  age: /\bage\b/i,
  gender: /\b(gender|sex)\b/i,
  skin_tone: /\b(skin|ethnic|heritage)/i,
  face: /\bface\b/i,
  hair: /\bhair\b/i,
  body: /\b(build|body|height)\b/i,
  outfit: /\b(outfit|cloth|wardrobe|costume)/i,
  accessories: /\baccessor/i,
  personality: /\b(personality|manner|mood)\b/i,
  marks: /\b(mark|scar|tattoo)/i,
};

function factFor(facts: readonly AssetFact[], field: CharacterDetailField): string | undefined {
  return facts.find((f) => FACT_FIELDS[field].test(f.field) && f.value.trim())?.value.trim();
}

export function characterQuestions(context: QuestionContext): GuidedQuestion[] {
  const facts = context.asset.details?.facts ?? [];
  return QUESTIONS.map((q) => {
    const fact = factFor(facts, q.id);
    return fact ? { ...q, prefill: fact.slice(0, 1000) } : { ...q };
  });
}

export const CHARACTER_QUESTION_IDS: readonly CharacterDetailField[] = QUESTIONS.map((q) => q.id);
