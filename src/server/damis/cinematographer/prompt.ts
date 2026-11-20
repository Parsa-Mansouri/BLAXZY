import type { DamiPrompt, PromptText } from "../framework/define";
import { cinematographerCard } from "./library";
import type { CinematographerInput } from "./schema";

const tag = (name: string, value: string) => `<${name}>\n${value}\n</${name}>`;

/**
 * The card is written for one image; this turns it into the DP of a whole film. The structured
 * answer replaces the card's Rule 3 (one prompt); Rule 1 holds as written.
 */
export const CINEMATOGRAPHER_FRAME = `In this job you are the director of photography of a whole film, not an enhancer of one image prompt. Use your card's Rule 2 (the look) and its Modes for every decision. Your card's Rule 3 does not apply: instead of one prompt you answer the JSON object described below.

Rule 1 holds strictly: the content belongs to the film's director. Never add or remove characters, actions, props, places or events; never describe what any character, location or prop looks like (faces, hair, clothing, materials, architecture, furniture). Characters, locations and props are named only by their ids; their sheets define how they look. You decide only lens, camera height and angle, framing, light, exposure, grade and texture.

Choose exactly one mode per scene from your card's Modes section, by its letter (mode_id), following the card's own rules for choosing.`;

const LOOK_TASK = `Mode "look": read <creative_bible> and <scenes>. Fill \`look\` with the film's camera and light language from your card (lens and camera, framing, framing of several characters, daylight, night, sealed interiors and their light, colour, contrast and texture), each as concrete rules a later shot can follow, and give every scene of <scenes> exactly one entry in \`look.scene_modes\` with its mode_id and the reason. Set \`mode\` to "look" and \`scene\` to null. Return only the JSON object.`;

const SCENE_TASK = `Mode "scene": the film's look is in <look>. For the scene in <scene>, use the mode <look> gives it, and fill \`scene\` with that mode_id and one entry per shot of <shots>, each shot_id exactly once: lens, camera height and angle, light, framing, grade and texture for that shot, within the director's camera position, size and staging. Set \`mode\` to "scene" and \`look\` to null. Return only the JSON object.`;

/**
 * Caching: the card is the system prompt (1). In `scene` mode the look is the same for every scene
 * of a run (2); the scene and its shots change per call.
 */
export function buildCinematographerPrompt(input: CinematographerInput): DamiPrompt {
  const system = [{ text: cinematographerCard(input.cinematographer_id).system, cache: true }];
  const content: PromptText[] = [];
  if (input.mode === "look") {
    content.push({
      text: [
        CINEMATOGRAPHER_FRAME,
        tag("creative_bible", JSON.stringify(input.creative_bible)),
        tag("scenes", JSON.stringify(input.scenes)),
        LOOK_TASK,
      ].join("\n\n"),
    });
  } else {
    content.push({
      text: [CINEMATOGRAPHER_FRAME, tag("look", JSON.stringify(input.look))].join("\n\n"),
      cache: true,
    });
    content.push({
      text: [
        tag("scene", JSON.stringify(input.scene)),
        tag("shots", JSON.stringify(input.shots)),
        SCENE_TASK,
      ].join("\n\n"),
    });
  }
  return { system, messages: [{ role: "user", content }] };
}
