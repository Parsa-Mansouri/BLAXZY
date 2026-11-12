import { describe, expect, it } from "vitest";
import { assetDetectorOutputSchema, type AssetDetectorOutput } from "@/server/damis";
import { sampleAssetDetector } from "@/server/damis/sample/asset-detector";
import type { asset } from "@/server/db/schema";
import { detectorView, planDetection, tempIdsFor, visibleWarnings } from "./detection";

type Asset = typeof asset.$inferSelect;

const script = [
  "INT. FERRY CABIN - NIGHT",
  "",
  "MARA (60s), a grey braid, holds a brass locket.",
  "",
  "MARA",
  "You kept it.",
  "",
  "JONAS",
  "I kept everything.",
  "",
  "EXT. HARBOUR PIER - DAWN",
  "",
  "Mara walks to the end of the pier with the lantern.",
  "",
  "INT. FERRY CABIN - DAY",
  "",
  "Mara sits alone in the cabin.",
].join("\n");

const input = {
  mode: "full" as const,
  project: {
    format: "movie" as const,
    genre: "Drama",
    style: "Realistic",
    era_setting: null,
    ui_language: "en",
    sector: "wizard" as const,
  },
  script: { title: "Ferry", logline: "", source: "uploaded" as const, raw_text: script },
};

let n = 0;
function row(plan: ReturnType<typeof planDetection>["assets"][number]): Asset {
  return {
    id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    projectId: "p",
    kind: plan.kind,
    name: plan.name,
    description: plan.description,
    status: "active",
    origin: "detected",
    displayOrder: n,
    priority: plan.priority,
    details: plan.details,
    firstScriptVersionId: null,
    lastScriptVersionId: null,
    damiRunId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("the detector boundary", () => {
  const output: AssetDetectorOutput = sampleAssetDetector(input);
  const plan = planDetection({ output, byTemp: new Map(), existing: [] });

  it("turns detector ids into names, everywhere", () => {
    expect(plan.assets.map((a) => `${a.kind}:${a.name}`)).toEqual(
      expect.arrayContaining([
        "character:Mara",
        "location:Ferry Cabin",
        "prop:brass locket",
        "voice:Mara",
      ]),
    );
    expect(plan.sceneIndex[0]?.characters).toContain("Mara");
    // What gets stored: the scene index, the diff, every asset's details and the warnings.
    const stored = {
      sceneIndex: plan.sceneIndex,
      diff: plan.diff,
      details: plan.assets.map((a) => a.details),
      warnings: plan.warnings,
    };
    // Not even inside look and state ids the detector built from its own ids (`loc_1_night`).
    expect(JSON.stringify(stored)).not.toMatch(/(char|loc|prop|voice)_\d+/);
    const stateIds = plan.assets.flatMap((a) => a.details.states ?? []).map((st) => st.id);
    expect(stateIds.length).toBeGreaterThan(0);
    expect(stateIds.every((id) => !/(char|loc|prop|voice)_\d/.test(id))).toBe(true);
  });

  it("rebuilds stored assets as a valid previous_output with fresh temporary ids", () => {
    const rows = plan.assets.map(row);
    const view = detectorView(
      rows.map((a) => ({ asset: a, status: "detected" as const })),
      plan.sceneIndex,
    );
    expect(assetDetectorOutputSchema.safeParse(view.previousOutput).success).toBe(true);
    expect(view.known.length).toBe(rows.length);
    expect(view.previousOutput.scene_index[0]?.characters_present.length).toBeGreaterThan(0);
    const mara = tempIdsFor(["character:mara"], view.tempByName);
    expect(mara).toHaveLength(1);
    // Applying the rebuilt output keeps every stored name.
    const again = planDetection({
      output: view.previousOutput,
      byTemp: view.byTemp,
      existing: rows,
    });
    expect(again.assets.every((a) => a.existing !== null)).toBe(true);
  });

  it("leaves out assets added by hand with no scenes, so a fix round still passes its checks", () => {
    const rows = plan.assets.map(row);
    const manual: Asset = {
      ...row({ ...plan.assets[0]!, name: "Mara (2)", details: {} }),
      kind: "character",
      origin: "manual",
    };
    const view = detectorView(
      [...rows, manual].map((a) => ({ asset: a, status: "detected" as const })),
      plan.sceneIndex,
    );
    expect(view.known.length).toBe(rows.length);
    expect([...view.byTemp.values()]).not.toContain(manual);
    const entries = [
      ...view.previousOutput.characters,
      ...view.previousOutput.locations,
      ...view.previousOutput.props,
      ...view.previousOutput.voices,
    ];
    expect(entries.every((e) => e.scene_refs.length > 0)).toBe(true);
  });

  it("hides MINOR_PRESENT from the user", () => {
    expect(visibleWarnings(["MINOR_PRESENT: Leyla", "MERGE_CHECK: A and B"])).toEqual([
      "MERGE_CHECK: A and B",
    ]);
  });
});
