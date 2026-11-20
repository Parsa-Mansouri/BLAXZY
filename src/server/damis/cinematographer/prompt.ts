import type { DamiPrompt, PromptText } from "../framework/define";
import { directorBible } from "../director/prompt";
import { sceneRangeIds } from "../director-v2/schema";
import { cinematographerStyleCard } from "./library";
import { CINEMATOGRAPHER_SYSTEM } from "./prompt-text";
import type { AnyCinematographerInput } from "./schema";

const tag = (name: string, value: string) => `<${name}>\n${value}\n</${name}>`;

/**
 * How CINEMATOGRAPHER v1.0 uses the DP's card (user turn only; the owner's system prompt is sent
 * unchanged). The owner's sources of truth come first; the card shapes what they leave open.
 */
export const CINEMATOGRAPHER_STYLE_CARD_INSTRUCTION = `<cinematographer_style_card> is the photographic style of the director of photography whose look you shoot this film in: the card's "Rule 2: The look", with its Modes. Use it this way:
- Your sources of truth come first, in your own order: <platform_config>, the continuity locks, DIRECTOR's decisions in <director_output>, and the Creative Bible's contracts (the style_contract above all), slices and anti-cliché guards. The card shapes every choice they leave open: the light (sources, direction, quality, fill, contrast), the colour world, texture, lens feel, depth of field, camera support and speed, and composition.
- In look mode, write the look bible in this card's style; where the card has Modes, choose one per location and time of day by the card's own rules. In shots and relight modes, the saved <look_bible> is the look, word for word; the card only guides choices the look bible leaves open.
- If the card conflicts with the Creative Bible or a director decision, the bible and the director win: follow them and add a warning of type "other" with ref "cinematographer_style_card" that names the conflict.
- Where the card speaks of "the user", read the script and DIRECTOR's decisions. The card's Rule 1 still holds: never add content (people, objects, weather, smoke, light sources as objects) and never describe what a character, location or prop looks like. The card's single-image output rule (Rule 3) does not apply: answer only in your JSON output format. Your own word rules win over the card's wording: write focal lengths as a lens feel with its visible effect, never as millimetres, and name no brands.
- The director of photography's name never travels: never write it, or "in the style of", in any field.`;

const CLOSING = {
  look: "Build the project's look bible now (mode look). Return only the JSON object.",
  shots:
    "Add the cinematography of every shot in <director_shots> now (mode shots), in order, using <look_bible> verbatim. Return only the JSON object.",
  relight:
    "Compare <location_sheet> with every light setup of its location now (mode relight). Return only the JSON object.",
} as const;

/**
 * The owner's `<inputs>`, stable parts first. `<director_output>` is sent without its shots, which
 * follow per call as `<director_shots>` (all of them in look and relight modes, the range's in
 * shots mode), so the director's header stays in the cached prefix.
 *
 * Caching (up to 4 breakpoints): the owner's system prompt (1); the DP card and how to use it,
 * the same for every film shot with that card (2); platform numbers, Creative Bible and the
 * director's header, the same for every call of a run (3); the saved look bible, the same for
 * every shots batch and relight (4).
 */
export function buildCinematographerV1Prompt(input: AnyCinematographerInput): DamiPrompt {
  const card = [
    tag("cinematographer_style_card", cinematographerStyleCard(input.cinematographer_id)),
    CINEMATOGRAPHER_STYLE_CARD_INSTRUCTION,
  ].join("\n\n");
  const { shots, ...header } = input.director_output;
  const project = [
    tag("platform_config", JSON.stringify(input.platform_config)),
    tag("creative_bible", JSON.stringify(directorBible(input.creative_bible))),
    tag("director_output", JSON.stringify(header)),
  ].join("\n\n");
  const content: PromptText[] = [
    { text: card, cache: true },
    { text: project, cache: true },
  ];
  if (input.mode !== "look") {
    content.push({ text: tag("look_bible", JSON.stringify(input.look_bible)), cache: true });
  }
  const perCall = [tag("mode", input.mode)];
  let callShots = shots;
  if (input.mode === "shots") {
    perCall.push(tag("scene_range", input.scene_range));
    const range =
      sceneRangeIds(
        input.scene_range,
        header.scene_plan.map((s) => s.scene_id),
      ) ?? [];
    callShots = shots.filter((s) => range.includes(s.scene_id));
  }
  perCall.push(tag("director_shots", JSON.stringify(callShots)));
  if (input.mode === "relight")
    perCall.push(tag("location_sheet", JSON.stringify(input.location_sheet)));
  perCall.push(CLOSING[input.mode]);
  content.push({ text: perCall.join("\n\n") });
  return {
    system: [{ text: CINEMATOGRAPHER_SYSTEM, cache: true }],
    messages: [{ role: "user", content }],
  };
}
