import { getEnv } from "@/server/env";

/** `live` calls Claude; `sample` answers with generated sample output (no key, no cost). */
export type DamiMode = "live" | "sample";

/** The model name stored on `dami_run` rows produced in sample mode. */
export const SAMPLE_MODEL = "sample";

export function resolveDamiMode(
  setting: "auto" | "live" | "sample",
  apiKey: string | undefined,
): DamiMode {
  if (setting === "auto") return apiKey ? "live" : "sample";
  return setting;
}

/** The mode of this process, from `DAMI_MODE` (default `auto`) and `ANTHROPIC_API_KEY`. */
export function getDamiMode(): DamiMode {
  const env = getEnv();
  return resolveDamiMode(env.DAMI_MODE, env.ANTHROPIC_API_KEY);
}

let sampleWarned = false;

/**
 * One loud structured warning per process when sample output is produced in production (a deploy
 * that forgot `DAMI_MODE` / `ANTHROPIC_API_KEY`). Called by the runner when it actually answers in
 * sample mode. Never throws: sample is the intended default during the testing phase.
 */
export function warnSampleModeInProduction(): void {
  if (sampleWarned || process.env.NODE_ENV !== "production") return;
  sampleWarned = true;
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "sample_mode_in_production",
      component: "damis",
      message:
        "Damis are answering with SAMPLE output in a production process: no real Claude calls are made. Set DAMI_MODE=live and ANTHROPIC_API_KEY to use Claude.",
    }),
  );
}

/** Test hook: forget that the warning was logged. */
export function resetSampleModeWarning(): void {
  sampleWarned = false;
}
