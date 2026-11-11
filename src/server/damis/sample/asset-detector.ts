/**
 * Sample asset-detector: characters from character cues, locations from scene headings, props
 * from a small lexicon, each with the scenes it appears in. Known assets keep their slugs.
 */
import type { AssetKind } from "@/server/db/schema";
import {
  assetDetectorInputSchema,
  type AssetDetectorOutput,
  type DetectedAsset,
} from "../asset-detector/schema";
import { isSceneHeading, splitLines } from "../shared/script-lines";
import {
  cueName,
  headingPlace,
  headingTime,
  isInterior,
  parseScenes,
  slugify,
  titleCase,
  truncate,
  type ParsedScene,
} from "./util";

/** Props the sample writer uses, plus common ones. Matched as whole words, case-insensitive. */
const PROP_LEXICON = [
  "brass locket",
  "locket",
  "folded letter",
  "letter",
  "old radio",
  "radio",
  "paper map",
  "map",
  "silver key",
  "key",
  "lantern",
  "photograph",
  "compass",
  "notebook",
  "umbrella",
  "suitcase",
  "phone",
  "camera",
  "ring",
  "bottle",
  "ferry",
  "bicycle",
  "candle",
  "knife",
];

const MAX_PROPS = 4;

function normalizeName(name: string): string {
  return name.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sceneOfLine(scenes: ParsedScene[], line: number): ParsedScene | undefined {
  return scenes.find((s) => line >= s.startLine && line <= s.endLine);
}

export function sampleAssetDetector(raw: unknown): AssetDetectorOutput {
  const input = assetDetectorInputSchema.parse(raw);
  const lines = splitLines(input.content);
  const scenes = parseScenes(input.content);
  const known = new Map(
    (input.knownAssets ?? []).map((k) => [`${k.kind}|${normalizeName(k.name)}`, k.slug]),
  );
  const used = new Set<string>();
  const counters = new Map<AssetKind, number>();

  /** The known slug for this name, else a fresh unique one. */
  const slugFor = (kind: AssetKind, name: string): string => {
    const knownSlug = known.get(`${kind}|${normalizeName(name)}`);
    let slug = knownSlug ?? slugify(name);
    if (!slug) {
      const n = (counters.get(kind) ?? 0) + 1;
      counters.set(kind, n);
      slug = `${kind}-${n}`;
    }
    let candidate = slug;
    for (let i = 2; used.has(`${kind}:${candidate}`); i++) candidate = `${slug}-${i}`.slice(0, 48);
    used.add(`${kind}:${candidate}`);
    return candidate;
  };

  const assets: DetectedAsset[] = [];

  // Characters: every distinct cue, with the scenes where it speaks or is named.
  const cues = new Map<string, Set<string>>();
  lines.forEach((_, i) => {
    const cue = cueName(lines, i);
    if (!cue) return;
    const scene = sceneOfLine(scenes, i + 1);
    if (!scene) return;
    const set = cues.get(cue) ?? new Set<string>();
    set.add(scene.heading);
    cues.set(cue, set);
  });
  for (const [cue, appears] of cues) {
    const name = /[A-Z]/.test(cue) ? titleCase(cue) : cue;
    const intro = lines.find(
      (l) => l.includes(cue) && l.trim() !== cue && l.trim().length > cue.length + 3,
    );
    assets.push({
      kind: "character",
      name,
      slug: slugFor("character", name),
      description: intro
        ? truncate(`As introduced: ${intro.trim()}`, 600)
        : `${name}: a speaking character; the script gives no physical description yet.`,
      appearsIn: [...appears],
    });
  }

  // Locations: one per distinct place in the scene headings.
  const places = new Map<string, ParsedScene[]>();
  for (const scene of scenes.filter((s) => s.real)) {
    const place = headingPlace(scene.heading) || scene.heading;
    places.set(place, [...(places.get(place) ?? []), scene]);
  }
  for (const [place, inScenes] of places) {
    const name = truncate(/[A-Z]/.test(place) ? titleCase(place) : place, 200);
    const first = inScenes[0] as ParsedScene;
    const times = [...new Set(inScenes.map((s) => headingTime(s.heading)).filter(Boolean))];
    const firstAction = lines
      .slice(first.startLine, first.endLine)
      .map((l) => l.trim())
      .find((l) => l.length > 0);
    assets.push({
      kind: "location",
      name,
      slug: slugFor("location", name),
      description: truncate(
        `${isInterior(first.heading) ? "Interior" : "Exterior"}${times.length ? `, seen at ${times.join(", ")}` : ""}.${firstAction ? ` ${firstAction}` : ""}`,
        600,
      ),
      appearsIn: inScenes.map((s) => s.heading),
    });
  }

  // Props: lexicon words found in the script (longest phrase first, so "brass locket" wins).
  const props: DetectedAsset[] = [];
  const claimed: string[] = [];
  for (const word of PROP_LEXICON) {
    if (props.length >= MAX_PROPS) break;
    if (claimed.some((c) => c.includes(word))) continue;
    const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, "i");
    // Scene headings name places, not props ("FERRY CABIN" is not a ferry).
    const body = (s: ParsedScene) =>
      lines
        .slice(s.startLine - 1, s.endLine)
        .filter((l) => !isSceneHeading(l))
        .join("\n");
    const appears = scenes.filter((s) => pattern.test(body(s)));
    if (appears.length === 0) continue;
    claimed.push(word);
    const name = word.charAt(0).toUpperCase() + word.slice(1);
    const mention = lines.find((l) => !isSceneHeading(l) && pattern.test(l));
    props.push({
      kind: "prop",
      name,
      slug: slugFor("prop", name),
      description: truncate(mention ? `${name}; first seen: ${mention.trim()}` : name, 600),
      appearsIn: appears.map((s) => s.heading),
    });
  }
  assets.push(...props);

  return { assets };
}
