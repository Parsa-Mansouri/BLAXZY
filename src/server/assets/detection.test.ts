import { describe, expect, it } from "vitest";
import { assetDetectorOutputSchema, type AssetDetectorOutput } from "@/server/damis";
import { sampleAssetDetector } from "@/server/damis/sample/asset-detector";
import type { asset } from "@/server/db/schema";
import {
  detectorView,
  markRemovedByUser,
  planDetection,
  removedByUser,
  tempIdsFor,
  visibleWarnings,
} from "./detection";

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
      expect.arrayContaining(["character:Mara", "location:Ferry Cabin", "prop:brass locket"]),
    );
    // Voices are not assets any more.
    expect(plan.assets.some((a) => (a.kind as string) === "voice")).toBe(false);
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
    ];
    expect(entries.every((e) => e.scene_refs.length > 0)).toBe(true);
  });

  it("never revives an asset the user removed; one the detector removed comes back", () => {
    const rows = plan.assets.map(row);
    const mara = rows.find((a) => a.kind === "character" && a.name === "Mara");
    const cabin = rows.find((a) => a.kind === "location" && a.name === "Ferry Cabin");
    if (!mara || !cabin) throw new Error("sample changed");
    const view = detectorView(
      rows.map((a) => ({ asset: a, status: "detected" as const })),
      plan.sceneIndex,
    );
    // The user removed Mara while the detector ran (the temporary id still points at her), and
    // the detector itself removed the cabin earlier.
    const removedMara: Asset = {
      ...mara,
      status: "removed",
      details: markRemovedByUser(mara.details),
    };
    const removedCabin: Asset = { ...cabin, status: "removed" };
    const existing = rows.map((a) =>
      a.id === mara.id ? removedMara : a.id === cabin.id ? removedCabin : a,
    );
    const byTemp = new Map(
      [...view.byTemp].map(([temp, a]) => [temp, existing.find((e) => e.id === a.id) ?? a]),
    );
    const again = planDetection({ output: view.previousOutput, byTemp, existing });
    const names = again.assets.map((a) => `${a.kind}:${a.name}`);
    expect(names).not.toContain("character:Mara");
    expect(names.some((n) => n.startsWith("character:Mara ("))).toBe(false);
    expect(again.assets.find((a) => a.existing?.id === cabin.id)).toBeDefined();
    expect(removedByUser(removedMara)).toBe(true);
    expect(removedByUser(removedCabin)).toBe(false);

    // A fresh run finding her by name (no temporary id) drops her too.
    const fresh = planDetection({ output, byTemp: new Map(), existing });
    expect(fresh.assets.some((a) => a.kind === "character" && /^mara/i.test(a.name))).toBe(false);
    expect(fresh.assets.find((a) => a.existing?.id === cabin.id)?.name).toBe("Ferry Cabin");
  });

  it("stores speakers and heard-only characters by name, and the voice facts on the character", () => {
    const mara = plan.assets.find((a) => a.kind === "character" && a.name === "Mara");
    expect(mara?.details.speaks).toBe(true);
    expect(mara?.details.dialogueLanguage).toBe("English");
    expect(mara?.details.voiceDelivery).toContain("on_screen");
    expect(plan.sceneIndex.some((s) => s.speakers?.includes("Mara"))).toBe(true);
    expect(plan.sceneIndex.every((s) => s.voices === undefined)).toBe(true);
    expect(plan.sceneIndex.every((s) => Array.isArray(s.heardOnly))).toBe(true);
  });

  it("keeps a voice-only narrator as a hidden character, never as a voice asset", () => {
    const withNarrator = structuredClone(output);
    const base = withNarrator.characters[0];
    if (!base) throw new Error("sample changed");
    withNarrator.characters.push({
      ...base,
      char_id: "char_9",
      name: "Narrator",
      name_latin: "Narrator",
      aliases: [],
      kind: "voice_only",
      needs_visual: false,
      facts: [],
      looks: [],
      voice_hints: [
        { field: "age", value: "old", status: "implied", scene: "1", evidence: "an old voice" },
      ],
      scene_refs: ["1"],
      first_scene: "1",
    });
    const first = withNarrator.scene_index[0];
    if (!first) throw new Error("sample changed");
    first.heard_only.push("char_9");
    first.speakers.push("char_9");
    const narrated = planDetection({ output: withNarrator, byTemp: new Map(), existing: [] });
    const narrator = narrated.assets.find((a) => a.name === "Narrator");
    expect(narrator?.kind).toBe("character");
    expect(narrator?.details).toMatchObject({
      subkind: "voice_only",
      needsVisual: false,
      speaks: true,
    });
    expect(narrator?.details.voiceHints?.[0]?.value).toBe("old");
    expect(narrated.sceneIndex[0]?.heardOnly).toEqual(["Narrator"]);
    expect(narrated.sceneIndex[0]?.speakers).toContain("Narrator");
    expect(narrated.assets.some((a) => (a.kind as string) === "voice")).toBe(false);

    // Fed back (incremental and fix mode), the narrator is a voice_only character again.
    const rows = narrated.assets.map(row);
    const view = detectorView(
      rows.map((a) => ({ asset: a, status: "detected" as const })),
      narrated.sceneIndex,
    );
    expect(assetDetectorOutputSchema.safeParse(view.previousOutput).success).toBe(true);
    expect(view.previousOutput).not.toHaveProperty("voices");
    const back = view.previousOutput.characters.find((c) => c.name === "Narrator");
    expect(back).toMatchObject({ kind: "voice_only", needs_visual: false, speaks: true });
    expect(view.previousOutput.scene_index[0]?.heard_only).toContain(back?.char_id);
  });

  it("leaves legacy voice rows alone: not shown to the detector, not matched, not removed", () => {
    const rows = plan.assets.map(row);
    const legacy: Asset = {
      ...row({ ...plan.assets[0]!, name: "Mara", details: { owner: "Mara", language: "English" } }),
      kind: "voice",
    };
    const view = detectorView(
      [...rows, legacy].map((a) => ({ asset: a, status: "detected" as const })),
      plan.sceneIndex,
    );
    expect(view.known.length).toBe(rows.length);
    expect([...view.byTemp.values()]).not.toContain(legacy);
    expect(view.previousOutput).not.toHaveProperty("voices");
    const again = planDetection({
      output: view.previousOutput,
      byTemp: view.byTemp,
      existing: [...rows, legacy],
    });
    expect(again.assets.every((a) => a.existing !== null && a.existing.id !== legacy.id)).toBe(
      true,
    );
    expect(again.removed).toEqual([]);
  });

  it("reads a scene index stored before v2 (voices, no heardOnly or speakers)", () => {
    const rows = plan.assets.map(row);
    const old = plan.sceneIndex.map((s) => ({
      ...s,
      heardOnly: undefined,
      speakers: undefined,
      voices: ["Mara"],
    }));
    const view = detectorView(
      rows.map((a) => ({ asset: a, status: "detected" as const })),
      old,
    );
    expect(assetDetectorOutputSchema.safeParse(view.previousOutput).success).toBe(true);
    const maraId = tempIdsFor(["character:mara"], view.tempByName)[0];
    expect(view.previousOutput.scene_index[0]?.heard_only).toEqual([maraId]);
    expect(view.previousOutput.scene_index[0]?.speakers).toEqual([]);
  });

  it("hides MINOR_PRESENT from the user", () => {
    expect(visibleWarnings(["MINOR_PRESENT: Leyla", "MERGE_CHECK: A and B"])).toEqual([
      "MERGE_CHECK: A and B",
    ]);
  });
});
