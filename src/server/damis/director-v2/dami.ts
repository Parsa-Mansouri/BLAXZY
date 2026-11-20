import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { buildDirectorV2Prompt } from "./prompt";
import {
  directorV2InputSchema,
  directorV2OutputSchema,
  directorV2PlanInputSchema,
  directorV2PlanOutputSchema,
  directorV2RepairInputSchema,
  directorV2RepairOutputSchema,
  directorV2ShotsInputSchema,
  directorV2ShotsOutputSchema,
} from "./schema";
import {
  checkDirectorV2,
  checkDirectorV2Plan,
  checkDirectorV2Repair,
  checkDirectorV2Shots,
} from "./validate";

/** Ours; the owner's file is DIRECTOR v2.0 (`DIRECTOR_V2_OWNER_VERSION`). */
export const DIRECTOR_V2_VERSION = "1.0.0";
export const DIRECTOR_V2_OWNER_VERSION = "2.0";

/**
 * A shot with its staging ids, states, dialogue, duration range and reasons is ~350 to 600 tokens
 * of JSON; a 3 to 5 minute film runs 40 to 80 shots, plus the plan (analysis, notes, bible, scene
 * plan, staging states, ~5k). Thinking at medium effort counts against the limit. 32k streams.
 * Long scripts run `plan` and then `write_shots` in scene batches (the owner's advice).
 */
export const DIRECTOR_V2_MAX_OUTPUT_TOKENS = 32_000;

const shared = {
  version: DIRECTOR_V2_VERSION,
  // The owner names claude-opus-5-5 for every mode.
  model: CLAUDE_MODELS.opus,
  effort: "medium" as const,
  maxOutputTokens: DIRECTOR_V2_MAX_OUTPUT_TOKENS,
  build: buildDirectorV2Prompt,
};

/**
 * DIRECTOR v2.0, mode `full`: the approved script directed into a timed shot list
 * (output_22_dir) with a Director Style Card as input. Every mode is its own key because
 * structured output needs one closed schema per answer shape; they share the prompt.
 */
export const directorV2 = defineDami({
  ...shared,
  key: "director-v2",
  description: `DIRECTOR (owner v${DIRECTOR_V2_OWNER_VERSION}, output_22_dir), mode full: directs the approved script into an ordered, timed shot list with staging states, duration ranges, break quality and self-contained boundary states, in the chosen director's style.`,
  input: directorV2InputSchema,
  output: directorV2OutputSchema,
  check: checkDirectorV2,
});

/** Mode `plan`: analysis, notes, continuity bible, scene plan and the scenes' outer staging. */
export const directorV2Plan = defineDami({
  ...shared,
  key: "director-v2-plan",
  description: `DIRECTOR (owner v${DIRECTOR_V2_OWNER_VERSION}), mode plan: the plan pass for long scripts (no shots); write_shots then directs scene batches.`,
  input: directorV2PlanInputSchema,
  output: directorV2PlanOutputSchema,
  check: checkDirectorV2Plan,
});

/** Mode `write_shots`: the shots of a scene range, on the saved plan. */
export const directorV2Shots = defineDami({
  ...shared,
  key: "director-v2-shots",
  description: `DIRECTOR (owner v${DIRECTOR_V2_OWNER_VERSION}), mode write_shots: the shots of one scene range of a saved plan.`,
  input: directorV2ShotsInputSchema,
  output: directorV2ShotsOutputSchema,
  check: checkDirectorV2Shots,
});

/** Mode `repair`: answers BREAKDOWN's timing requests with replacement shots per scene. */
export const directorV2Repair = defineDami({
  ...shared,
  key: "director-v2-repair",
  description: `DIRECTOR (owner v${DIRECTOR_V2_OWNER_VERSION}), mode repair: replacement shots for the scenes BREAKDOWN could not fit into units.`,
  input: directorV2RepairInputSchema,
  output: directorV2RepairOutputSchema,
  // Small answers (a few scenes).
  maxOutputTokens: 16_000,
  check: checkDirectorV2Repair,
});
