/**
 * The Location Sheet Generator's request, assembled as the owner's file says:
 * `SYSTEM = CORE + ORIENTATION + <genre_lens> + <style_lens>` (only the project's own lenses, as
 * the Location Generator does). The user message is the approved images in `approved_images`
 * order (the Hero first), then the owner's `<input>` template filled in.
 */
import type { DamiPrompt, PromptText } from "../framework/define";
import { genreLens, styleLens } from "../location-generator/prompt";
import { LOCATION_ORIENTATION_SYSTEM } from "../location-shared/modules";
import { designerMessage } from "../shared/designer";
import { LOCATION_SHEET_CORE } from "./prompt-text";
import type { LocationSheetParsedInput } from "./schema";

export { LOCATION_SHEET_CORE };

/** The parts of the Location Generator's answer the owner's `locked_spec` names. */
const LOCKED_SPEC_FIELDS = [
  "location_summary",
  "spec_fields",
  "dna",
  "layout",
  "coverage_plan",
  "style_used",
] as const;

export function lockedLocationSpec(spec: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(LOCKED_SPEC_FIELDS.filter((k) => k in spec).map((k) => [k, spec[k]]));
}

export function locationSheetInputJson(input: LocationSheetParsedInput): Record<string, unknown> {
  const { project } = input;
  return {
    project: {
      style: project.style,
      style_descriptor: project.styleDescriptor ?? null,
      genre: project.genre,
      orientation: project.orientation,
      look_line: project.lookLine ?? null,
      era_setting: project.eraSetting ?? null,
    },
    locked_spec: lockedLocationSpec(input.lockedSpec),
    mode: input.mode,
    approved_images: input.approvedImages.map((a, i) => ({ index: i + 1, view_id: a.viewId })),
    only_views: input.onlyViews ?? null,
    exclude_assets: input.excludeAssets,
    user_notes: input.userNotes ?? null,
    previous_output: input.previousOutput ?? null,
    fix_requests: input.fixRequests.map((r) => ({
      code: r.code,
      instruction: r.instruction,
      ...(r.note ? { note: r.note } : {}),
      view_id: r.viewId,
      edit_eligible: r.editEligible,
    })),
  };
}

export function buildLocationSheetPrompt(input: LocationSheetParsedInput): DamiPrompt {
  const genre = genreLens(input.project.genre);
  const style = styleLens(input.project.style);
  const lenses = [
    ...(genre ? [`<genre_lens>\n${genre}\n</genre_lens>`] : []),
    ...(style ? [`<style_lens>\n${style}\n</style_lens>`] : []),
  ];
  const system: PromptText[] = [
    { text: `${LOCATION_SHEET_CORE}\n\n${LOCATION_ORIENTATION_SYSTEM}`, cache: true },
    ...lenses.map((text, i) => (i === lenses.length - 1 ? { text, cache: true } : { text })),
  ];
  return {
    system,
    messages: designerMessage(
      input.approvedImages.map((a) => a.fileId),
      `<input>\n${JSON.stringify(locationSheetInputJson(input), null, 2)}\n</input>`,
    ),
  };
}
