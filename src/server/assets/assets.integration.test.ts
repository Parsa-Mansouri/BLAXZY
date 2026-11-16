/**
 * Applying Asset Detector results, and the detected list's review loop, against the real local
 * Postgres. Skipped when it is unreachable.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import type { AssetDetectorOutput } from "@/server/damis";
import { createFixtures, databaseReachable } from "@/server/test-support/script-fixtures";

const reachable = await databaseReachable();

describe.skipIf(!reachable)("assets service (integration)", async () => {
  const assets = await import("@/server/assets");
  const { closeDb, getDb } = await import("@/server/db/client");
  const { asset, assetDetection, assetLook, damiRun, project, review, scriptVersion } =
    await import("@/server/db/schema");
  const { and, eq } = await import("drizzle-orm");
  const fixtures = createFixtures();

  afterAll(async () => {
    await fixtures.cleanup();
    await closeDb();
  });

  async function versionAndRun(projectId: string, versionNumber: number) {
    const db = getDb();
    const [run] = await db
      .insert(damiRun)
      .values({
        damiKey: "asset-detector",
        damiVersion: "1",
        model: "sample",
        projectId,
        input: {},
      })
      .returning({ id: damiRun.id });
    const [version] = await db
      .insert(scriptVersion)
      .values({ projectId, versionNumber, source: "edited", status: "accepted", content: "x" })
      .returning({ id: scriptVersion.id });
    if (!run || !version) throw new Error("setup failed");
    return { runId: run.id, versionId: version.id };
  }

  type Entry = {
    kind: "character" | "location" | "prop" | "voice_only";
    name: string;
    description?: string;
  };

  /** A detector answer for these entries, with the run's temporary ids for stored assets. */
  async function detect(projectId: string, entries: Entry[], removedNames: string[] = []) {
    const state = await assets.loadDetectorState(projectId);
    const view = assets.detectorView(state.rows, state.latest?.sceneIndex ?? []);
    const counters: Record<string, number> = { char: 50, loc: 50, prop: 50 };
    const idFor = (kind: string, prefix: string, name: string) =>
      view.tempByName.get(`${kind}:${name.trim().toLowerCase()}`) ??
      `${prefix}_${++counters[prefix]!}`;
    const base = {
      aliases: [],
      facts: [],
      asset_priority: "required" as const,
      scene_refs: ["1"],
      first_scene: "1",
      ui_summary: "",
    };
    const characters = entries
      .filter((e) => e.kind === "character" || e.kind === "voice_only")
      .map((e) => ({
        ...base,
        char_id: idFor("character", "char", e.name),
        name: e.name,
        name_latin: e.name,
        kind: e.kind === "voice_only" ? ("voice_only" as const) : ("human" as const),
        role: "lead" as const,
        needs_visual: e.kind !== "voice_only",
        is_minor: "unknown" as const,
        same_person_as: null,
        script_description: e.description ?? `${e.name}, as described.`,
        looks: [],
        signature_prop_ids: [],
        speaks: e.kind === "voice_only",
        dialogue_line_count: 0,
        dialogue_language: e.kind === "voice_only" ? "English" : null,
        voice_delivery: e.kind === "voice_only" ? ["voice_over" as const] : [],
        voice_hints: [],
        relationships: [],
      }));
    const removed = removedNames
      .map((n) => [...view.tempByName].find(([k]) => k.endsWith(`:${n.toLowerCase()}`))?.[1])
      .filter((id): id is string => id !== undefined);
    const output: AssetDetectorOutput = {
      output_version: "output_21",
      mode: "full",
      scene_index: [],
      characters,
      locations: entries
        .filter((e) => e.kind === "location")
        .map((e) => ({
          ...base,
          loc_id: idFor("location", "loc", e.name),
          name: e.name,
          name_latin: e.name,
          location_group: null,
          interior_exterior: "interior" as const,
          time_of_day: "night" as const,
          times_of_day: ["night" as const],
          states: [],
          script_description: e.description ?? `${e.name}, as described.`,
          fixed_elements_from_script: [],
          related_asset_ids: [],
        })),
      props: entries
        .filter((e) => e.kind === "prop")
        .map((e) => ({
          ...base,
          prop_id: idFor("prop", "prop", e.name),
          name: e.name,
          name_latin: e.name,
          category_hint: "hand_prop" as const,
          subtype: null,
          script_description: e.description ?? `${e.name}, as described.`,
          states: [],
          text_on_object: [],
          users: [],
          location_ids: [],
          related_asset_ids: [],
        })),
      diff: { added: [], updated: [], removed },
      summary: {
        scene_count: 0,
        character_count: 0,
        location_count: 0,
        prop_count: 0,
      },
      applied_fixes: [],
      assumptions: [],
      warnings: ["MINOR_PRESENT: char_51"],
    };
    return { output, byTemp: view.byTemp };
  }

  async function apply(
    projectId: string,
    v: { versionId: string; runId: string },
    mode: "full" | "incremental",
    entries: Entry[],
    removedNames: string[] = [],
  ) {
    const { output, byTemp } = await detect(projectId, entries, removedNames);
    return assets.applyDetection({
      projectId,
      scriptVersionId: v.versionId,
      damiRunId: v.runId,
      mode,
      output,
      byTemp,
    });
  }

  it("applies detections: add, keep by known id, remove, keep approved, unique names", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const first = await versionAndRun(projectId, 1);
    expect(await assets.hasDetectionFor(projectId, first.versionId)).toBe(false);

    const r1 = await apply(projectId, first, "full", [
      { kind: "character", name: "Mara" },
      { kind: "character", name: "Jonas" },
      { kind: "character", name: "Mara" },
      { kind: "location", name: "Harbour Pier" },
      { kind: "voice_only", name: "Narrator" },
    ]);
    expect(r1).toMatchObject({ added: 5, kept: 0, removed: 0 });
    expect(await assets.hasDetectionFor(projectId, first.versionId)).toBe(true);
    const chars = await assets.listAssets(projectId, userId, { kind: "character" });
    expect(chars?.items.map((a) => a.name)).toEqual(["Mara", "Jonas", "Mara (2)"]);
    // A voice-only narrator is a character that is heard, never designed: hidden by default.
    const everyone = await assets.listAssets(projectId, userId, {
      kind: "character",
      includeVoiceOnly: true,
    });
    expect(
      everyone?.items.map((a) => [a.name, a.details?.subkind, a.details?.needsVisual]),
    ).toEqual(expect.arrayContaining([["Narrator", "voice_only", false]]));
    expect(await assets.listAssets(projectId, userId, { kind: "voice" })).toMatchObject({
      items: [],
    });
    const counts = await assets.countAssetsByKind(projectId, userId);
    expect(counts?.character).toBe(3);
    expect(counts?.voice).toBe(0);

    // A manual asset; Harbour Pier gets an accepted look (approved: never silently removed).
    await getDb().insert(asset).values({ projectId, kind: "prop", name: "Hat", origin: "manual" });
    const pier = (await assets.listAssets(projectId, userId, { kind: "location" }))?.items[0];
    await getDb()
      .insert(assetLook)
      .values({
        assetId: pier?.id ?? "",
        projectId,
        versionNumber: 1,
        source: "uploaded",
        status: "accepted",
      });
    // The user skips Jonas; a later detection keeps that choice.
    await getDb()
      .update(asset)
      .set({ priority: "skipped" })
      .where(and(eq(asset.projectId, projectId), eq(asset.name, "Jonas")));

    const second = await versionAndRun(projectId, 2);
    const r2 = await apply(
      projectId,
      second,
      "incremental",
      [
        { kind: "character", name: "Mara", description: "Now with a surname." },
        { kind: "character", name: "Jonas" },
        { kind: "prop", name: "Locket: [gold]" },
      ],
      ["Mara (2)", "Harbour Pier"],
    );
    expect(r2).toMatchObject({ added: 1, kept: 2, removed: 1 });

    const all = await assets.listAssets(projectId, userId, { includeRemoved: true });
    const byName = new Map(all?.items.map((a) => [a.name, a]));
    expect(byName.get("Mara")).toMatchObject({
      description: "Now with a surname.",
      status: "active",
      firstScriptVersionId: first.versionId,
      lastScriptVersionId: second.versionId,
    });
    expect(byName.get("Mara (2)")?.status).toBe("removed");
    expect(byName.get("Jonas")).toMatchObject({ status: "active", priority: "skipped" });
    expect(byName.get("Harbour Pier")?.status).toBe("active");
    expect(byName.get("Hat")).toMatchObject({ status: "active", origin: "manual" });
    expect(byName.get("Locket - (gold)")?.status).toBe("active");

    const [detection] = await getDb()
      .select()
      .from(assetDetection)
      .where(eq(assetDetection.scriptVersionId, second.versionId));
    expect(detection?.mode).toBe("incremental");
    expect(detection?.diff.removed).toEqual(["character:Mara (2)", "location:Harbour Pier"]);
    expect(detection?.warnings.some((w) => w.startsWith("APPROVED_CONFLICT: Harbour Pier"))).toBe(
      true,
    );
    // Temporary ids never reach the database.
    expect(JSON.stringify(detection)).not.toMatch(/(char|loc|prop|voice)_\d+/);

    const panel = await assets.getDetectionPanel(projectId, userId);
    expect(panel?.warnings.map((w) => w.tag)).toEqual(["APPROVED_CONFLICT"]);
    expect(panel).not.toHaveProperty("options");

    // A removed asset found again is revived under its name.
    const third = await versionAndRun(projectId, 3);
    await apply(projectId, third, "incremental", [{ kind: "character", name: "mara (2)" }]);
    const revived = await assets.listAssets(projectId, userId, { kind: "character" });
    expect(revived?.items.map((a) => a.name)).toContain("Mara (2)");
  });

  it("leaves legacy voice rows alone: no removal, no duplicate, still listed and counted", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    // Rows written by detector v1: a voice with its owner, and a voice-only narrator's voice.
    await getDb()
      .insert(asset)
      .values([
        { projectId, kind: "voice", name: "Mara", origin: "detected", details: { owner: "Mara" } },
        {
          projectId,
          kind: "voice",
          name: "Narrator",
          origin: "detected",
          details: { owner: "Narrator", subkind: "voice_only" },
        },
      ]);
    const first = await versionAndRun(projectId, 1);
    // A full detection that finds Mara and the narrator (now a hidden character).
    const r1 = await apply(projectId, first, "full", [
      { kind: "character", name: "Mara" },
      { kind: "voice_only", name: "Narrator" },
    ]);
    expect(r1).toMatchObject({ added: 2, kept: 0, removed: 0 });
    // A second full detection that no longer finds anyone removes only the detected characters.
    const second = await versionAndRun(projectId, 2);
    const r2 = await apply(projectId, second, "full", []);
    expect(r2).toMatchObject({ added: 0, removed: 2 });

    const all = await assets.listAssets(projectId, userId, {
      includeRemoved: true,
      includeVoiceOnly: true,
    });
    const voices = all?.items.filter((a) => a.kind === "voice");
    expect(voices?.map((a) => [a.name, a.status]).sort()).toEqual([
      ["Mara", "active"],
      ["Narrator", "active"],
    ]);
    // The legacy voices still show in the category and the counts.
    const listed = await assets.listAssets(projectId, userId, { kind: "voice" });
    expect(listed?.items.map((a) => a.name).sort()).toEqual(["Mara", "Narrator"]);
    expect((await assets.countAssetsByKind(projectId, userId))?.voice).toBe(2);
  });

  it("skips assets without a dami and checks what a correction round needs", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const v = await versionAndRun(projectId, 1);
    // Still at the script stage: the list cannot be corrected yet.
    await expect(
      assets.submitDetectionReview({ projectId, userId, note: "Mara and Marla are one woman." }),
    ).rejects.toThrow(/Accept a script/);
    await getDb().update(project).set({ stage: "pre_production" }).where(eq(project.id, projectId));
    await apply(projectId, v, "full", [
      { kind: "character", name: "Ines" },
      { kind: "prop", name: "Lamp" },
    ]);
    const skipped = await assets.skipDetectedAssets({ projectId, userId, refs: ["prop:Lamp"] });
    expect(skipped).toEqual({ skipped: 1 });
    const lamp = (await assets.listAssets(projectId, userId, { kind: "prop" }))?.items[0];
    expect(lamp?.priority).toBe("skipped");
    // Crafted targets are refused as input, never sent to Postgres as an invalid kind.
    for (const ref of ["Lamp", "bogus:Lamp", "prop:", "prop:Lamp\u0000"]) {
      await expect(
        assets.skipDetectedAssets({ projectId, userId, refs: [ref] }),
      ).rejects.toBeInstanceOf(assets.AssetInputError);
    }
    // Another user's project is "missing".
    const stranger = await fixtures.newUser();
    expect(
      await assets.skipDetectedAssets({ projectId, userId: stranger, refs: ["prop:Lamp"] }),
    ).toBeNull();
    expect(
      await assets.submitDetectionReview({ projectId, userId: stranger, note: "Add the dog." }),
    ).toBeNull();
    // A correction round needs the user's words: an empty or blank note is refused.
    await expect(assets.submitDetectionReview({ projectId, userId })).rejects.toBeInstanceOf(
      assets.AssetInputError,
    );
    await expect(assets.submitDetectionReview({ projectId, userId, note: "   " })).rejects.toThrow(
      /write a note/,
    );
    await expect(
      assets.submitDetectionReview({ projectId, userId, note: "x".repeat(2001) }),
    ).rejects.toThrow(/2,000/);
    // The words are stored as the review's note, with one free-text fix request and no codes.
    expect(
      await assets.submitDetectionReview({ projectId, userId, note: "  The dog is missing. " }),
    ).toEqual({ started: true });
    const [row] = await getDb().select().from(review).where(eq(review.projectId, projectId));
    expect(row).toMatchObject({
      decision: "rejected",
      note: "The dog is missing.",
      issueCodes: [],
      fixRequests: [{ code: "ADP99", type: "preference", customText: "The dog is missing." }],
    });
  });

  it("paginates and hides other users' assets", async () => {
    const userId = await fixtures.newUser();
    const other = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const v = await versionAndRun(projectId, 1);
    await apply(
      projectId,
      v,
      "full",
      ["a", "b", "c", "d", "e"].map((s) => ({ kind: "prop" as const, name: s.toUpperCase() })),
    );
    const page1 = await assets.listAssets(projectId, userId, { limit: 2 });
    const page2 = await assets.listAssets(projectId, userId, {
      limit: 2,
      cursor: page1?.nextCursor,
    });
    const page3 = await assets.listAssets(projectId, userId, {
      limit: 2,
      cursor: page2?.nextCursor,
    });
    expect(
      [...(page1?.items ?? []), ...(page2?.items ?? []), ...(page3?.items ?? [])].map(
        (a) => a.name,
      ),
    ).toEqual(["A", "B", "C", "D", "E"]);
    expect(page3?.nextCursor).toBeNull();
    expect(await assets.listAssets(projectId, other)).toBeNull();
    expect(await assets.countAssetsByKind(projectId, other)).toBeNull();
  });

  it("finds the next asset waiting for the user, in the overview's order", async () => {
    const userId = await fixtures.newUser();
    const other = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    await getDb().update(project).set({ stage: "pre_production" }).where(eq(project.id, projectId));
    const v = await versionAndRun(projectId, 1);
    await apply(projectId, v, "full", [
      { kind: "prop", name: "Lamp" },
      { kind: "character", name: "Ines" },
      { kind: "location", name: "Lamp Room" },
      { kind: "character", name: "Tomas" },
    ]);
    const rows = await getDb()
      .select({ id: asset.id, name: asset.name })
      .from(asset)
      .where(eq(asset.projectId, projectId));
    const id = (name: string) => rows.find((r) => r.name === name)?.id ?? "";
    const next = async (name: string) =>
      (await assets.nextAssetNeedingInput(projectId, userId, id(name)))?.name ?? null;
    expect(await next("Ines")).toBe("Tomas");
    expect(await next("Tomas")).toBe("Lamp Room");
    expect(await next("Lamp Room")).toBe("Lamp");
    expect(await next("Lamp")).toBe("Ines");
    expect(await assets.nextAssetNeedingInput(projectId, other, id("Ines"))).toBeNull();
  });

  it("a removal while the detector runs waits for the project row and is never undone", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    await getDb().update(project).set({ stage: "pre_production" }).where(eq(project.id, projectId));
    const first = await versionAndRun(projectId, 1);
    await apply(projectId, first, "full", [
      { kind: "character", name: "Mara" },
      { kind: "character", name: "Jonas" },
    ]);
    const listed = await assets.listAssets(projectId, userId, { kind: "character" });
    const mara = listed?.items.find((a) => a.name === "Mara");
    if (!mara) throw new Error("setup failed");

    // The detector read the list (Mara active) and ran; it now applies its answer, holding the
    // project row. The user removes Mara meanwhile.
    const second = await versionAndRun(projectId, 2);
    const run = await detect(projectId, [
      { kind: "character", name: "Mara" },
      { kind: "character", name: "Jonas" },
    ]);
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signalHeld: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      signalHeld = resolve;
    });
    const holder = getDb().transaction(async (tx) => {
      await tx
        .select({ id: project.id })
        .from(project)
        .where(eq(project.id, projectId))
        .for("update");
      signalHeld();
      await released;
    });
    await held;
    const removing = assets.removeAsset({ assetId: mara.id, userId });
    const raced = await Promise.race([
      removing.then(() => "finished"),
      new Promise<string>((resolve) => setTimeout(() => resolve("waiting"), 300)),
    ]);
    // The user's removal takes the project row first, as the detection does.
    expect(raced).toBe("waiting");
    const applying = assets.applyDetection({
      projectId,
      scriptVersionId: second.versionId,
      damiRunId: second.runId,
      mode: "full",
      output: run.output,
      byTemp: run.byTemp,
    });
    release();
    await holder;
    expect(await removing).toBe(true);
    await applying;
    const after = await assets.listAssets(projectId, userId, {
      kind: "character",
      includeRemoved: true,
    });
    expect(after?.items.map((a) => [a.name, a.status]).sort()).toEqual([
      ["Jonas", "active"],
      ["Mara", "removed"],
    ]);

    // A later detection finding "mara" by name neither revives her nor adds a "Mara (2)".
    const third = await versionAndRun(projectId, 3);
    await apply(projectId, third, "incremental", [{ kind: "character", name: "mara" }]);
    const later = await assets.listAssets(projectId, userId, {
      kind: "character",
      includeRemoved: true,
    });
    expect(later?.items.map((a) => [a.name, a.status]).sort()).toEqual([
      ["Jonas", "active"],
      ["Mara", "removed"],
    ]);
  });

  it("describes refs ignoring the name's case", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const v = await versionAndRun(projectId, 1);
    await apply(projectId, v, "full", [{ kind: "character", name: "Jonas" }]);
    const found = await assets.describeAssetRefs(projectId, ["character:jonas", "prop:Jonas"]);
    expect(found.get("character:jonas")).toMatchObject({ name: "Jonas", ref: "character:Jonas" });
    expect(found.get("character:Jonas")?.name).toBe("Jonas");
    expect(found.has("prop:Jonas")).toBe(false);
  });
});
