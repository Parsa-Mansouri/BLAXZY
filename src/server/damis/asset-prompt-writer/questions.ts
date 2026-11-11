/**
 * The guided questions the UI asks when a director would rather answer than write an image
 * prompt. Pure data. Answers go to the asset-prompt-writer as `guidedAnswers` keyed by question
 * id; a choice answer is the option's `value`, a text answer is free text. Adding or rewording a
 * question changes what the writer sees: bump the asset-prompt-writer's version.
 */
import type { AssetKind } from "@/server/db/schema";

export type GuidedQuestion = {
  /** Stable key, unique within its kind; the key of `guidedAnswers`. */
  id: string;
  /** The question as the director reads it. */
  label: string;
  /** A hint in plain words under the question. */
  hint: string;
  kind: "choice" | "text";
  /** Required for `choice`: the fixed answers. */
  options?: { value: string; label: string }[];
  /** True when the director may skip it. */
  optional?: boolean;
};

function choice(
  id: string,
  label: string,
  hint: string,
  options: readonly string[],
  optional = false,
): GuidedQuestion {
  return {
    id,
    label,
    hint,
    kind: "choice",
    options: options.map((o) => ({ value: o, label: o })),
    ...(optional ? { optional } : {}),
  };
}

function text(id: string, label: string, hint: string, optional = false): GuidedQuestion {
  return { id, label, hint, kind: "text", ...(optional ? { optional } : {}) };
}

const eraChoices = [
  "Ancient or classical",
  "Medieval",
  "19th century",
  "Early 20th century (1900-1945)",
  "Mid 20th century (1945-1980)",
  "Contemporary",
  "Near future",
  "Far future",
  "Timeless or fantasy",
] as const;

const conditionChoices = [
  "Brand new",
  "Well kept",
  "Used, normal wear",
  "Worn and weathered",
  "Damaged or broken",
  "Antique and fragile",
] as const;

