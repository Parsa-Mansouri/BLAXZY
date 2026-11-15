import type { DamiPrompt } from "../framework/define";
import { PLATFORM_CONFIG } from "../shared/platform";
import { CREATIVE_DNA_SYSTEM } from "./prompt-text";
import { CREATIVE_REGISTRY, getCreativeModule } from "./registry";
import type { CreativeDnaInput } from "./schema";

/**
 * The owner's user-turn layout (`buildUserTurn`): shared core, genre module, style module, the
 * project's settings, the platform numbers and the closing line, as tagged blocks.
 *
 * Caching: the system prompt is identical for every project (breakpoint 1); the shared core and
 * the two modules repeat for every project with the same genre and style (breakpoint 2); the
 * settings and platform block that follow are per project.
 */
export function buildCreativeDnaPrompt(input: CreativeDnaInput): DamiPrompt {
  const { genre_id, style_id, ...settings } = input;
  const genre = getCreativeModule(genre_id);
  const style = getCreativeModule(style_id);
  const stable = [
    `<shared_core>\n${CREATIVE_REGISTRY.shared_core_en}\n</shared_core>`,
    `<genre_module>\n${JSON.stringify(genre)}\n</genre_module>`,
    `<style_module>\n${JSON.stringify(style)}\n</style_module>`,
  ].join("\n\n");
  const perProject = [
    `<project_settings>\n${JSON.stringify(settings)}\n</project_settings>`,
    `<platform_config>\n${JSON.stringify(PLATFORM_CONFIG)}\n</platform_config>`,
    "Compile output_10 now. Return only the JSON object.",
  ].join("\n\n");
  return {
    system: [{ text: CREATIVE_DNA_SYSTEM, cache: true }],
    messages: [{ role: "user", content: [{ text: stable, cache: true }, { text: perProject }] }],
  };
}
