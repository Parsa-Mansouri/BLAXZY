/**
 * The Location Generator's request, assembled as the owner's file says:
 * `SYSTEM = CORE + ORIENTATION + <genre_lens> + <style_lens>`, only the project's genre and style
 * lens (none for a genre or style the user typed themselves). The user message is the reference
 * images in index order, then the owner's `<input>` template filled in.
 */
import type { DamiPrompt, PromptText } from "../framework/define";
import {
  LOCATION_GENRE_LENSES,
  LOCATION_ORIENTATION_SYSTEM,
  LOCATION_STYLE_LENSES,
} from "../location-shared/modules";
import { withCreativeDna } from "../shared/creative-dna-input";
import { designerMessage, ownerFixRequests, type DesignerScript } from "../shared/designer";
import { LOCATION_GENERATOR_CORE } from "./prompt-text";
import type { LocationGeneratorParsedInput } from "./schema";

export { LOCATION_GENERATOR_CORE };

export type LocationGenre = keyof typeof LOCATION_GENRE_LENSES;
export type LocationStyle = keyof typeof LOCATION_STYLE_LENSES;

export function genreLens(genre: string): string | null {
  return genre in LOCATION_GENRE_LENSES ? LOCATION_GENRE_LENSES[genre as LocationGenre] : null;
}

export function styleLens(style: string): string | null {
  return style in LOCATION_STYLE_LENSES ? LOCATION_STYLE_LENSES[style as LocationStyle] : null;
}

/** The owner's `script_context`: only the scenes where the location appears, plus the logline. */
export function ownerScriptContext(script: DesignerScript | undefined) {
  return {
    logline: script?.logline ?? "",
    scenes: (script?.scenes ?? []).map((s) => ({
      scene_number: s.sceneNumber,
      heading: s.heading,
      action: s.action,
      dialogue_excerpt: s.dialogueExcerpt,
      characters_present: s.charactersPresent,
    })),
  };
}

export function locationInputJson(input: LocationGeneratorParsedInput): Record<string, unknown> {
  const { project, location } = input;
  return {
    project: {
      style: project.style,
      style_descriptor: project.styleDescriptor ?? null,
      genre: project.genre,
      format: project.format,
      era_setting: project.eraSetting ?? null,
      orientation: project.orientation,
      look_line: project.lookLine ?? null,
      art_direction_notes: project.artDirectionNotes ?? null,
    },
    location: {
      asset_id: location.name,
      name: location.name,
      interior_exterior: location.interiorExterior ?? null,
      time_of_day: location.timeOfDay ?? null,
      script_description: location.scriptDescription,
      scene_refs: location.sceneRefs,
    },
    script_context: ownerScriptContext(input.scriptContext),
    user_prompt: input.userPrompt ?? null,
    guided_answers: input.guidedAnswers ?? null,
    reference_images: input.referenceImages.map((r, i) => ({ index: i + 1, role: r.role })),
    reference_instructions: {
      preserve: input.referenceImages.flatMap((r, i) =>
        r.note ? [`Image ${i + 1}: ${r.note}`] : [],
      ),
      change: [],
    },
    output_mode: input.outputMode,
    style_override: input.styleOverride ?? null,
    exclude_assets: input.excludeAssets,
    user_notes: input.userNotes ?? null,
    previous_output: input.previousOutput ?? null,
    fix_requests: ownerFixRequests(input.fixRequests).map((r) => ({
      code: r.code,
      instruction: r.instruction,
      ...(r.custom_text ? { note: r.custom_text } : {}),
    })),
  };
}

export function buildLocationGeneratorPrompt(input: LocationGeneratorParsedInput): DamiPrompt {
  const genre = genreLens(input.project.genre);
  const style = styleLens(input.project.style);
  const lenses = [
    ...(genre ? [`<genre_lens>\n${genre}\n</genre_lens>`] : []),
    ...(style ? [`<style_lens>\n${style}\n</style_lens>`] : []),
  ];
  // Cached: the stable core with the orientation system, then the lenses as a second prefix.
  const system: PromptText[] = [
    { text: `${LOCATION_GENERATOR_CORE}\n\n${LOCATION_ORIENTATION_SYSTEM}`, cache: true },
    ...lenses.map((text, i) => (i === lenses.length - 1 ? { text, cache: true } : { text })),
  ];
  return {
    system: withCreativeDna(system, input.creativeDna),
    messages: designerMessage(
      input.referenceImages.map((r) => r.fileId),
      `<input>\n${JSON.stringify(locationInputJson(input), null, 2)}\n</input>`,
    ),
  };
}
