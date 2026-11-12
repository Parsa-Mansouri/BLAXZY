/**
 * The catalogue of issues the review UI offers when a director rejects an asset's reference
 * image (the "look"). Each code maps to a concrete instruction for the asset-fixer dami. Adding,
 * removing or rewording an entry changes the fixer's prompt: bump its version.
 */
import type { AssetKind } from "@/server/db/schema";
import { IMAGE_ASSET_KINDS, type ImageIssueDefinition } from "../shared/reference";

export const LOOK_ISSUE_CODES = [
  "face_incomplete",
  "anatomy_wrong",
  "wrong_age",
  "wrong_clothing",
  "wrong_era",
  "wrong_details",
  "wrong_colours",
  "text_or_watermark",
  "style_mismatch",
  "background_not_clean",
  "wrong_framing",
  "extra_subjects",
  "lighting_poor",
] as const;

export type LookIssueCode = (typeof LOOK_ISSUE_CODES)[number];
export type LookIssueDefinition = ImageIssueDefinition<LookIssueCode>;

export const LOOK_ISSUES: Readonly<Record<LookIssueCode, LookIssueDefinition>> = {
  face_incomplete: {
    code: "face_incomplete",
    label: "Face not fully generated",
    hint: "The face is blurred, cropped, distorted or missing features.",
    instruction:
      "Make the face unmissable: state that the full face is visible, in sharp focus, facing the camera, with both eyes, nose and mouth clearly drawn and the whole head inside the frame with margin. Describe the face concretely (shape, eyes, nose, mouth) and drop anything that hides it (hair across the face, hats, shadows, heavy depth of field).",
  },
  anatomy_wrong: {
    code: "anatomy_wrong",
    label: "Extra or missing limbs or fingers",
    hint: "Too many or too few arms, legs, hands or fingers, or twisted joints.",
    instruction:
      "Spell out the anatomy: two arms, two legs, two hands with five fingers each, hanging relaxed in view and not overlapping the body. Choose a simple pose that cannot tangle limbs (standing straight, arms at the sides) and remove anything that hides or crosses hands and feet. For a creature, state its exact number of legs, wings or heads.",
  },
  wrong_age: {
    code: "wrong_age",
    label: "Wrong age",
    hint: "They look too young or too old.",
    instruction:
      "State the intended age as a range and back it with visible cues (skin texture, lines, hair colour, posture, build). Remove cues that push the other way. Keep every other trait as it was.",
  },
  wrong_clothing: {
    code: "wrong_clothing",
    label: "Wrong clothing",
    hint: "The outfit is not what the script or I asked for.",
    instruction:
      "Rewrite the wardrobe garment by garment with fabric, colour, fit and condition, in the order the eye reads them (head to toe), and state what is not worn. Keep the era and the character's identity.",
  },
  wrong_era: {
    code: "wrong_era",
    label: "Wrong era",
    hint: "Things in the picture belong to another time or place.",
    instruction:
      "Name the era and place explicitly and replace every anachronistic element (clothing cut, fabrics, hair, architecture, objects, materials) with period-correct ones. Add a short exclusion for the offending items.",
  },
  wrong_details: {
    code: "wrong_details",
    label: "Details don't match the description",
    hint: "Key features from the script are missing or different.",
    instruction:
      "Re-read the script description, find the facts the prompt dropped or blurred, and state each one concretely and early in the prompt. Where a fact was present but ignored by the image, move it forward and phrase it more specifically.",
  },
  wrong_colours: {
    code: "wrong_colours",
    label: "Wrong colours",
    hint: "The colours are off from what the script or I asked for.",
    instruction:
      "State every key colour by name next to the thing it belongs to (colour, then material, then item) and make the palette consistent with the project's style. Remove contradicting colour words.",
  },
  text_or_watermark: {
    code: "text_or_watermark",
    label: "Text or watermark in the image",
    hint: "Letters, logos, signatures or watermarks appear in the picture.",
    instruction:
      "Remove any wording that invites text (signs, labels, captions, titles, brand names, 'poster', 'cover') and replace it with a blank or plain-pattern surface. Close the prompt with 'no text, no letters, no logo, no watermark, no signature'.",
  },
  style_mismatch: {
    code: "style_mismatch",
    label: "Style doesn't match the project",
    hint: "It looks photographic, cartoonish or painted differently from the rest.",
    instruction:
      "Open the prompt with the project's visual style in concrete rendering terms (technique, texture, palette, light) exactly as the visual style guidance gives them, and remove words that pull toward another style.",
  },
  background_not_clean: {
    code: "background_not_clean",
    label: "Background is not clean",
    hint: "There is clutter, a scene or gradients behind the subject.",
    instruction:
      "Set a single plain seamless light-grey background with even light, no horizon line, no floor pattern, no objects, no shadows cast on the background; keep only a soft contact shadow under the subject. For a location, keep the place but remove people, vehicles and stray objects that are not part of it.",
  },
  wrong_framing: {
    code: "wrong_framing",
    label: "Wrong framing",
    hint: "The subject is cropped, too far away, off-centre or at a bad angle.",
    instruction:
      "State the framing exactly: the whole subject inside the frame with margin on every side, centred, the camera at the subject's mid-height, straight on or a gentle three-quarter angle, lens neither wide nor telephoto. For a character: head to toe including feet. For a location: the wide establishing view.",
  },
  extra_subjects: {
    code: "extra_subjects",
    label: "Extra people or objects",
    hint: "There is more in the picture than the one asset.",
    instruction:
      "State that the subject is alone in the picture and remove every word that adds a second person, creature, crowd or loose object. For a location, allow no people unless the place needs one small distant figure.",
  },
  lighting_poor: {
    code: "lighting_poor",
    label: "Lighting is hard to read",
    hint: "Too dark, harsh shadows, blown highlights or strong colour casts.",
    instruction:
      "Specify even, soft, neutral-white light from the front and slightly above, with open shadows and full detail in both the dark and bright areas. For a location, keep the time of day the script states but make it readable: soft, directional natural light with visible detail in the shadows.",
  },
};

