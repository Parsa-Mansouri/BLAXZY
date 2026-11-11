/**
 * The catalogue of issues the review UI offers when a director asks for changes to a prepared
 * block (its prompt and its list of reference assets). Each code maps to a concrete instruction
 * for the block-reviser dami. Adding, removing or rewording an entry changes the dami's prompt:
 * bump its version.
 */
import type { ImageIssueDefinition } from "../shared/reference";

export const BLOCK_ISSUE_CODES = [
  "wrong_assets",
  "missing_asset",
  "wrong_camera",
  "action_unclear",
  "dialogue_wrong",
  "too_much_happening",
  "continuity_break",
  "tone_off",
  "wrong_setting",
  "invented_content",
] as const;

export type BlockIssueCode = (typeof BLOCK_ISSUE_CODES)[number];
export type BlockIssueDefinition = ImageIssueDefinition<BlockIssueCode>;

export const BLOCK_ISSUES: Readonly<Record<BlockIssueCode, BlockIssueDefinition>> = {
  wrong_assets: {
    code: "wrong_assets",
    label: "Wrong assets attached",
    hint: "A character, place or object is attached that does not belong in this shot.",
    instruction:
      "Find the asset or assets that do not belong in this block according to the script excerpt and the note, remove them from assetRefs, renumber the remaining tokens from 1 without gaps, and rewrite the sentences that named them so the shot reads naturally without them. If the removed asset was only background, describe the space in words.",
  },
  missing_asset: {
    code: "missing_asset",
    label: "Missing asset",
    hint: "Something in the shot has no reference attached.",
    instruction:
      "Find the character, location or object that the script excerpt puts in this block but the prompt does not reference. If it is in the available asset list, add it to assetRefs, call it with a token where the prompt names it (add one sentence of action or placement if it is not named yet), and renumber the tokens in order of first appearance. If it is not available, keep it as a plain name with look words and say in its change entry that it has no reference. Respect the limit of references.",
  },
  wrong_camera: {
    code: "wrong_camera",
    label: "Wrong shot size or camera",
    hint: "The framing, angle or camera move is not what the scene needs.",
    instruction:
      "Rewrite the shot size, angle and camera movement of the shots the review points at (all shots if it names none) using the camera vocabulary, one simple named move per shot, and keep each shot's action and timing. Match the size to what the beat needs: a close-up for a reaction or a small object, a wide for geography.",
  },
  action_unclear: {
    code: "action_unclear",
    label: "Action unclear",
    hint: "It is hard to tell who does what.",
    instruction:
      "Rewrite each shot so it has one clear action with a clear subject: who does what, to what, in which direction, with which hand or part of the body. Replace abstract verbs with visible ones, state screen positions (left, right, foreground), and drop secondary actions that compete with the main one.",
  },
  dialogue_wrong: {
    code: "dialogue_wrong",
    label: "Dialogue wrong",
    hint: "A line is missing, changed, attributed to the wrong person or badly timed.",
    instruction:
      "Compare every spoken line in the prompt with the script excerpt. Restore each line verbatim in its original language, put it in the right speaker's mouth and the right shot, add a short English delivery note, and make sure only one person speaks at a time with the speaker visible or marked off-screen. Fix timing so each line fits its shot.",
  },
  too_much_happening: {
    code: "too_much_happening",
    label: "Too much for the duration",
    hint: "More happens than fits in the seconds of this block.",
    instruction:
      "Reduce the block to what fits its duration: at most one clear action per shot and at most the number of shots the time allows (about three seconds each at the least). Remove secondary business, merge or drop shots, and keep the beats the script excerpt cannot lose. Do not change the block's duration. Say in the change entry what was left out.",
  },
  continuity_break: {
    code: "continuity_break",
    label: "Continuity break with the previous shot",
    hint: "Wardrobe, light, positions or props do not follow on from the shot before.",
    instruction:
      "State explicitly what carries over from the previous shot of the same scene: wardrobe and wounds, props in hand, time of day and light direction, who is screen-left and screen-right, the direction of movement. Use only facts the script excerpt and the previous prompt give; never invent a look. Put the carry-over in the SCENE and CAST lines, briefly.",
  },
  tone_off: {
    code: "tone_off",
    label: "Tone is off",
    hint: "The mood does not match the moment.",
    instruction:
      "Re-tune the mood through visible means only: light quality and colour, pace of the camera, how close the framing is, posture and expression, ambience and music. Name each change concretely instead of writing mood words. Keep every event and line as it is.",
  },
  wrong_setting: {
    code: "wrong_setting",
    label: "Wrong place, time or light",
    hint: "The location, time of day, weather or lighting is not right.",
    instruction:
      "Restate the location (interior or exterior), time of day, weather and light sources exactly as the script excerpt and the location's description give them, and remove contradicting details from every shot. If the review names a different setting than the script, follow the review and say so.",
  },
  invented_content: {
    code: "invented_content",
    label: "Content the script does not have",
    hint: "The prompt adds events, people, objects or lines that are not in the script.",
    instruction:
      "Compare the prompt with the script excerpt, find everything that is not supported by it (events, characters, objects, lines, locations) and remove it, keeping camera, light and micro-actions that only dress the script's own events. If removing an asset's only mention leaves it unused, drop it from assetRefs and renumber the tokens.",
  },
};

/** The catalogue as an ordered list (for the UI). */
export const BLOCK_ISSUE_LIST: readonly BlockIssueDefinition[] = BLOCK_ISSUE_CODES.map(
  (code) => BLOCK_ISSUES[code],
);
