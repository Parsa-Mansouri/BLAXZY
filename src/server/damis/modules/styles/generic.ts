import type { PromptModule } from "../types";

/** Used when the project's visual style has no dedicated module yet. */
export const genericStyle: PromptModule = {
  kind: "style",
  key: "generic",
  label: "Other visual style",
  aliases: [],
  core: `There is no dedicated module for this project's visual style (named in the project parameters). Interpret it as a production designer would: decide its rendering technique, palette, line or texture quality, light and motion, and apply that interpretation identically everywhere.`,
  tasks: {
    write: `- Write images that suit the named style; avoid moments the style cannot express well.`,
    detect: `- Describe assets in terms that fit the named style (materials, shapes, palette) and stay neutral where the style is ambiguous.`,
    section: `- Open every block with the same STYLE line describing the named style concretely (technique, texture, palette, light) plus the aspect ratio; never vary its wording between blocks.`,
  },
};
