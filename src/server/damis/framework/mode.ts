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
