import { defineDami } from "../framework/define";
import { CLAUDE_MODELS } from "../framework/models";
import { containsQuote } from "../shared/quotes";
import { buildAssetDetectorPrompt } from "./prompt";
import { assetDetectorInputSchema, assetDetectorOutputSchema } from "./schema";

const EPISODE_PREFIX = /^E\d+\s*·\s*/;
const POSITIONAL_SCENE = /^Scene \d+$/;

function normalizeName(name: string): string {
  return name.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
}

export const assetDetector = defineDami({
  key: "asset-detector",
  version: "1.0.0",
  description:
    "Lists every character, location, prop, creature, costume and voice in a script, merging aliases and keeping slugs stable across re-detections.",
  input: assetDetectorInputSchema,
  output: assetDetectorOutputSchema,
  // Sonnet: this is careful extraction and entity resolution, not creative writing. Sonnet 5.5
  // handles alias merging and fact extraction reliably at half Opus's price, and the
  // semantic checks below (unique slugs, stable known slugs, real headings) catch slips.
  model: CLAUDE_MODELS.sonnet,
  effort: "medium",
  maxOutputTokens: 32_000,
  build: buildAssetDetectorPrompt,
  check(output, input) {
    const issues: string[] = [];
    const seen = new Set<string>();
    const knownByName = new Map(
      (input.knownAssets ?? []).map((k) => [`${k.kind}|${normalizeName(k.name)}`, k]),
    );
    output.assets.forEach((asset, i) => {
      const key = `${asset.kind}:${asset.slug}`;
      if (seen.has(key)) issues.push(`assets.${i}: duplicate ${key}; merge entries for one entity`);
      seen.add(key);
      const known = knownByName.get(`${asset.kind}|${normalizeName(asset.name)}`);
      if (known && known.slug !== asset.slug) {
        issues.push(
          `assets.${i}: "${asset.name}" is the known asset ${known.kind}:${known.slug}; reuse slug "${known.slug}"`,
        );
      }
      asset.appearsIn.forEach((scene, j) => {
        const heading = scene.replace(EPISODE_PREFIX, "");
        if (!POSITIONAL_SCENE.test(heading) && !containsQuote(input.content, heading)) {
          issues.push(
            `assets.${i}.appearsIn.${j}: "${scene}" is not a scene heading of the script; copy headings exactly`,
          );
        }
      });
    });
    return issues;
  },
});
