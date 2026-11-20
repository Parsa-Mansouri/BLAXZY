/**
 * The platform numbers of the owner's split pipeline (DIRECTOR v2.0 → CINEMATOGRAPHER v1.0 →
 * BREAKDOWN → PROMPTER v1.0): `PLATFORM_CONFIG` plus what the new stages read (`unit_min_s`,
 * shot budgets, prompt word ranges, the repair loop). The numbers are the owner's, from
 * `breakdown/source/breakdown.spec.md` section 2 and the Prompter's `<inputs>`. Each dami gets
 * them as `<platform_config>`; a change changes their prompts, so bump their versions with it.
 */
import { z } from "zod";
import { PLATFORM_CONFIG } from "./platform";

/** How the user chose to generate the film (Stage 1): fixed blocks, auto blocks or shot by shot. */
export const DELIVERY_MODES = ["block_15", "block_30", "block_auto", "shot"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export const PIPELINE_PLATFORM_CONFIG = {
  block_length_options_sec: [...PLATFORM_CONFIG.block_length_options_sec],
  speech_rate_wps: { ...PLATFORM_CONFIG.speech_rate_wps },
  max_events_per_block: { ...PLATFORM_CONFIG.max_events_per_block },
  unit_min_s: 4,
  unit_max_s: 30,
  shot_budget: {
    standard: { "15": 3, "30": 5 },
    rapid_cut: { "15": 5, "30": 10 },
  },
  runtime_tolerance_pct: 10,
  max_repair_rounds: 2,
  prompt_words: { shot: [90, 220], block_15: [170, 320], block_30: [230, 380] },
} as const;

const wordRange = z.tuple([z.number().int().positive(), z.number().int().positive()]);
const perLength = z.object({
  "15": z.number().int().positive(),
  "30": z.number().int().positive(),
});

/** `<platform_config>` of the v2 damis (and BREAKDOWN's `platform`). Authoritative. */
export const pipelinePlatformConfigSchema = z.object({
  block_length_options_sec: z.array(z.number().int().positive()).min(1),
  speech_rate_wps: z.record(z.string(), z.number().positive()),
  max_events_per_block: perLength,
  unit_min_s: z.number().int().positive(),
  unit_max_s: z.number().int().positive(),
  shot_budget: z.object({ standard: perLength, rapid_cut: perLength }),
  runtime_tolerance_pct: z.number().positive(),
  max_repair_rounds: z.number().int().min(0),
  prompt_words: z.object({ shot: wordRange, block_15: wordRange, block_30: wordRange }),
});
export type PipelinePlatformConfig = z.output<typeof pipelinePlatformConfigSchema>;

/** A mutable copy of `PIPELINE_PLATFORM_CONFIG` (the schema's default). */
export function defaultPipelinePlatformConfig(): PipelinePlatformConfig {
  const c = PIPELINE_PLATFORM_CONFIG;
  return {
    block_length_options_sec: [...c.block_length_options_sec],
    speech_rate_wps: { ...c.speech_rate_wps },
    max_events_per_block: { ...c.max_events_per_block },
    unit_min_s: c.unit_min_s,
    unit_max_s: c.unit_max_s,
    shot_budget: {
      standard: { ...c.shot_budget.standard },
      rapid_cut: { ...c.shot_budget.rapid_cut },
    },
    runtime_tolerance_pct: c.runtime_tolerance_pct,
    max_repair_rounds: c.max_repair_rounds,
    prompt_words: {
      shot: [...c.prompt_words.shot],
      block_15: [...c.prompt_words.block_15],
      block_30: [...c.prompt_words.block_30],
    },
  };
}

/** Words per second for a language under a given config ("en", "fa-IR"...; `default` otherwise). */
export function wpsFor(
  config: Pick<PipelinePlatformConfig, "speech_rate_wps">,
  language: string | null | undefined,
): number {
  const key = (language ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return (
    config.speech_rate_wps[key] ??
    config.speech_rate_wps.default ??
    PLATFORM_CONFIG.speech_rate_wps.default
  );
}

/** The longest a shot may be in a delivery mode (DIRECTOR v2.0 `<delivery_mode_rules>`). */
export function maxShotSeconds(mode: DeliveryMode): number {
  return mode === "block_15" ? 15 : 30;
}

/** The prompt word range of a unit (`prompt_words` by unit type, blocks by length). */
export function promptWordRange(
  config: Pick<PipelinePlatformConfig, "prompt_words">,
  unit: { unit_type: "block" | "shot"; duration_s: number },
): readonly [number, number] {
  if (unit.unit_type === "shot") return config.prompt_words.shot;
  return unit.duration_s > 15 ? config.prompt_words.block_30 : config.prompt_words.block_15;
}
