import type { Asset } from "@/server/assets";

export type AssetKindKey = Asset["kind"];

/** Display order and names of asset kinds. */
export const ASSET_KIND_LABELS: readonly { kind: AssetKindKey; plural: string; one: string }[] = [
  { kind: "character", plural: "Characters", one: "character" },
  { kind: "location", plural: "Locations", one: "location" },
  { kind: "prop", plural: "Props", one: "prop" },
  { kind: "voice", plural: "Voices", one: "voice" },
  { kind: "creature", plural: "Creatures", one: "creature" },
  { kind: "costume", plural: "Costumes", one: "costume" },
  { kind: "other", plural: "Other", one: "other asset" },
];

/** "3 characters, 4 locations and 5 props", from counts per kind; empty kinds are left out. */
export function describeAssetCounts(counts: Partial<Record<AssetKindKey, number>>): string {
  const parts = ASSET_KIND_LABELS.flatMap(({ kind, plural, one }) => {
    const n = counts[kind] ?? 0;
    if (n === 0) return [];
    const word = n === 1 ? one : kind === "other" ? "other assets" : plural.toLowerCase();
    return [`${n} ${word}`];
  });
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
