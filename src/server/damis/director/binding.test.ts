import { describe, expect, it } from "vitest";
import { checkBlockPrompt, tokenSequence, type BlockAsset } from "../shared/block";
import { formatAssetRef } from "../shared/asset-ref";
import {
  bindAssetTokens,
  bindingMap,
  buildAssetIds,
  idPrefixForKind,
  type AssetBinding,
} from "./binding";
import outputJson from "./fixtures/model-output.json";

const map = new Map<string, AssetBinding>([
  ["char_1", { kind: "character", name: "Nora" }],
  ["char_2", { kind: "character", name: "Mara (2)" }],
  ["loc_1", { kind: "location", name: "Kitchen" }],
  ["prop_1", { kind: "prop", name: "Blue Kettle" }],
]);

describe("bindAssetTokens", () => {
  it("replaces @ids with Name <<<image_N>>> in order of first appearance", () => {
    const result = bindAssetTokens(
      "Props: @prop_1 — a kettle. Locations: @loc_1 — a room. Cast: @char_1.",
      map,
    );
    expect(result.prompt).toBe(
      "Props: Blue Kettle <<<image_1>>> — a kettle. Locations: Kitchen <<<image_2>>> — a room. Cast: Nora <<<image_3>>>.",
    );
    expect(result.assetRefs).toEqual(["prop:Blue Kettle", "location:Kitchen", "character:Nora"]);
    expect(result.unmapped).toEqual([]);
  });

  it("merges the Director's NAME after the id and keeps one number per asset", () => {
    const result = bindAssetTokens(
      "@char_1 NORA — tall. Later @char_1 waves; @char_2 MARA (2) nods.",
      map,
    );
    expect(result.prompt).toBe(
      "Nora <<<image_1>>> — tall. Later Nora <<<image_1>>> waves; Mara (2) <<<image_2>>> nods.",
    );
    expect(result.assetRefs).toEqual(["character:Nora", "character:Mara (2)"]);
  });

  it("does not merge a longer word that only starts with the name", () => {
    expect(bindAssetTokens("@char_1 NORAH walks", map).prompt).toBe(
      "Nora <<<image_1>>> NORAH walks",
    );
  });

  it("leaves unknown ids as written and reports them once", () => {
    const result = bindAssetTokens("@new_char_1 and @char_9 and @char_9", map);
    expect(result.prompt).toBe("@new_char_1 and @char_9 and @char_9");
    expect(result.unmapped).toEqual(["new_char_1", "char_9"]);
    expect(result.assetRefs).toEqual([]);
  });

  it("an asset without a sheet, and anything past 9 references, becomes a plain name", () => {
    const entries = buildAssetIds([
      { kind: "location", name: "Kitchen" },
      { kind: "character", name: "Nora" },
    ]);
    const plain = bindAssetTokens(
      "@loc_1 and @char_1",
      bindingMap(entries, { withoutReference: new Set(["location:Kitchen"]) }),
    );
    expect(plain.prompt).toBe("Kitchen and Nora <<<image_1>>>");
    expect(plain.assetRefs).toEqual(["character:Nora"]);

    const many = new Map<string, AssetBinding>();
    for (let i = 1; i <= 11; i++) many.set(`prop_${i}`, { kind: "prop", name: `Thing ${i}` });
    const text = Array.from({ length: 11 }, (_, i) => `@prop_${i + 1}`).join(" ");
    const result = bindAssetTokens(text, many);
    expect(result.assetRefs).toHaveLength(9);
    expect(result.prompt.endsWith("Thing 10 Thing 11")).toBe(true);
  });

  it("never binds a voice", () => {
    const voice = new Map<string, AssetBinding>([
      ["char_1", { kind: "voice", name: "Nora voice" }],
    ]);
    expect(bindAssetTokens("@char_1 speaks", voice).prompt).toBe("@char_1 speaks");
  });

  it("the result for a Director prompt passes the production prompt check", () => {
    const entries = buildAssetIds([
      { kind: "character", name: "Nora" },
      { kind: "character", name: "Lina" },
      { kind: "character", name: "Sam" },
      { kind: "location", name: "Kitchen" },
      { kind: "location", name: "Front Step" },
      { kind: "prop", name: "Blue Kettle" },
    ]);
    const block = outputJson.blocks[0];
    if (!block) throw new Error("fixture");
    const bound = bindAssetTokens(block.prompt_text, bindingMap(entries));
    expect(bound.unmapped).toEqual([]);
    expect(bound.prompt).not.toMatch(/@(char|loc|prop)_/);
    const assets: BlockAsset[] = entries.map((e) => ({
      ref: formatAssetRef(e.kind, e.name),
      kind: e.kind,
      name: e.name,
      description: "",
    }));
    expect(checkBlockPrompt(bound.prompt, bound.assetRefs, assets)).toEqual([]);
    expect(tokenSequence(bound.prompt)).toEqual(bound.assetRefs.map((_, i) => i + 1));
  });
});

describe("buildAssetIds", () => {
  it("numbers per prefix by first appearance; creatures share char_; voices and others get none", () => {
    const entries = buildAssetIds([
      { kind: "location", name: "Kitchen" },
      { kind: "character", name: "Nora" },
      { kind: "voice", name: "Nora voice" },
      { kind: "creature", name: "Fox" },
      { kind: "prop", name: "Kettle" },
      { kind: "character", name: "Nora" },
      { kind: "costume", name: "Coat" },
      { kind: "other", name: "Thing" },
      { kind: "location", name: "Step" },
    ]);
    expect(entries.map((e) => [e.id, e.ref])).toEqual([
      ["loc_1", "location:Kitchen"],
      ["char_1", "character:Nora"],
      ["char_2", "creature:Fox"],
      ["prop_1", "prop:Kettle"],
      ["loc_2", "location:Step"],
    ]);
  });

  it("is stable and knows its prefixes", () => {
    const assets = [
      { kind: "character" as const, name: "A" },
      { kind: "prop" as const, name: "B" },
    ];
    expect(buildAssetIds(assets)).toEqual(buildAssetIds(assets));
    expect(idPrefixForKind("voice")).toBeNull();
    expect(idPrefixForKind("creature")).toBe("char");
  });
});
