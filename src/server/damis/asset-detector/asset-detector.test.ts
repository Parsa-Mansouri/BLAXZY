import { describe, expect, it } from "vitest";
import { runDami } from "../framework/runner";
import { FakeClaudeClient, jsonResponse, testDeps } from "../test-utils";
import { assetDetector } from "./dami";
import inputJson from "./fixtures/input.json";
import outputJson from "./fixtures/model-output.json";
import { assetDetectorInputSchema, assetDetectorOutputSchema } from "./schema";

const input = assetDetectorInputSchema.parse(inputJson);
const output = assetDetectorOutputSchema.parse(outputJson);

describe("asset-detector", () => {
  it("fixture output parses and passes the semantic checks", () => {
    expect(assetDetector.check(output, input)).toEqual([]);
  });

  it("runs end to end on Sonnet with a fake client", async () => {
    const client = new FakeClaudeClient([jsonResponse(outputJson, { model: "claude-sonnet-5-5" })]);
    const result = await runDami(assetDetector, input, {}, testDeps(client).deps);
    expect(result.output).toEqual(output);
    expect(client.requests[0]?.model).toBe("claude-sonnet-5-5");
  });

  it("rejects duplicate slugs within a kind but allows the same slug across kinds", () => {
    const [mara] = output.assets;
    if (!mara) throw new Error("fixture needs assets");
    expect(assetDetector.check({ assets: [mara, { ...mara, name: "Mara again" }] }, input)).toEqual(
      ["assets.1: duplicate character:mara; merge entries for one entity"],
    );
    expect(assetDetector.check({ assets: [mara, { ...mara, kind: "voice" }] }, input)).toEqual([]);
  });

  it("keeps known slugs stable on re-detection", () => {
    const withKnown = assetDetectorInputSchema.parse({
      ...inputJson,
      knownAssets: [{ kind: "character", name: "Mara", slug: "mara-old" }],
    });
    expect(assetDetector.check(output, withKnown)).toEqual([
      'assets.0: "Mara" is the known asset character:mara-old; reuse slug "mara-old"',
    ]);
    expect(assetDetector.build(withKnown).messages[0]?.content[0]?.text).toContain(
      '- character:mara-old "Mara"',
    );
  });

  it("requires appearsIn to name real scene headings", () => {
    const [mara] = output.assets;
    if (!mara) throw new Error("fixture needs assets");
    const bad = {
      ...mara,
      appearsIn: ["INT. SPACESHIP - NIGHT", "Scene 2", "E1 · EXT. HARBOUR PIER - DUSK"],
    };
    expect(assetDetector.check({ assets: [bad] }, input)).toHaveLength(1);
  });

  it("rejects malformed slugs and unknown kinds at the schema level", () => {
    const [mara] = output.assets;
    expect(
      assetDetectorOutputSchema.safeParse({ assets: [{ ...mara, slug: "Mara Lee" }] }).success,
    ).toBe(false);
    expect(
      assetDetectorOutputSchema.safeParse({ assets: [{ ...mara, kind: "vehicle" }] }).success,
    ).toBe(false);
  });
});