/** The catalogue as an ordered list (for the UI). */
export const LOOK_ISSUE_LIST: readonly LookIssueDefinition[] = LOOK_ISSUE_CODES.map(
  (code) => LOOK_ISSUES[code],
);

/** Living subjects with a face and a body. */
const BEINGS: readonly AssetKind[] = ["character", "creature"];
/** Everything with an image except a location, which is the background itself. */
const NOT_PLACES: readonly AssetKind[] = IMAGE_ASSET_KINDS.filter((k) => k !== "location");

/**
 * Which kinds of asset each issue applies to: the review UI offers only those and the service
 * refuses the rest. A face, limbs or an age only make sense for a being, clothing for a being or
 * a costume, a clean backdrop for anything but a place. Not part of the fixer's prompt.
 */
export const LOOK_ISSUE_KINDS: Readonly<Record<LookIssueCode, readonly AssetKind[]>> = {
  face_incomplete: BEINGS,
  anatomy_wrong: BEINGS,
  wrong_age: BEINGS,
  wrong_clothing: ["character", "costume"],
  wrong_era: IMAGE_ASSET_KINDS,
  wrong_details: IMAGE_ASSET_KINDS,
  wrong_colours: IMAGE_ASSET_KINDS,
  text_or_watermark: IMAGE_ASSET_KINDS,
  style_mismatch: IMAGE_ASSET_KINDS,
  background_not_clean: NOT_PLACES,
  wrong_framing: IMAGE_ASSET_KINDS,
  extra_subjects: IMAGE_ASSET_KINDS,
  lighting_poor: IMAGE_ASSET_KINDS,
};

/** True when the look issue applies to this kind of asset. */
export function lookIssueFits(code: LookIssueCode, kind: AssetKind): boolean {
  return LOOK_ISSUE_KINDS[code].includes(kind);
}

/** The look issues offered for one kind of asset, in catalogue order (none for a voice). */
export function lookIssuesFor(kind: AssetKind): readonly LookIssueDefinition[] {
  return LOOK_ISSUE_LIST.filter((issue) => lookIssueFits(issue.code, kind));
}
