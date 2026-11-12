/**
 * The location's guided questions: the owner's ten, with his skip logic (deterministic backend
 * code, no dami call). Answers go to the Location Generator as `guided_answers` keyed by id;
 * "I'm not sure" is sent as `ai_decides`. Question 10 (quick concept or full pack) is never
 * asked in the Wizard, which always sends `lock`.
 */
import {
  choice,
  text,
  type GuidedQuestion,
  type QuestionContext,
} from "../shared/guided-questions";

export const LOCATION_QUESTION_IDS = [
  "what_is_it",
  "interior_exterior",
  "narrative_function",
  "era_world",
  "design_language",
  "shape_size",
  "fixed_elements",
  "materials_colors",
  "light_atmosphere",
] as const;

const TIME_WORDS: Record<string, string> = {
  dawn: "Dawn light",
  morning: "Bright daylight",
  day: "Bright daylight",
  afternoon: "Bright daylight",
  dusk: "Golden hour",
  evening: "Dim and moody",
  night: "Night, lamps and street light",
};

/**
 * The questions still to ask for one location. Skipped: what it is (the script names and
 * describes it), inside or outside (the heading says so), its role in the story (a script slice
 * exists), era (the project sets it) and design language (the project's genre and style).
 * Asked: shape and size, fixed elements (optional), materials and colours, light (the script's
 * time of day chosen in advance).
 */
export function locationQuestions(context: QuestionContext): GuidedQuestion[] {
  const { asset, project } = context;
  const details = asset.details ?? {};
  const questions: GuidedQuestion[] = [];
  if (!asset.description?.trim()) {
    questions.push(
      text(
        "what_is_it",
        "Place",
        "What is this place?",
        "A lighthouse lamp room, a crowded night market, a farmhouse kitchen.",
      ),
    );
  }
  if (!details.interiorExterior) {
    questions.push(
      choice("interior_exterior", "Inside", "Inside or outside?", "Where the camera stands.", [
        { value: "interior", label: "Inside" },
        { value: "exterior", label: "Outside" },
        { value: "int_ext", label: "Both, in and out" },
      ]),
    );
  }
  if ((details.sceneRefs ?? []).length === 0) {
    questions.push(
      choice(
        "narrative_function",
        "Role",
        "What does it do in the story?",
        "What the space does to the people in it.",
        [
          "Traps them",
          "Hides something",
          "Exposes them",
          "Comforts them",
          "Isolates them",
          "Stages a chase",
          "Forces them close",
        ],
      ),
    );
  }
  if (!project.eraSetting?.trim()) {
    questions.push(
      choice("era_world", "Era", "What era or world is it in?", "When and where it was built.", [
        "Ancient or classical",
        "Medieval",
        "19th century",
        "Early 20th century",
        "Mid 20th century",
        "Today",
        "Near future",
        "Far future or another world",
      ]),
    );
  }
  if (!project.genre?.trim() || !project.visualStyle?.trim()) {
    questions.push(
      text(
        "design_language",
        "Design",
        "What is its overall design language?",
        "Brutalist concrete, ornate Persian tilework, cosy and cluttered.",
      ),
    );
  }
  questions.push(
    choice(
      "shape_size",
      "Shape",
      "What shape and rough size is it?",
      "The footprint and how much room there is to move.",
      [
        "Small and cramped",
        "About one room",
        "Long and narrow",
        "A large hall",
        "Open and wide",
        "Several levels",
      ],
    ),
    text(
      "fixed_elements",
      "Fixed",
      "Which doors, windows or features must stay put? Anything that must not be there?",
      "A door on the left wall, a big window facing the sea; no stairs.",
      { optional: true },
    ),
    text(
      "materials_colors",
      "Materials",
      "What are its main materials and colours?",
      "Whitewashed stone and dark oak; rusted steel and teal paint.",
    ),
  );
  const time = details.timeOfDay ? TIME_WORDS[details.timeOfDay] : undefined;
  questions.push(
    choice(
      "light_atmosphere",
      "Light",
      "What is its base light and atmosphere?",
      details.timeOfDay && details.timeOfDay !== "unspecified"
        ? `The script sets it at ${details.timeOfDay}.`
        : "The light the place lives in most of the time.",
      [
        "Dawn light",
        "Bright daylight",
        "Soft overcast",
        "Golden hour",
        "Dim and moody",
        "Night, lamps and street light",
        "Candle or firelight",
      ],
      time ? { prefill: time } : {},
    ),
  );
  return questions;
}
