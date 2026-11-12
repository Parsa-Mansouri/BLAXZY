/**
 * The owner's suggested reason codes for revise mode (dami_script_writer_v0.2.md, section 5),
 * split into technical and preference. Labels are plain English for the request-changes sheet;
 * the dami receives the codes themselves as `selected_reasons`.
 */

export const WRITER_TECHNICAL_REASONS = [
  "unclear_action",
  "impossible_action",
  "inconsistent_name",
  "inconsistent_location_or_prop",
  "scene_has_no_change",
  "format_error",
  "contains_camera_or_prompt_language",
  "dialogue_unnatural",
  "too_long",
  "too_short",
] as const;

export const WRITER_PREFERENCE_REASONS = [
  "different_ending_tone",
  "more_genre_feeling",
  "less_genre_feeling",
  "more_visual_style",
  "less_visual_style",
  "change_character_behavior",
  "change_dialogue_tone",
  "simplify",
  "add_depth",
] as const;

export const WRITER_REASON_CODES = [
  ...WRITER_TECHNICAL_REASONS,
  ...WRITER_PREFERENCE_REASONS,
] as const;
export type WriterReasonCode = (typeof WRITER_REASON_CODES)[number];

export type WriterReason = {
  code: WriterReasonCode;
  type: "technical" | "preference";
  /** Short label for a tile or a fader stop. */
  label: string;
  /** What the code asks for, in a sentence (stored as the fix request's instruction). */
  instruction: string;
};

const TECHNICAL: Record<(typeof WRITER_TECHNICAL_REASONS)[number], [string, string]> = {
  unclear_action: ["Hard to follow", "Some action is unclear; make it concrete and readable."],
  impossible_action: [
    "Can’t happen",
    "Some action is physically impossible or cannot be filmed; make it possible.",
  ],
  inconsistent_name: ["Names change", "A name changes between scenes; use one name throughout."],
  inconsistent_location_or_prop: [
    "Places or objects drift",
    "A place or object changes name or state without a reason; keep it consistent.",
  ],
  scene_has_no_change: [
    "A scene goes nowhere",
    "A scene ends where it started; give it a purpose and a change.",
  ],
  format_error: ["Layout problems", "Fix the screenplay elements and headings."],
  contains_camera_or_prompt_language: [
    "Camera talk",
    "Remove camera, lens and video-model language from the text.",
  ],
  dialogue_unnatural: [
    "Stiff dialogue",
    "The dialogue sounds unnatural; make it performable and in character.",
  ],
  too_long: ["Shorter", "The script runs too long for the duration; cut it down."],
  too_short: ["Longer", "The script runs too short for the duration; deepen it."],
};

const PREFERENCE: Record<(typeof WRITER_PREFERENCE_REASONS)[number], [string, string]> = {
  different_ending_tone: ["The ending’s tone", "Give the ending a different tone."],
  more_genre_feeling: ["More genre", "Make the genre felt more strongly."],
  less_genre_feeling: ["Less genre", "Make the genre lighter."],
  more_visual_style: ["More style", "Let the visual style shape more of what we see."],
  less_visual_style: ["Less style", "Let the visual style shape less of what we see."],
  change_character_behavior: ["How people act", "Change how a character behaves."],
  change_dialogue_tone: ["How people talk", "Change the tone of the dialogue."],
  simplify: ["Simpler", "Simplify the story and the scenes."],
  add_depth: ["Deeper", "Add depth to the characters and their moments."],
};

export const WRITER_REASONS: readonly WriterReason[] = [
  ...WRITER_TECHNICAL_REASONS.map((code) => ({
    code,
    type: "technical" as const,
    label: TECHNICAL[code][0],
    instruction: TECHNICAL[code][1],
  })),
  ...WRITER_PREFERENCE_REASONS.map((code) => ({
    code,
    type: "preference" as const,
    label: PREFERENCE[code][0],
    instruction: PREFERENCE[code][1],
  })),
];

export function isWriterReasonCode(code: string): code is WriterReasonCode {
  return (WRITER_REASON_CODES as readonly string[]).includes(code);
}

export function writerReason(code: WriterReasonCode): WriterReason {
  return WRITER_REASONS.find((r) => r.code === code) as WriterReason;
}

/** The owner's `issue_type`: technical when any technical reason is picked. */
export function issueTypeFor(codes: readonly string[]): "technical" | "preference" {
  return codes.some((c) => (WRITER_TECHNICAL_REASONS as readonly string[]).includes(c))
    ? "technical"
    : "preference";
}
