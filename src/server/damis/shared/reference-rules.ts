/**
 * What a reference image (look) and a reference sheet must be, per asset kind. Shared by the
 * writer and the fixer of each, so they never disagree. Changing a rule here changes those damis:
 * bump their versions.
 */
import type { AssetKind } from "@/server/db/schema";

export type ImageAssetKind = Exclude<AssetKind, "voice">;

export const LOOK_KIND_RULES: Record<ImageAssetKind, string> = {
  character: `- Character: one person, full figure from head to toe, standing in a relaxed neutral pose facing the camera (arms loose at the sides, no gesture, calm neutral expression), plain seamless light-grey studio background, even soft light with no dramatic shadows, no props in hand unless the character is defined by one, no text. Show the face clearly. Wardrobe is the outfit the audience first sees.`,
  location: `- Location: the establishing view, the one wide frame that shows what kind of place this is and how it is built, with its signature feature in view and the light the script states (default: soft natural light for the time of day). No people unless the place makes no sense without them, then at most one small distant figure. No readable signs.`,
  prop: `- Prop: the object alone, product-style: centred, whole object in frame with margin around it, three-quarter angle that shows its form, on a plain seamless light-grey surface and background, soft even light with a faint contact shadow, no hands, no scene around it. Show materials, wear and markings clearly.`,
  creature: `- Creature: one animal or being, full body in profile or three-quarter view, standing naturally, on a plain seamless light-grey background, even soft light. Show covering (fur, scales, feathers), markings, eyes and face clearly. No other creatures, no people.`,
  costume: `- Costume: the outfit on its own on a neutral, faceless mannequin or invisible-body display, full length, front view, plain seamless light-grey background, even soft light. Show every garment, layer, fastening and trim. No face, no person, no scene.`,
  other: `- Other: the single subject, whole and centred on a plain seamless light-grey background with even soft light, from the angle that best shows its shape. If it is a place-like or atmospheric thing, show the one establishing view instead. No clutter.`,
};

export const SHEET_KIND_RULES: Record<ImageAssetKind, string> = {
  character: `- Character: a turnaround row of the full figure in four views on one shared ground line and scale: front, three-quarter, side (profile), back, neutral standing pose, arms relaxed, the same outfit in every view. Below it a row of face close-ups: neutral, smiling, angry, afraid or sad (at least three expressions), same face every time. Then two or three close-ups of the key costume details (the accessory, the fastening, the fabric). Consistent proportions across all views, neutral plain background, no labels.`,
  location: `- Location: one wide establishing view (the largest panel), two alternate angles of the same place (for example the reverse angle and a higher or lower angle), and two or three close-ups of key details (the signature feature, the main material, a typical corner). The time of day and light are those the script states for this location; if it uses several, use the first and keep the others out. No people, no vehicles that are not part of the place, no readable signs, no labels.`,
  prop: `- Prop: orthographic views on one shared scale: front, side, back and top, plus one three-quarter view; a scale cue (a hand holding it or a coin or pencil beside it, drawn, never a ruler with numbers); a close-up of its material and surface and a close-up of any marking or damage. Plain neutral background, even light, no labels.`,
  creature: `- Creature: a turnaround row in four views on one shared ground line: front, three-quarter, side, back, neutral standing pose; close-ups of the head from the front and in profile, and of distinctive covering or markings; a scale cue (a drawn human silhouette or hand beside it). Same creature in every view, plain neutral background, no labels.`,
  costume: `- Costume: the outfit on a faceless mannequin in four views (front, three-quarter, side, back) on one shared scale, plus close-ups of the key details (collar, fastenings, trim, embroidery, fabric texture). Plain neutral background, even light, no labels, no face.`,
  other: `- Other: the subject in front, side and back or top views as suits its shape, one three-quarter view, a scale cue, and a close-up of its material and its defining detail. Plain neutral background, even light, no labels.`,
};

export const SHEET_GENERAL_RULES = `## What a reference sheet is
- One image with several views of the same subject arranged on a plain neutral background in clean rows, evenly spaced, nothing overlapping, nothing cropped, generous margins. It is a working drawing for the video model, not a poster: no title, no panel borders, no captions, no numbers, no arrows, no labels, no logo, no watermark.
- The accepted reference image is attached to the generation. Every view reproduces exactly that subject: the same face, hair, outfit, colours, materials, markings and proportions. The prompt says so, and also describes the subject's identifying features in words, because the model weighs words and picture together. The sheet adds views; it never changes or improves the design.
- The sheet matches the reference image's rendering exactly (technique, palette, texture, light) and the project's visual style.
- Where the script description and the reference image differ, the reference image wins: the director accepted it.`;
