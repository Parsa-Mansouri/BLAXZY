import type { DamiPrompt } from "../framework/define";
import { directorBible } from "../director/prompt";
import { FILM_DIRECTOR_SYSTEM } from "../director-style/prompt-text";
import type { FilmDirectorInput } from "./schema";
import { directorStyleCard } from "../director-style/styles";

const tag = (name: string, value: string) => `<${name}>\n${value}\n</${name}>`;

/**
 * What this pipeline takes from MODE B. The master prompt is written for a chat that ends in a
 * Markdown document with Seedance prompts; here the director only plans the shots: later steps
 * (cinematographer, breakdown, prompter) write the prompts, and the character, location and prop
 * sheets own every physical description.
 */
export const FILM_DIRECTOR_INSTRUCTION = `Work in MODE B, directing the script in <script> with the Director Style Card in <director_style_card>.

Do only these steps of MODE B:
- Step 1 (read the script): list every beat in \`beats\`; mark must_survive for each beat the film cannot lose.
- Step 2 (director's decisions): \`directors_notes\` (look intent, camera, sound, rhythm, from the card) and every change in \`changes\` (script direction, directed version, reason). The card wins over the script's own camera and sound directions; story, dialogue and reveals never change.
- Step 4 (scene geography): one entry per scene in \`scene_geography\`, with the scene's location id, the absolute layout, the camera's side of the action, the screen direction and each character's starting position and facing.
- Step 5 (mise-en-scène): every shot states the camera (position, height, angle, movement, background), every character in or just out of frame (frame position, depth, body facing, head, eyeline in frame terms, whom they see, posture, relation to the others), the props (who holds what in which hand, or where it sits), the action, the dialogue and the sound.
- Step 7 (timing): each shot gets a duration in seconds (at most 30) paced for <block_mode>; never cut mid-line or mid-action; keep dialogue near 2.5 words per second. Shots are later grouped into 15 or 30 second blocks (or kept one per generation for \`shot\`), so put cuts where a block may break.

Do NOT do steps 3, 6, 8 or 9:
- Write no Seedance prompt text, no prompt format, no negatives.
- Write no continuity bible and no physical descriptor of any character, location or prop (age, face, hair, build, clothing, colours, materials, architecture). Separate character, location and prop sheets define how they look. Refer to every asset only by its id from <asset_registry> (char_1, loc_1, prop_1, or the token @char_1 inside free text); never by a description.
- Write no edit plan and no end card.

Rules for the JSON:
- Shots are in script order with ids s1, s2, s3... and each \`script_quote\` gives the first and last words of the script the shot covers, copied verbatim; together the shots cover the whole script.
- Scene ids are sc_1, sc_2... in script order; every shot and beat names its scene.
- Dialogue lines are copied word for word from the script; never add, cut or reword a line. heard_as is on_screen only when the speaker is in frame.
- Each shot's start_state is written out in full (positions, facings, props in hand, light), matching the previous shot's end_state; never "same as before".
- Use status "blocked" only when the script cannot be directed at all, with the reason in warnings.

Return only the JSON shot plan.`;

/**
 * The user turn. Caching (3 of 4 breakpoints): the master prompt is the same for every call (1);
 * the style card is the same for every project directed with it (2); the bible, registry, script,
 * block mode and instruction are the project's (3), reused by the corrective retry.
 */
export function buildFilmDirectorPrompt(input: FilmDirectorInput): DamiPrompt {
  const project = [
    tag("creative_bible", JSON.stringify(directorBible(input.creative_bible))),
    tag("asset_registry", JSON.stringify(input.asset_registry)),
    tag("script", input.script),
    tag("block_mode", input.block_mode),
    FILM_DIRECTOR_INSTRUCTION,
  ].join("\n\n");
  return {
    system: [{ text: FILM_DIRECTOR_SYSTEM, cache: true }],
    messages: [
      {
        role: "user",
        content: [
          { text: tag("director_style_card", directorStyleCard(input.director_id)), cache: true },
          { text: project, cache: true },
        ],
      },
    ],
  };
}