export const ASSET_QUESTIONS: Readonly<Record<AssetKind, GuidedQuestion[]>> = {
  character: [
    choice(
      "age",
      "How old are they?",
      "Pick the range that fits how they look on screen, not their birth year.",
      [
        "Child (under 12)",
        "Teenager",
        "Young adult (20s)",
        "Adult (30s-40s)",
        "Middle-aged (50s)",
        "Older (60s-70s)",
        "Very old (80+)",
      ],
    ),
    choice("build", "What is their build?", "Their body shape and how much space they take up.", [
      "Slight",
      "Lean",
      "Average",
      "Athletic",
      "Broad and sturdy",
      "Heavy-set",
      "Tall and lanky",
    ]),
    text(
      "face",
      "What does their face look like?",
      "Face shape, skin tone, eyes, nose, any marks like freckles or scars. Say as much or as little as you know.",
    ),
    text(
      "hair",
      "What is their hair like?",
      "Colour, length and style, and facial hair if any. Write 'bald' if they have none.",
    ),
    text(
      "wardrobe",
      "What are they wearing?",
      "The outfit as the audience first sees it: garments, colours, fabrics, shoes.",
    ),
    text(
      "defining_detail",
      "Is there one detail that must always show?",
      "A scar, a pair of glasses, a necklace, a limp, a tattoo. Something that makes them recognisable in every shot.",
      true,
    ),
    choice(
      "demeanour",
      "How do they carry themselves?",
      "The first impression of their posture and expression.",
      [
        "Calm and open",
        "Warm and friendly",
        "Guarded",
        "Tense and watchful",
        "Confident and commanding",
        "Tired and weighed down",
        "Playful",
        "Cold and stern",
      ],
      true,
    ),
  ],
  location: [
    choice("setting", "Inside or outside?", "Where the camera stands for the main view.", [
      "Interior",
      "Exterior",
      "Both (interior seen through openings)",
    ]),
    choice("era", "What era is it?", "The period the place belongs to.", eraChoices),
    text(
      "architecture",
      "What kind of place is it, and how is it built?",
      "A flat above a bakery, a clifftop lighthouse, a corrugated-iron market. Add materials: brick, timber, concrete, glass.",
    ),
    choice("time_of_day", "What time of day?", "It sets the light for the whole image.", [
      "Dawn",
      "Morning",
      "Midday",
      "Afternoon",
      "Golden hour",
      "Dusk",
      "Night",
    ]),
    choice("weather", "What is the weather?", "Leave it clear if the script says nothing.", [
      "Clear",
      "Overcast",
      "Rain",
      "Fog or mist",
      "Snow",
      "Storm",
      "Hot and hazy",
    ]),
    choice("mood", "What is the mood?", "How the place should feel when you first see it.", [
      "Warm and lived-in",
      "Calm and quiet",
      "Lonely and empty",
      "Busy and alive",
      "Tense and uneasy",
      "Grand and awe-inspiring",
      "Run-down and neglected",
    ]),
    text(
      "signature_detail",
      "What is the one thing that makes this place unmistakable?",
      "A crooked door, a red neon sign without words, a huge fig tree in the yard. It stays in every shot.",
      true,
    ),
  ],
  prop: [
    text(
      "object",
      "What exactly is it?",
      "Name it as you would to a prop maker: 'a brass pocket watch', not 'a watch thing'.",
    ),
    text(
      "material",
      "What is it made of?",
      "Metal, leather, wood, glass, plastic, paper. Mention any mix.",
    ),
    choice("size", "How big is it?", "Compared with a hand or a body.", [
      "Tiny (fits in a fingertip grip)",
      "Small (fits in the palm)",
      "Hand-sized",
      "Arm-sized",
      "Body-sized",
      "Larger than a person",
    ]),
    choice("condition", "What condition is it in?", "How much life it has already lived.", [
      ...conditionChoices,
    ]),
    text("colour", "What colours is it?", "Main colour first, then any accents or patterns."),
    choice("era", "What era is it from?", "So the design matches the period of the film.", [
      ...eraChoices,
    ]),
    text(
      "markings",
      "Any engraving, damage or special marks?",
      "Initials, a dent, a faded paint spot. Things that make this one object unique.",
      true,
    ),
  ],
  voice: [],
  creature: [
    text(
      "species",
      "What kind of creature is it?",
      "A real animal ('a grey wolf'), a mix, or an invented being. Describe it plainly.",
    ),
    choice("size", "How big is it?", "Compared with a person.", [
      "Tiny (fits in a hand)",
      "Small (a cat or a hare)",
      "Medium (a dog or a deer)",
      "Large (a horse or a bear)",
      "Huge (bigger than a car)",
    ]),
    text(
      "body",
      "What is its body like?",
      "Covering (fur, scales, feathers, skin), colours, markings, number of legs or wings.",
    ),
    text("face", "What does its face look like?", "Eyes, snout or beak, ears, teeth, expression."),
    choice("age", "How old does it look?", "Young, grown or old.", [
      "Young",
      "Adult",
      "Old",
      "Ageless",
    ]),
    choice(
      "temperament",
      "How does it seem at first glance?",
      "Its feel, not its role.",
      ["Gentle", "Curious", "Wary", "Fierce", "Majestic", "Eerie"],
      true,
    ),
    text(
      "defining_detail",
      "Is there one detail that must always show?",
      "A notched ear, a white patch, a collar, a glowing eye.",
      true,
    ),
  ],
  costume: [
    text(
      "garment",
      "What is the outfit?",
      "Every piece, top to bottom: coat, dress, boots, hat, gloves.",
    ),
    text("fabric", "What fabrics is it made of?", "Wool, silk, denim, leather, canvas, chainmail."),
    text(
      "colours",
      "What are its colours?",
      "Main colour, secondary colours and any trim or pattern.",
    ),
    choice("era", "What era is it from?", "So the cut and details match the period.", [
      ...eraChoices,
    ]),
    choice("condition", "What condition is it in?", "How the cloth looks.", [...conditionChoices]),
    choice(
      "fit",
      "How does it fit the wearer?",
      "How the outfit sits on the body.",
      [
        "Tailored and sharp",
        "Loose and comfortable",
        "Oversized",
        "Tight",
        "Layered and bulky",
        "Ill-fitting or borrowed",
      ],
      true,
    ),
    text(
      "details",
      "Which details matter?",
      "Buttons, badges, embroidery, a patch, a stain. Anything that must repeat in every scene.",
      true,
    ),
  ],
  other: [
    text(
      "subject",
      "What is it?",
      "Describe the thing that must look the same in every shot, in a sentence.",
    ),
    text(
      "shape",
      "What shape and size is it?",
      "Overall form, and how big it is next to a person.",
    ),
    text(
      "material",
      "What is it made of?",
      "Materials and surface: matte, glossy, rough, glowing, transparent.",
    ),
    text("colour", "What colours is it?", "Main colour first, then accents."),
    choice("era", "What era or world does it belong to?", "So its design fits the film.", [
      ...eraChoices,
    ]),
    text(
      "defining_detail",
      "What is the one detail that must always show?",
      "The thing that makes it recognisable at a glance.",
      true,
    ),
  ],
};
