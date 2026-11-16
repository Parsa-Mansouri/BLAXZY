/** Copy and switches for the landing sections. */

/**
 * The guided plan's public name. Still undecided: "Wizard" stands in until it is chosen, and
 * renaming it is this one line.
 */
export const GUIDED_PLAN_NAME = "Wizard";

/**
 * Hamed's video for the "how simple it is" section, under public/. While it is null the section
 * shows the four steps as type instead of an empty frame.
 */
export const SIMPLICITY_VIDEO: { src: string; poster: string } | null = null;

/** The four stages, in order. Each has its own animated scene in call-sheet.tsx. */
export const STEPS: readonly { name: string }[] = [
  { name: "Style" },
  { name: "Script" },
  { name: "Pre-production" },
  { name: "Production" },
];
