/**
 * The catalogue of script issues the review UI offers when a user rejects a script. Each code
 * maps to a concrete instruction for the script-reviser dami. Adding, removing or rewording an
 * entry changes the reviser's prompt: bump its version.
 */
export const SCRIPT_ISSUE_CODES = [
  "pacing_slow",
  "pacing_rushed",
  "too_long",
  "too_short",
  "opening_weak",
  "ending_weak",
  "dialogue_unnatural",
  "too_much_dialogue",
  "tone_off",
  "character_unclear",
  "plot_hole",
  "not_visual",
  "hard_to_film",
  "too_many_characters",
  "too_many_locations",
  "formatting",
] as const;

export type ScriptIssueCode = (typeof SCRIPT_ISSUE_CODES)[number];

export type ScriptIssueDefinition = {
  code: ScriptIssueCode;
  /** The choice shown to the user. */
  label: string;
  /** A one-line hint under the choice. */
  hint: string;
  /** What the reviser must do about it. */
  instruction: string;
};

export const SCRIPT_ISSUES: Readonly<Record<ScriptIssueCode, ScriptIssueDefinition>> = {
  pacing_slow: {
    code: "pacing_slow",
    label: "Pacing is too slow",
    hint: "Scenes drag or take too long to get going.",
    instruction:
      "Enter scenes later and leave them earlier; cut repeated beats, redundant lines and transitional action; bring the dramatic question in sooner. Never cut a setup the ending pays off.",
  },
  pacing_rushed: {
    code: "pacing_rushed",
    label: "It feels rushed",
    hint: "Important moments go by too fast to land.",
    instruction:
      "Give the key turning points room: a reaction beat, a held silence or a short bridging moment before and after them. Pay for the added time by trimming elsewhere so the total stays on target.",
  },
  too_long: {
    code: "too_long",
    label: "Too long for the duration",
    hint: "The script runs over the target screen time.",
    instruction:
      "Cut to the target length: remove or merge the least necessary scenes and beats first, then tighten action and dialogue. State the estimated new screen time in the change summary.",
  },
  too_short: {
    code: "too_short",
    label: "Too short for the duration",
    hint: "The script runs under the target screen time.",
    instruction:
      "Expand to the target by deepening existing scenes (a complication, a reaction, a visual beat) or adding at most one scene that serves the main line. No filler. State the estimated new screen time.",
  },
  opening_weak: {
    code: "opening_weak",
    label: "The opening is weak",
    hint: "The first moments don't grab attention.",
    instruction:
      "Rewrite the opening so the first seconds hook: start in motion, on a striking image or an open question, with the protagonist doing something specific. Keep every setup fact the rest of the script relies on.",
  },
  ending_weak: {
    code: "ending_weak",
    label: "The ending is weak",
    hint: "The ending doesn't land or feels unearned.",
    instruction:
      "Rewrite the ending so it answers the question the opening raised, through a choice the protagonist makes, paying off what was planted, and closing on a strong final image. Add a minimal setup earlier only if the new ending needs it.",
  },
  dialogue_unnatural: {
    code: "dialogue_unnatural",
    label: "Dialogue sounds unnatural",
    hint: "Lines sound written, not spoken.",
    instruction:
      "Rewrite the affected lines so they sound spoken: shorter, with contractions, interruptions and subtext instead of stated feelings, and a distinct voice per character. Keep the information each line carries.",
  },
  too_much_dialogue: {
    code: "too_much_dialogue",
    label: "Too much talking",
    hint: "Characters explain what the picture could show.",
    instruction:
      "Replace dialogue with behaviour and images wherever the picture can carry the meaning; cut lines that repeat what we see or what characters already know.",
  },
  tone_off: {
    code: "tone_off",
    label: "The tone is off",
    hint: "It doesn't feel like the genre or mood I want.",
    instruction:
      "Bring every scene in line with the project's genre and any tone named in the parameters or the director's note: adjust word choice, rhythm, humour and imagery. Keep plot events unless the note asks to change them.",
  },
  character_unclear: {
    code: "character_unclear",
    label: "Characters are unclear",
    hint: "I don't understand what they want, or they act inconsistently.",
    instruction:
      "Make the protagonist's want visible early through action; keep each character's behaviour, voice and look consistent; resolve contradictions with the smallest edits.",
  },
  plot_hole: {
    code: "plot_hole",
    label: "The story doesn't add up",
    hint: "Something is illogical or unexplained.",
    instruction:
      "Find the gaps in motivation, cause and effect or timeline and close each with the smallest change: a line, a planted object, a reordered beat.",
  },
  not_visual: {
    code: "not_visual",
    label: "Not visual enough",
    hint: "It tells instead of shows.",
    instruction:
      "Replace stated emotions and summaries with specific, filmable images and behaviour; give each location a visual signature and each scene a light source.",
  },
  hard_to_film: {
    code: "hard_to_film",
    label: "Hard to generate as video",
    hint: "Crowds, fights, on-screen text or other things AI video struggles with.",
    instruction:
      "Rewrite the moments generative video handles badly into filmable equivalents that keep the story beat: fewer characters in frame, no contact choreography, no legible text, implied rather than shown violence, nothing longer than a 15-second take.",
  },
  too_many_characters: {
    code: "too_many_characters",
    label: "Too many characters",
    hint: "Hard to follow, and each one needs a consistent look.",
    instruction:
      "Merge or cut minor characters so each scene has a small cast; a merged character gets one name used everywhere.",
  },
  too_many_locations: {
    code: "too_many_locations",
    label: "Too many locations",
    hint: "The story jumps between too many places.",
    instruction:
      "Consolidate scenes into fewer locations where the story allows; each location kept must earn its place and keep exactly one name.",
  },
  formatting: {
    code: "formatting",
    label: "Formatting problems",
    hint: "Scene headings, names or dialogue are not laid out properly.",
    instruction:
      "Fix the screenplay format (scene headings, character cues, parentheticals, consistent names) without changing the content.",
  },
};

/** The catalogue as an ordered list (for the UI). */
export const SCRIPT_ISSUE_LIST: readonly ScriptIssueDefinition[] = SCRIPT_ISSUE_CODES.map(
  (code) => SCRIPT_ISSUES[code],
);
