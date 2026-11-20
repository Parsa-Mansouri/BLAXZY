import type { DamiPrompt, PromptText } from "../framework/define";
import { directorBible } from "../director/prompt";
import { directorStyleCard } from "../director-style/styles";
import { DIRECTOR_V2_SYSTEM } from "./prompt-text";
import type { AnyDirectorV2Input } from "./schema";

const tag = (name: string, value: string) => `<${name}>\n${value}\n</${name}>`;

/**
 * How DIRECTOR v2.0 uses the Director Style Card (user turn only; the owner's system prompt is
 * sent unchanged). The owner's sources of truth come first; the card shapes what they leave open.
 */
export const DIRECTOR_STYLE_CARD_INSTRUCTION = `<director_style_card> is the Director Style Card of the director whose style you direct this film in. Use it this way:
- Your sources of truth come first, in your own order: <platform_config>, the continuity locks, the approved script and the Creative Bible's contracts, slices and anti-cliché guards. The card shapes every choice they leave open: staging, camera intent (whose shot, size, angle, height, axis, why the camera moves), rhythm, holds, cut points, shot lengths inside your timing rules, and sound cues.
- If the card conflicts with the Creative Bible, the bible wins: follow the bible and add a warning of type "other" with ref "director_style_card" that names the conflict.
- The card's own output format, its prompt-writing rules and its document instructions (the Seedance prompt layout, the continuity bible format, the edit plan) do not apply here: answer only in your JSON output format. Its notes on light, colour and lens are not yours to write: CINEMATOGRAPHER owns them.
- The director's name never travels: never write it, or "in the style of", in any field.`;

/** The mode's closing line (and, for the batch modes, how batches are joined). */
function modeInstruction(input: AnyDirectorV2Input): string {
  switch (input.mode) {
    case "full":
      return "Direct the whole script now (mode full). Return only the JSON object.";
    case "plan":
      return 'Run the plan pass now (mode plan): no shots. No shot exists yet, so a costume version\'s `from_shot` names the scene_id where that version starts (e.g. "sc_4"). Return only the JSON object.';
    case "write_shots":
      return `Write the shots of the scenes in <scene_range> now (mode write_shots), using <plan> verbatim. Other scene ranges are written in separate calls and joined by the platform, so:
- shot ids are scene-scoped: sh_<scene number>_<two-digit index> (sc_5 → sh_5_01, sh_5_02 …);
- \`order\` counts 1, 2, 3 … within this answer;
- \`staging_states\` holds only the states you add; the plan's states are used by id.
Return only the JSON object.`;
    case "repair":
      return `Repair the scenes of <repair_requests> now (mode repair). <current_shots> holds those scenes' current shots and the staging states they use. For each scene you repair, return its complete replacement shot list in order (unchanged shots included, with their ids). Return only the JSON object.`;
  }
}

/**
 * The owner's `<inputs>` as tagged blocks of the user turn, stable parts first.
 *
 * Caching (4 of 4 breakpoints): the owner's system prompt is the same for every call (1); the
 * style card and how to use it are the same for every project directed with that card (2); the
 * platform numbers, delivery mode, Creative Bible, asset registry and script are the same for the
 * plan call, every write_shots batch and every repair of a project (3); the saved plan is the same
 * for every batch and repair of one run (4). The mode, range, current shots, requests and closing
 * line change per call and come last.
 */
export function buildDirectorV2Prompt(input: AnyDirectorV2Input): DamiPrompt {
  const card = [
    tag("director_style_card", directorStyleCard(input.director_style_id)),
    DIRECTOR_STYLE_CARD_INSTRUCTION,
  ].join("\n\n");
  const project = [
    tag("platform_config", JSON.stringify(input.platform_config)),
    tag("delivery_mode", input.delivery_mode),
    tag("creative_bible", JSON.stringify(directorBible(input.creative_bible))),
    tag("asset_registry", JSON.stringify(input.asset_registry)),
    tag("script", input.script),
  ].join("\n\n");

  const content: PromptText[] = [
    { text: card, cache: true },
    { text: project, cache: true },
  ];
  if (input.mode === "write_shots" || input.mode === "repair") {
    content.push({ text: tag("plan", JSON.stringify(input.plan)), cache: true });
  }
  const perCall = [tag("mode", input.mode)];
  if (input.mode === "write_shots") perCall.push(tag("scene_range", input.scene_range));
  if (input.mode === "repair") {
    perCall.push(tag("current_shots", JSON.stringify(input.current_shots)));
    perCall.push(tag("repair_requests", JSON.stringify(input.repair_requests)));
  }
  perCall.push(modeInstruction(input));
  content.push({ text: perCall.join("\n\n") });

  return {
    system: [{ text: DIRECTOR_V2_SYSTEM, cache: true }],
    messages: [{ role: "user", content }],
  };
}
