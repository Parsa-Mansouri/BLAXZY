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

  it("rejects duplicate names within a kind (ignoring case) but allows them across kinds", () => {
    const [mara] = output.assets;
    if (!mara) throw new Error("fixture needs assets");
    expect(assetDetector.check({ assets: [mara, { ...mara, name: "MARA" }] }, input)).toEqual([
      'assets.1: duplicate character "MARA"; merge entries for one entity or tell them apart by name',
    ]);
    expect(assetDetector.check({ assets: [mara, { ...mara, kind: "voice" }] }, input)).toEqual([]);
  });

  it("keeps known names stable on re-detection", () => {
    const withKnown = assetDetectorInputSchema.parse({
      ...inputJson,
      knownAssets: [{ kind: "character", name: "mara" }],
    });
    expect(assetDetector.check(output, withKnown)).toEqual([
      'assets.0: "Mara" is the known asset character "mara"; reuse its exact name',
    ]);
    const first = assetDetector.build(withKnown).messages[0]?.content[0];
    expect(first && "text" in first ? first.text : "").toContain('- character "mara"');
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

  it("rejects empty names and unknown kinds at the schema level", () => {
    const [mara] = output.assets;
    expect(assetDetectorOutputSchema.safeParse({ assets: [{ ...mara, name: " " }] }).success).toBe(
      false,
    );
    expect(
      assetDetectorOutputSchema.safeParse({ assets: [{ ...mara, kind: "vehicle" }] }).success,
    ).toBe(false);
  });
});
