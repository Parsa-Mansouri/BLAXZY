/**
 * The platform numbers the Creative DNA dami treats as authoritative (the owner's PLATFORM_CONFIG):
 * block lengths, speech rates and how many events fit in a block. Tune `speech_rate_wps` from real
 * TTS timing. A change here changes the prompt, so bump the dami's version with it.
 */
export const PLATFORM_CONFIG = {
  block_length_options_sec: [15, 30],
  default_block_length_sec: 15,
  speech_rate_wps: { en: 2.5, fa: 2.0, tr: 2.0, default: 2.2 },
  max_events_per_block: { "15": 2, "30": 4 },
} as const;

/** Words per second for a language code ("en", "fa", ...); the default rate for any other. */
export function speechRateWps(language: string | null | undefined): number {
  const rates: Readonly<Record<string, number>> = PLATFORM_CONFIG.speech_rate_wps;
  const key = (language ?? "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return rates[key] ?? PLATFORM_CONFIG.speech_rate_wps.default;
}
