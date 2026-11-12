import { describe, expect, it } from "vitest";
import {
  assetRefSchema,
  assetTag,
  cleanAssetName,
  formatAssetRef,
  isVoiceRef,
  MAX_ASSET_NAME,
  parseAssetRef,
  replaceAssetTag,
  taggedRefs,
  uniqueName,
} from "./asset-ref";

describe("asset names", () => {
  it("cleans names so they fit refs and tags", () => {
    expect(cleanAssetName("  Mara  ")).toBe("Mara");
    expect(cleanAssetName("Mara\n  Lind")).toBe("Mara Lind");
    expect(cleanAssetName("Locket [gold]")).toBe("Locket (gold)");
    expect(cleanAssetName("Dr: Who")).toBe("Dr - Who");
    expect(cleanAssetName("<b>Tom</b>")).toBe("bTom/b");
    expect(cleanAssetName("Tab\there")).toBe("Tab here");
    expect(cleanAssetName("مریم")).toBe("مریم");
    expect(cleanAssetName("[]")).toBe("()");
    expect(cleanAssetName("  ")).toBe("");
    expect(cleanAssetName("x".repeat(300))).toHaveLength(MAX_ASSET_NAME);
  });

  it("makes names unique with Windows-style suffixes, ignoring case", () => {
    expect(uniqueName("Mara", [])).toBe("Mara");
    expect(uniqueName("Mara", ["Jonas"])).toBe("Mara");
    expect(uniqueName("Mara", ["mara"])).toBe("Mara (2)");
    expect(uniqueName("Mara", ["Mara", "Mara (2)"])).toBe("Mara (3)");
    expect(uniqueName("Mara (2)", ["Mara", "Mara (2)"])).toBe("Mara (3)");
    expect(uniqueName("Mara (2)", ["Mara"])).toBe("Mara (2)");
    const long = "y".repeat(MAX_ASSET_NAME);
    const next = uniqueName(long, [long]);
    expect(next).toHaveLength(MAX_ASSET_NAME);
    expect(next.endsWith(" (2)")).toBe(true);
  });
});

describe("asset refs and tags", () => {
  it("formats and parses kind:Name at the first colon", () => {
    expect(formatAssetRef("character", "Mara (2)")).toBe("character:Mara (2)");
    expect(parseAssetRef("character:Mara (2)")).toEqual({ kind: "character", name: "Mara (2)" });
    expect(parseAssetRef("prop:Mara's Locket")).toEqual({ kind: "prop", name: "Mara's Locket" });
    expect(parseAssetRef("location:Café Müller")).toEqual({
      kind: "location",
      name: "Café Müller",
    });
    expect(parseAssetRef("character:مریم")).toEqual({ kind: "character", name: "مریم" });
    expect(parseAssetRef("vehicle:Car")).toBeNull();
    expect(parseAssetRef("character:")).toBeNull();
    expect(parseAssetRef("character: Mara")).toBeNull();
    expect(parseAssetRef("character:Mara: young")).toBeNull();
    expect(parseAssetRef("Mara")).toBeNull();
    expect(assetRefSchema.safeParse("voice:Mara (voice)").success).toBe(true);
    expect(assetRefSchema.safeParse("voice:[x]").success).toBe(false);
  });

  it("knows voices", () => {
    expect(isVoiceRef("voice:Mara (voice)")).toBe(true);
    expect(isVoiceRef("character:voice")).toBe(false);
  });

  it("finds and replaces tags in prompts", () => {
    const prompt =
      "Mara [character:Mara (2)] opens Mara's Locket [prop:Mara's Locket] at Café Müller [location:Café Müller]. مریم [character:مریم] waits. [vehicle:Car] [character:]";
    expect(taggedRefs(prompt)).toEqual([
      "character:Mara (2)",
      "prop:Mara's Locket",
      "location:Café Müller",
      "character:مریم",
    ]);
    expect(assetTag("prop:Lamp")).toBe("[prop:Lamp]");
    expect(replaceAssetTag("A [prop:Lamp] and [prop:Lamp].", "prop:Lamp", "prop:Old Lamp")).toBe(
      "A [prop:Old Lamp] and [prop:Old Lamp].",
    );
    // Global patterns keep no state between calls.
    expect(taggedRefs(prompt)).toHaveLength(4);
  });
});
