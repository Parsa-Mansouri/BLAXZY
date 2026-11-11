/**
 * The catalogue of issues the review UI offers when a director rejects a generated clip (a take).
 * Each code maps to a concrete instruction for the take-fixer dami. Adding, removing or rewording
 * an entry changes the dami's prompt: bump its version.
 */
import type { ImageIssueDefinition } from "../shared/reference";

export const TAKE_ISSUE_CODES = [
  "face_distorted",
  "character_mismatch",
  "anatomy_wrong",
  "wrong_action",
  "motion_glitch",
  "wrong_location",
  "object_wrong",
  "text_or_watermark",
  "wrong_camera_move",
  "audio_off",
  "too_static",
  "cut_off_early",
  "style_mismatch",
  "flicker",
] as const;

export type TakeIssueCode = (typeof TAKE_ISSUE_CODES)[number];
export type TakeIssueDefinition = ImageIssueDefinition<TakeIssueCode>;

export const TAKE_ISSUES: Readonly<Record<TakeIssueCode, TakeIssueDefinition>> = {
  face_distorted: {
    code: "face_distorted",
    label: "Face distorted",
    hint: "The face melts, warps or loses features while moving.",
    instruction:
      "Simplify the shot so the face stays stable: bring the face larger in frame (a medium close-up or close-up), face the camera or a gentle three-quarter angle, light it evenly and sharply, slow the subject's movement and the camera's, and remove anything crossing or hiding the face (hands, hair, steam, props, other people). Reduce the shot to one calm action.",
  },
  character_mismatch: {
    code: "character_mismatch",
    label: "Character does not match the sheet",
    hint: "Face, hair, age or clothes differ from the reference sheet.",
    instruction:
      "Make the character's reference unmissable: keep the token right after the name at every mention in every shot, restate the fixed look anchors from the description (hair, age, clothing, signature item) in the same words in each shot, and remove any word that suggests another look (different clothes, a hat, other hair). Do not add looks the description does not give.",
  },
  anatomy_wrong: {
    code: "anatomy_wrong",
    label: "Extra or missing limbs or fingers",
    hint: "Too many or too few arms, legs, hands or fingers; twisted joints.",
    instruction:
      "Keep bodies simple: state two arms, two legs and two five-fingered hands in view, avoid poses where limbs cross, overlap or tangle, keep hands visible and relaxed or doing one simple thing, prefer a closer framing on the upper body for dialogue, and cut fast or complex movement (running, climbing, fighting, hand-to-hand contact).",
  },
  wrong_action: {
    code: "wrong_action",
    label: "Wrong action",
    hint: "The characters do something other than what the shot says.",
    instruction:
      "Rewrite the action so it is one clear, physical, visible action per shot: who does what, with which body part or object, in which direction, from where to where. Put the main action first in the shot, use plain verbs the video model knows, drop secondary actions, and state the end position of the action.",
  },
  motion_glitch: {
    code: "motion_glitch",
    label: "Motion glitch or morphing",
    hint: "Things warp, melt, jump or change shape while moving.",
    instruction:
      "Reduce motion so nothing has to change shape: slow the action and the camera, choose one steady camera move or a static camera, remove fast moves, crowds, many small moving things, transformations and anything passing in front of a face or an object. Keep one subject moving at a time and state that everything else stays still.",
  },
  wrong_location: {
    code: "wrong_location",
    label: "Wrong location",
    hint: "The place, background or time of day is not right.",
    instruction:
      "Restate the location with its reference token, interior or exterior, time of day, weather and light, and its one or two signature features, at the start of the prompt and again in the first shot. Remove words that describe another place. Keep the characters' positions in it clear.",
  },
  object_wrong: {
    code: "object_wrong",
    label: "Object wrong or missing",
    hint: "A key prop is missing, wrong, doubled or changes in the shot.",
    instruction:
      "Name the key object with its reference token at its first mention in the shot where it matters, state where it is and who holds it, keep it in the same hand and position throughout, and keep it simple: no transformations, no fine handling. If it is not a reference, describe its size, colour and material in a few words.",
  },
  text_or_watermark: {
    code: "text_or_watermark",
    label: "Text or watermark in the picture",
    hint: "Letters, logos, subtitles or watermarks appear in the clip.",
    instruction:
      "Remove every word that invites readable text (signs, labels, screens, newspapers, letters read aloud, titles, brand names) and replace it with a blank or plain surface, or move the information into spoken dialogue. Close the prompt with 'no text, no subtitles, no captions, no logo, no watermark'.",
  },
  wrong_camera_move: {
    code: "wrong_camera_move",
    label: "Wrong camera move",
    hint: "The camera moves differently from what the shot needs.",
    instruction:
      "State the camera exactly: shot size, angle and one named move (static, slow push-in, pull-back, pan, tilt, tracking, handheld, crane, orbit) with its direction and speed, at the start of each shot. Remove other camera words that conflict, and state what the camera ends on.",
  },
  audio_off: {
    code: "audio_off",
    label: "Audio or lip sync off",
    hint: "The dialogue, voices or sounds do not fit what is on screen.",
    instruction:
      "Rewrite the sound direction: one speaker at a time, the speaker's mouth visible in the shot that carries the line (or the line marked off-screen), each line verbatim in its original language with an English delivery note and short enough for its shot, then the ambience and effects in one clear sentence. Remove music and sound cues that compete with the dialogue.",
  },
  too_static: {
    code: "too_static",
    label: "Too static",
    hint: "Little or nothing moves; it looks like a still picture.",
    instruction:
      "Add motion that is easy to generate: one clear action for the subject with start and end positions, a slow camera move (push-in, pan or track), and ambient movement in the scene (wind in cloth and hair, spray, smoke, passing light). Keep each movement slow and single, so that it adds life without adding risk.",
  },
  cut_off_early: {
    code: "cut_off_early",
    label: "Cut off early",
    hint: "The action or the dialogue is unfinished when the clip ends.",
    instruction:
      "Fit the content to the duration: cut the action and the lines to what really takes less than the duration, start the action in the first second, state a clear end beat that lands before the final second and hold the last frame still. Remove secondary actions and shorten dialogue rather than speeding delivery.",
  },
  style_mismatch: {
    code: "style_mismatch",
    label: "Style does not match",
    hint: "The look differs from the rest of the film.",
    instruction:
      "Open the prompt with the project's visual style in concrete rendering terms (technique, texture, palette, light, aspect ratio), worded exactly as the STYLE line of the previous prompt and the style guidance give them, and remove words that pull toward another style or era.",
  },
  flicker: {
    code: "flicker",
    label: "Flicker or unstable image",
    hint: "Light, colours or details pulse and jump from frame to frame.",
    instruction:
      "Stabilise the picture: describe one steady, continuous light source and its direction, avoid flickering light sources (fire, neon, candles, strobes, screens, passing headlights), avoid fine repeating patterns, rain and heavy particles, and avoid fast cuts or whip moves. Prefer soft, even light and a static or slow camera.",
  },
};

/** The catalogue as an ordered list (for the UI). */
export const TAKE_ISSUE_LIST: readonly TakeIssueDefinition[] = TAKE_ISSUE_CODES.map(
  (code) => TAKE_ISSUES[code],
);
