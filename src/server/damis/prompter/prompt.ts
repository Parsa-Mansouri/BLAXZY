import type { DamiPrompt } from "../framework/define";
import { QC_STAGE } from "../shared/creative-context";
import type { CreativeBible } from "../creative-dna/schema";
import { PROMPTER_SYSTEM } from "./prompt-text";
import type { PrompterInput } from "./schema";

const tag = (name: string, value: string) => `<${name}>\n${value}\n</${name}>`;

/** `<creative_bible>` as the Prompter's `<inputs>` lists it (plus the selection, for the header). */
export function prompterBible(bible: CreativeBible) {
  const stages = QC_STAGE.text_blocks_video;
  return {
    selection: bible.selection,
    project_frame: bible.project_frame,
    slices: { for_text_blocks_video: bible.slices.for_text_blocks_video },
    anti_cliche_guards: bible.anti_cliche_guards,
    qc_checklist: bible.qc_checklist.filter((q) => stages.includes(q.stage)),
  };
}

/** The shot ids of a batch of units, in order. */
export function unitShotIds(input: Pick<PrompterInput, "units">): Set<string> {
  return new Set(input.units.flatMap((u) => u.shots.map((s) => s.shot_id)));
}

/**
 * The owner's `<inputs>`, stable parts first. `<director>` and `<cinematographer>` are split:
 * their project-wide parts (cached) and the shots of this batch's units (per call).
 *
 * Caching (3 of 4 breakpoints): the owner's system prompt (1); platform numbers, Creative Bible
 * and asset registry, the same for every batch of a project (2); the director's project, notes,
 * continuity bible and staging states with the look bible, the same for every batch of a run (3).
 * No style card: every decision PROMPTER writes is already made, and no name ever reaches it.
 */
export function buildPrompterPrompt(input: PrompterInput): DamiPrompt {
  const ids = unitShotIds(input);
  const { shots: directorShots, ...director } = input.director;
  const { shots: dpShots, look_bible } = input.cinematographer;
  const project = [
    tag("platform_config", JSON.stringify(input.platform_config)),
    tag("creative_bible", JSON.stringify(prompterBible(input.creative_bible))),
    tag("asset_registry", JSON.stringify(input.asset_registry)),
  ].join("\n\n");
  const run = [
    tag("director", JSON.stringify(director)),
    tag("cinematographer", JSON.stringify({ look_bible })),
  ].join("\n\n");
  const batch = [
    tag("director_shots", JSON.stringify(directorShots.filter((s) => ids.has(s.shot_id)))),
    tag("cinematographer_shots", JSON.stringify(dpShots.filter((s) => ids.has(s.shot_id)))),
    tag("units", JSON.stringify(input.units)),
    "<director_shots> and <cinematographer_shots> are the shots of <director> and <cinematographer> that these units use. Write every unit of <units> now. Return only the JSON object.",
  ].join("\n\n");
  return {
    system: [{ text: PROMPTER_SYSTEM, cache: true }],
    messages: [
      {
        role: "user",
        content: [{ text: project, cache: true }, { text: run, cache: true }, { text: batch }],
      },
    ],
  };
}
