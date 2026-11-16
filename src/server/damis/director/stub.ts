import { ownerGenreName, ownerStyleName } from "@/lib/style-options";
import type { ProjectStyle } from "@/server/db/schema";
import type { CreativeBible } from "../creative-dna/schema";
import { PLATFORM_CONFIG } from "../shared/platform";

/**
 * The Creative Bible the Director receives when the project has none (a typed "Other" genre or
 * style has no module, or the compile failed). The owner's prompt reads `creative_bible` for its
 * frame, contracts, rules, guards and preflight, and its code-side validator reads the same
 * fields, so the stub keeps the whole shape and says so honestly instead of changing the prompt:
 *
 * - `selection` is `genre.other` / `style.other` (no module);
 * - `project_frame` comes from the project style (orientation, format, runtime) and the platform's
 *   default block length; what the style does not know (language, dialogue policy) stays null;
 * - the genre and style contracts carry the user's own words (genre, visual style, look line,
 *   descriptor, art direction) so the Director still sees the look the user asked for;
 * - every slice, the guards, locks and QC items are empty (there is nothing to apply), and
 *   `validation_status` is `ok_with_assumptions` with one assumption that explains why.
 */
export function stubCreativeBible(style: ProjectStyle): CreativeBible {
  const emptyRules = { rules: [] };
  const own = [
    `The visual style is "${ownerStyleName(style.visualStyle)}", chosen by the user.`,
    style.styleDescriptor ? `Style descriptor: ${style.styleDescriptor}` : null,
    style.lookLine ? `Look: ${style.lookLine}` : null,
    style.eraSetting ? `Era and setting: ${style.eraSetting}` : null,
    style.artDirectionNotes ? `Art direction notes: ${style.artDirectionNotes}` : null,
  ].filter((line): line is string => line !== null);
  const noOption = { technical: [], preference: [] };
  return {
    dami: "creative_dna",
    dami_version: "none",
    registry_version: "none",
    selection: { genre_id: "genre.other", style_id: "style.other" },
    project_frame: {
      format: style.format === "series" ? "series" : "film",
      episode_count: null,
      episode_duration_sec: style.episodeDurationSeconds ?? null,
      total_duration_sec: style.totalDurationSeconds,
      orientation: style.orientation,
      audience: style.audienceRating ?? null,
      script_language: null,
      ui_language: "en",
      dialogue_policy: null,
      block_length_sec: PLATFORM_CONFIG.default_block_length_sec,
      blocks_per_episode: null,
      max_spoken_words_per_block: null,
    },
    contracts: {
      genre_contract: `The genre is "${ownerGenreName(style.genre)}", described by the user. There is no rule module for it: take its tone from the script.`,
      style_contract: own.join(" "),
      combination_logic:
        "No Creative Bible was compiled for this project, so no genre or style rules are merged here. The script's own tone and the user's words above decide the look.",
    },
    slices: {
      for_script_writer: { rules: [], beat_guidance: [], series_rules: [] },
      for_script_checker: emptyRules,
      for_asset_detector: { rules: [], attributes_to_capture: [] },
      for_asset_generation: { rules: [], guided_question_focus: [] },
      for_sheet_generator: { rules: [], locks_to_capture: [] },
      for_director: emptyRules,
      for_text_blocks_video: emptyRules,
    },
    continuity_locks: [],
    anti_cliche_guards: [],
    qc_checklist: [],
    review_options: {
      script: noOption,
      asset: noOption,
      sheet: noOption,
      text_block: noOption,
      video: noOption,
    },
    conflicts: [],
    open_questions: [],
    assumptions: [
      "There is no Creative Bible for this project (its genre or visual style was typed by the user, or the bible could not be compiled). Direct from the script, the project style and the platform numbers; no genre or style rules, locks or guards apply.",
    ],
    validation_status: "ok_with_assumptions",
  };
}
