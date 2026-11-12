/**
 * English labels for `review-catalog.json`, whose labels are Farsi only (`label_fa`). Keyed by the
 * catalog's codes and group ids; follow-up chips are keyed by their `value`, follow-up steps by
 * their position. The Farsi stays in the catalog.
 */
import type { CatalogLabelsEn } from "../shared/review-catalog-types";

export const CHARACTER_SHEET_REVIEW_LABELS_EN: CatalogLabelsEn = {
  groups: {
    face: "Face",
    full_body: "Full-body views",
    layout: "Layout and composition",
    background: "Background and light",
    details: "Detail frames (1 to 6)",
    general: "General",
  },
  options: {
    SR01: "Something glitched at random, make it again",
    SX01: "I want to change the character's design",
    ST01: "The face isn't fully visible",
    ST02: "The face is distorted, blurry or uneven",
    ST03: "The face doesn't match the approved image",
    ST04: "The front view shows a head or face",
    ST05: "The back view is wrong or missing",
    ST06: "The feet or body are cut off",
    ST07: "The three-column layout isn't followed",
    ST08: "The two full-body views differ in size or don't stand on one line",
    ST09: "The outfit doesn't match the approved image",
    ST10: "The columns aren't the same person",
    ST11: "The background isn't plain grey",
    ST12: "The colors are wrong or the light is harsh",
    ST13: "The character gets lost in the background",
    ST14: "There's extra text, labels, arrows or frames",
    ST15: "There's an extra person or object, or a second face",
    ST16: "The hands or fingers are wrong",
    ST17: "The style differs from the approved image",
    ST18: "The number or layout of the detail frames is wrong",
    ST19: "A detail shows something the character doesn't have",
    ST20: "The details are blurry or too small",
    ST21: "The fabric or footwear frame (default) is missing or wrong",
    ST22: "The numbers are missing, wrong or hard to read",
    SP01: "Change what one frame shows",
    SP02: "Show one frame larger, closer or from another angle",
    SP03: "Change the grey of the background",
    SP04: "Size or spacing of the full-body views",
    SP05: "Frame the face closer or wider",
    SP99: "Something else",
  },
  followupSteps: {
    SP01: ["Which frame? (the number on the image)", "What should it show?"],
    SP02: ["Which frame?", "How should it change?"],
  },
  followupOptions: {
    SP01: {
      "the belt and its buckle": "Belt and buckle",
      "an accessory worn by the character (specify in custom text)": "An accessory",
      "a facial or body mark (specify in custom text)": "A face or body mark",
      "an emblem, embroidery or patch (specify in custom text)": "An emblem or embroidery",
      "a hair detail (specify in custom text)": "A hair detail",
      "a construction detail such as collar, cuff or closure (specify in custom text)":
        "A stitching or fastening detail",
      __auto__: "Pick another standout detail for me",
    },
    SP02: {
      "larger in the frame": "Larger",
      "as a closer macro shot": "Closer (macro)",
      "from a different angle (specify in custom text)": "From another angle",
    },
    SP03: {
      "a lighter": "Lighter",
      "a darker": "Darker",
      "a mid-tone": "Medium",
    },
    SP04: {
      "make both full-body figures larger within the middle third, still fully in frame":
        "Larger views",
      "leave more empty space between the two full-body figures": "More space between the views",
      "make both full-body figures slightly smaller with more margin around them":
        "Smaller views with more margin",
    },
    SP05: {
      "frame the face closer, with less of the shoulders": "Closer on the face",
      "frame the face wider, with more of the shoulders and neckline": "Wider, with more shoulders",
    },
  },
  messages: {
    attemptLimit:
      "We've tried a few times and you're still not happy. Often the approved image is too low in quality or too small. Would you like to add the main reference photos (face or outfit), or rebuild the character board?",
    designChange:
      "The character's design can't change at the sheet step, because it's already approved. Would you like to go back to the character step and change it there?",
  },
};
