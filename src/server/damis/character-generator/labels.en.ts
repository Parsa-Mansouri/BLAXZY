/**
 * English labels for `review-catalog.json`, whose labels are Farsi only (`label_fa`). Keyed by the
 * catalog's codes; follow-up chips are keyed by their `value`. The Farsi stays in the catalog.
 */
import type { CatalogLabelsEn } from "../shared/review-catalog-types";

export const CHARACTER_REVIEW_LABELS_EN: CatalogLabelsEn = {
  options: {
    R01: "Something glitched at random, make it again",
    T01: "The face isn't fully visible",
    T02: "The face is distorted, blurry or uneven",
    T03: "The hands or fingers are wrong",
    T04: "The feet or body are cut off",
    T05: "The body proportions look unnatural",
    T06: "The board layout is wrong",
    T07: "The back view is wrong or missing",
    T08: "The three views aren't the same person",
    T09: "There's an extra person or object",
    T10: "There's text, a logo or a watermark",
    T11: "The outfit doesn't match the description or reference",
    T12: "The face doesn't match the reference photo",
    T13: "The character gets lost in the setting",
    T14: "The lighting is too dark or too harsh",
    T15: "The image doesn't match the chosen style",
    T16: "Parts of the setting overlap the body or face",
    P01: "Age or facial look",
    P02: "Hairstyle or hair color",
    P03: "Outfit design",
    P04: "Body shape",
    P05: "Skin tone",
    P06: "Facial expression or mood",
    P07: "Accessories",
    P08: "The setting itself",
    P09: "Time of day or lighting mood",
    P10: "Overall feel of the image",
    P11: "Doesn't fit the role or personality",
    P12: "Character image style (Pro only)",
    P99: "Something else",
  },
  followupOptions: {
    P01: {
      "noticeably older": "Older",
      "noticeably younger": "Younger",
      "heavier, more serious features": "Heavier, more serious features",
      "softer, gentler features": "Softer, gentler features",
    },
    P02: {
      "shorter hair": "Shorter",
      "longer hair": "Longer",
      "darker hair color": "Darker",
      "lighter hair color": "Lighter",
    },
    P03: {
      "a different color palette (specify in custom text)": "Outfit colors",
      "a different fabric or material (specify in custom text)": "Fabric",
      "a different cut or silhouette (specify in custom text)": "Cut and shape",
      "a simpler, more minimal outfit": "Simpler",
      "a more detailed, layered outfit": "More detailed",
    },
    P04: {
      "a slimmer build": "Slimmer",
      "a more muscular build": "More muscular",
      "a taller figure": "Taller",
      "a shorter figure": "Shorter",
    },
    P06: {
      "a more serious, severe expression": "More serious",
      "a warmer, kinder expression": "Kinder",
      "a more tired, weary expression": "More tired",
      "a more determined expression": "More determined",
    },
    P07: {
      "remove all optional accessories": "Remove the accessories",
      "add an accessory (specify in custom text)": "Add an accessory",
      "replace an accessory (specify in custom text)": "Swap an accessory",
    },
    P09: {
      "bright daytime": "Day",
      "golden hour sunset": "Sunset",
      night: "Night",
      "overcast daylight": "Overcast",
    },
    P10: {
      "more realistic": "More realistic",
      "more cinematic": "More cinematic",
      "lighter and brighter in tone": "Lighter and brighter",
      "darker and more serious in tone": "Darker and more serious",
    },
    P12: {
      "photorealistic live-action": "Realistic live action",
      "3D animation": "3D animation",
      "2D animation or anime": "2D animation or anime",
      "painterly illustration": "Painterly illustration",
    },
  },
  messages: {
    attemptLimit:
      "We've tried a few times and you're still not happy. Usually the description or the references are the problem. Would you like to rewrite the character's description or add a reference?",
    referenceConflict: "This change goes against the reference photo. What would you like to do?",
  },
  referenceConflictChoices: [
    "I'll replace the reference photo",
    "Set the reference aside and build from the text",
  ],
};
