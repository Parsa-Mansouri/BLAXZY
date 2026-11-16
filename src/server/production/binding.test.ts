import { describe, expect, it } from "vitest";
import { prepareBlockPrompt } from "./binding";

const ready = new Map([
  ["location:Lighthouse", "Lighthouse"],
  ["character:Tomas", "Tomas"],
  ["prop:Lamp", "Lamp"],
]);

describe("prepareBlockPrompt", () => {
  const prompt =
    "Lighthouse [location:Lighthouse] at night. Tomas [character:Tomas] lifts the Lamp [prop:Lamp]. Tomas [character:Tomas] smiles.";

  it("numbers tokens by first appearance and repeats a number for the same asset", () => {
    const out = prepareBlockPrompt({ prompt, productionAssetRefs: null }, ready);
    expect(out.prompt).toBe(
      "Lighthouse <<<image_1>>> at night. Tomas <<<image_2>>> lifts the Lamp <<<image_3>>>. Tomas <<<image_2>>> smiles.",
    );
    expect(out.assetRefs).toEqual(["location:Lighthouse", "character:Tomas", "prop:Lamp"]);
    expect(out.notes).toEqual([]);
  });

  it("names an asset that is not ready in words only, with a note", () => {
    const out = prepareBlockPrompt(
      { prompt, productionAssetRefs: null },
      new Map([["character:Tomas", "Tomas"]]),
    );
    expect(out.prompt).toBe(
      "Lighthouse at night. Tomas <<<image_1>>> lifts the Lamp. Tomas <<<image_1>>> smiles.",
    );
    expect(out.assetRefs).toEqual(["character:Tomas"]);
    expect(out.notes).toHaveLength(2);
  });

  it("follows the user's choice of references and adds one the prompt does not tag", () => {
    const out = prepareBlockPrompt(
      { prompt, productionAssetRefs: ["character:Tomas", "prop:Lamp"] },
      ready,
    );
    expect(out.assetRefs).toEqual(["character:Tomas", "prop:Lamp"]);
    expect(out.prompt).toContain("Tomas <<<image_1>>>");
    expect(out.prompt).not.toContain("[location:Lighthouse]");
    const added = prepareBlockPrompt(
      {
        prompt: "Tomas [character:Tomas] waits.",
        productionAssetRefs: ["character:Tomas", "location:Lighthouse"],
      },
      ready,
    );
    expect(added.assetRefs).toEqual(["character:Tomas", "location:Lighthouse"]);
    expect(added.prompt).toContain("ALSO IN THIS SHOT: Lighthouse <<<image_2>>>");
  });

  it("caps the references at what a clip can attach and notes the rest", () => {
    const many = Array.from({ length: 12 }, (_, i) => `prop:P${i}`);
    const names = new Map(many.map((r) => [r, r.slice(5)] as const));
    const out = prepareBlockPrompt(
      { prompt: many.map((r) => `${r.slice(5)} [${r}]`).join(" "), productionAssetRefs: null },
      names,
    );
    expect(out.assetRefs.length).toBeLessThanOrEqual(9);
    expect(out.notes.length).toBe(12 - out.assetRefs.length);
  });
});
