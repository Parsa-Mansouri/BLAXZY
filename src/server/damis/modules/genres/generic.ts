import type { PromptModule } from "../types";

/** Used when the project's genre has no dedicated module yet. */
export const genericGenre: PromptModule = {
  kind: "genre",
  key: "generic",
  label: "Other genre",
  aliases: [],
  core: `There is no dedicated module for this project's genre (named in the project parameters). Apply that genre's established conventions as an experienced director would, without parody: its typical structure, rhythm, tone, visual language and audience expectations.`,
  tasks: {
    write: `- Identify the two or three conventions the audience of this genre expects most and deliver them; subvert at most one, deliberately.
- If the genre label is unclear or a mix, follow the brief's tone and say how you read the genre in notes.`,
    check: `- Judge the script against the conventions of its stated genre; flag a clear mismatch between the script's tone and the genre as an issue, not as a matter of taste.`,
    revise: `- Keep the genre's tone consistent in every revised passage.`,
    section: `- Choose camera, light and rhythm typical of the genre and keep them consistent across all blocks.`,
  },
};
