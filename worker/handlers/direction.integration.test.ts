/**
 * The craft pipeline against the local Postgres, in sample mode (every sample dami answers at once
 * and passes its own `check()`): `script.direct` (film-director, cinematographer look), the
 * `direction.scene` batches (scene looks; the last one runs the Breakdown) and the
 * `direction.write` batches (the v1.4 writer; the last one stores the blocks), idempotent batch
 * completion, the stub bible of a project without one, 30 second blocks, a re-direction after a
 * script edit keeping lineages, a failed run retried, and the shot-by-shot style refused. Handlers
 * run directly; follow-up jobs go to a throwaway queue schema.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import type { ProjectStyle } from "../../src/server/db/schema";
import {
  createFixtures,
  databaseReachable,
  dropSchema,
  jobContext,
  pointQueueAtThrowawaySchema,
  TEST_STYLE,
} from "../../src/server/test-support/script-fixtures";

const jobSchema = pointQueueAtThrowawaySchema();
const reachable = await databaseReachable();

describe.skipIf(!reachable)("director pipeline (integration, sample mode)", async () => {
  const blocks = await import("../../src/server/blocks");
  const damis = await import("../../src/server/damis");
  const directions = await import("../../src/server/direction");
  const projects = await import("../../src/server/projects");
  const { closeJobQueue } = await import("../../src/server/jobs");
  const { closeDb, getDb } = await import("../../src/server/db/client");
  const s = await import("../../src/server/db/schema");
  const { and, asc, eq, sql } = await import("drizzle-orm");
  const { scriptDetectAssetsHandler } = await import("./script-detect-assets");
  const { scriptDirectHandler } = await import("./script-direct");
  const { directionSceneHandler } = await import("./direction-scene");
  const { directionWriteHandler } = await import("./direction-write");
  const bibleFixture = (
    await import("../../src/server/damis/creative-dna/fixtures/model-output.json")
  ).default;
  const fixtures = createFixtures();

  afterAll(async () => {
    await fixtures.cleanup();
    await closeJobQueue();
    await dropSchema(jobSchema);
    await closeDb();
  });

  function scriptText(scenes: number, extra = ""): string {
    const text = Array.from({ length: scenes }, (_, i) =>
      [
        `INT. ROOM ${i + 1} - NIGHT`,
        "",
        `TOMAS stands by the window of room ${i + 1}, holding a brass key.`,
        "",
        "TOMAS",
        `Room ${i + 1} is quiet tonight.`,
        "",
        "MARA",
        "(softly)",
        `Then stay a little longer, ${i + 1}.`,
        "",
      ].join("\n"),
    ).join("\n");
    return extra ? `${text}\n${extra}` : text;
  }

  type BibleMode = "none" | "ready" | "ready30" | "rejected";

  /** A registry style: saving it requests a Creative Bible. TEST_STYLE has no module, so no bible. */
  const REGISTRY_STYLE: ProjectStyle = {
    visualStyle: "noir",
    genre: "drama",
    format: "movie",
    orientation: "landscape",
    totalDurationSeconds: 90,
  };

  /** A project with an accepted script and its assets detected; the bible as the mode says. */
  async function setup(options: { scenes: number; style?: ProjectStyle; bible?: BibleMode }) {
    const userId = await fixtures.newUser();
    const mode = options.bible ?? "none";
    const style = options.style ?? (mode === "none" ? TEST_STYLE : REGISTRY_STYLE);
    const projectId = await fixtures.newProject(userId, style);
    const pending = await projects.getLatestBible(projectId);
    if (mode === "none") {
      // A typed "Other" style has no module: no bible row at all.
      expect(pending).toBeNull();
    } else if (pending) {
      const parsed = damis.creativeBibleSchema.parse(bibleFixture);
      const bible = {
        ...parsed,
        project_frame: {
          ...parsed.project_frame,
          block_length_sec: mode === "ready30" ? 30 : 15,
          total_duration_sec: style.totalDurationSeconds,
          episode_duration_sec: style.totalDurationSeconds,
        },
        ...(mode === "rejected" ? { validation_status: "rejected" as const } : {}),
      };
      await projects.completeCreativeBible({ bibleId: pending.id, bible, damiRunId: null });
    }
    const versionId = await addVersion(projectId, 1, scriptText(options.scenes));
    // Accepting the script marks the stage running (the review service does it).
    await blocks.setSectioningState({
      projectId,
      state: "running",
      scriptVersionId: versionId,
      failure: null,
    });
    await scriptDetectAssetsHandler.run({ scriptVersionId: versionId }, jobContext());
    return { userId, projectId, versionId, bibleId: pending?.id ?? "" };
  }

  async function addVersion(projectId: string, versionNumber: number, content: string) {
    const [row] = await getDb()
      .insert(s.scriptVersion)
      .values({ projectId, versionNumber, source: "edited", status: "accepted", content })
      .returning({ id: s.scriptVersion.id });
    if (!row) throw new Error("version insert failed");
    return row.id;
  }

  const direct = (versionId: string, extra: { resection?: boolean } = {}) =>
    scriptDirectHandler.run({ scriptVersionId: versionId, ...extra }, jobContext());

  async function runs(projectId: string, key: string) {
    return getDb()
      .select({ id: s.damiRun.id })
      .from(s.damiRun)
      .where(and(eq(s.damiRun.projectId, projectId), eq(s.damiRun.damiKey, key)));
  }

  async function currentBlocks(projectId: string, userId: string) {
    return (await blocks.listBlocks(projectId, userId, { limit: 200 }))?.items ?? [];
  }

  async function queued(name: string, directionId: string): Promise<number[]> {
    const result = await getDb().execute<{ index: string }>(
      sql.raw(
        `select data->>'batchIndex' as index from ${jobSchema}.job where name = '${name}' ` +
          `and data->>'directionId' = '${directionId}' order by data->>'batchIndex'`,
      ),
    );
    return result.rows.map((r) => Number(r.index));
  }

  const lightScene = (directionId: string, batchIndex: number) =>
    directionSceneHandler.run({ directionId, batchIndex }, jobContext());
  const write = (directionId: string, batchIndex: number) =>
    directionWriteHandler.run({ directionId, batchIndex }, jobContext());

  /** Runs every queued scene batch, then every write batch, of the version's latest run. */
  async function finish(projectId: string, versionId: string) {
    const row = await directions.getLatestDirection(projectId, versionId);
    if (!row) return null;
    for (const b of await directions.listBatches(row.id, "scene")) {
      await lightScene(row.id, b.batchIndex);
    }
    for (const b of await directions.listBatches(row.id, "write")) {
      await write(row.id, b.batchIndex);
    }
    return directions.getLatestDirection(projectId, versionId);
  }

  const directAll = async (projectId: string, versionId: string) => {
    await direct(versionId);
    return finish(projectId, versionId);
  };

  it("a short script: film-director, look, scene batch, Breakdown and writer; blocks keep output_22", async () => {
    const { userId, projectId, versionId } = await setup({ scenes: 3 });
    await direct(versionId);
    expect(await runs(projectId, "film-director")).toHaveLength(1);
    expect(await runs(projectId, "cinematographer")).toHaveLength(1);
    expect(await runs(projectId, "director")).toHaveLength(0);
    const lighting = await directions.getLatestDirection(projectId, versionId);
    expect(lighting).toMatchObject({ mode: "craft", status: "lighting" });
    expect(lighting?.craft).toEqual({ directorId: "nolan", cinematographerId: "deakins" });
    expect(directions.directionContextSchema.parse(lighting?.context).craft).toEqual(
      lighting?.craft,
    );
    expect((lighting?.shotPlan as { shots: unknown[] }).shots.length).toBeGreaterThan(0);
    const sceneBatches = await directions.listBatches(lighting?.id ?? "", "scene");
    expect(sceneBatches.length).toBeGreaterThan(0);
    expect(await queued("direction.scene", lighting?.id ?? "")).toEqual(
      sceneBatches.map((b) => b.batchIndex),
    );

    const row = await finish(projectId, versionId);
    expect(row).toMatchObject({ mode: "craft", status: "ready", failure: null });
    expect(row?.creativeBibleId).toBeNull();
    expect(row?.header).toMatchObject({ dami: "director", status: expect.any(String) });
    const visual = directions.directionVisualSchema.parse(row?.visual);
    expect(visual.scenes.length).toBe(3);
    const breakdown = directions.storedBreakdownSchema.parse(row?.breakdown);
    expect(breakdown.blocks.length).toBe((row?.plan as { blocks: unknown[] }).blocks.length);
    expect(await runs(projectId, "cinematographer")).toHaveLength(1 + 3);
    expect(await runs(projectId, "director")).toHaveLength(row?.batchCount ?? -1);

    const items = await currentBlocks(projectId, userId);
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(items.map((b) => b.orderIndex)).toEqual(items.map((_, i) => i));
    for (const b of items) {
      expect(b.durationSeconds).toBe(15);
      expect(b.damiRunId).not.toBeNull();
      expect(b.scriptVersionId).toBe(versionId);
      const direction = b.direction as { prompt_text: string; shots: unknown[] } | null;
      expect(direction?.prompt_text.length).toBeGreaterThan(100);
      expect(direction?.shots.length).toBeGreaterThan(0);
      // The Director's @ids became [kind:Name] tags (Production binds them to tokens).
      expect(b.prompt).not.toMatch(/@(char|loc|prop)_\d/);
      expect(b.scriptExcerpt.length).toBeGreaterThan(0);
    }
    expect(items.some((b) => b.assetRefs.includes("character:Tomas"))).toBe(true);
    expect(items.some((b) => b.prompt.includes("[character:Tomas]"))).toBe(true);
    expect(items.every((b) => b.assetRefs.every((r) => !r.startsWith("voice:")))).toBe(true);

    const status = await blocks.getSectioningStatus(projectId, userId);
    expect(status).toMatchObject({ state: "done", blockCount: items.length });

    // A repeated job finds the blocks and calls nothing.
    await direct(versionId);
    expect(await runs(projectId, "film-director")).toHaveLength(1);
  });

  it("a project without a bible sends the stub: no rules, ok_with_assumptions", async () => {
    const { projectId, versionId } = await setup({ scenes: 2 });
    const row = await directAll(projectId, versionId);
    expect(row?.status).toBe("ready");
    const context = directions.directionContextSchema.parse(row?.context);
    expect(context.creative_bible).toMatchObject({
      selection: { genre_id: "genre.other", style_id: "style.other" },
      validation_status: "ok_with_assumptions",
      continuity_locks: [],
      anti_cliche_guards: [],
    });
    expect(context.creative_bible.assumptions[0]).toContain("no Creative Bible");
    expect(context.block_mode).toBe("auto");
    const [dami] = await getDb()
      .select({ input: s.damiRun.input })
      .from(s.damiRun)
      .where(and(eq(s.damiRun.projectId, projectId), eq(s.damiRun.damiKey, "film-director")));
    expect(dami?.input).toMatchObject({ director_id: "nolan", block_mode: "auto" });
    const [writer] = await getDb()
      .select({ input: s.damiRun.input })
      .from(s.damiRun)
      .where(and(eq(s.damiRun.projectId, projectId), eq(s.damiRun.damiKey, "director")));
    expect(writer?.input).toMatchObject({ mode: "write_blocks", block_mode: "auto" });
    expect((writer?.input as { shot_plan?: unknown[] }).shot_plan?.length).toBeGreaterThan(0);
  });

  it("a ready bible with 30 s blocks: fixed_30, blocks of 30 s, its row on the direction", async () => {
    const { userId, projectId, versionId, bibleId } = await setup({
      scenes: 3,
      bible: "ready30",
    });
    const row = await directAll(projectId, versionId);
    expect(row).toMatchObject({ status: "ready", blockMode: "fixed_30", creativeBibleId: bibleId });
    const items = await currentBlocks(projectId, userId);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((b) => b.durationSeconds === 30)).toBe(true);
  });

  it("a long script: scene batches then write batches; the last of each moves on, repeats change nothing", async () => {
    const { userId, projectId, versionId } = await setup({
      scenes: 24,
      style: { ...TEST_STYLE, totalDurationSeconds: 360 },
    });
    await direct(versionId);
    const lighting = await directions.getLatestDirection(projectId, versionId);
    expect(lighting).toMatchObject({ mode: "craft", status: "lighting" });
    const id = lighting?.id ?? "";
    const scenes = await directions.listBatches(id, "scene");
    expect(scenes.length).toBeGreaterThanOrEqual(2);
    expect(scenes[0]).toMatchObject({ kind: "scene", blockFrom: 1, status: "pending" });
    expect(await queued("direction.scene", id)).toEqual(scenes.map((b) => b.batchIndex));
    // Out of order, each delivered twice (a duplicate delivery must not run the dami again).
    const sceneOrder = [...scenes.map((b) => b.batchIndex)].reverse();
    for (const [i, batchIndex] of sceneOrder.entries()) {
      await lightScene(id, batchIndex);
      await lightScene(id, batchIndex);
      const state = await directions.getLatestDirection(projectId, versionId);
      expect(state?.status).toBe(i === sceneOrder.length - 1 ? "planned" : "lighting");
    }
    expect(await runs(projectId, "cinematographer")).toHaveLength(1 + 24);

    const planned = await directions.getLatestDirection(projectId, versionId);
    expect(planned).toMatchObject({ mode: "craft", status: "planned" });
    const batches = await directions.listBatches(id);
    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(planned?.batchCount).toBe(batches.length);
    expect(batches[0]).toMatchObject({
      kind: "write",
      blockFrom: 1,
      blockTo: 8,
      status: "pending",
    });
    expect(await queued("direction.write", id)).toEqual(batches.map((b) => b.batchIndex));
    // Nothing is stored until every batch is.
    expect(await currentBlocks(projectId, userId)).toHaveLength(0);
    expect((await blocks.getSectioningStatus(projectId, userId))?.state).not.toBe("done");

    const order = [...batches.map((b) => b.batchIndex)].reverse();
    for (const [i, batchIndex] of order.entries()) {
      await write(id, batchIndex);
      await write(id, batchIndex);
      const state = await directions.getLatestDirection(projectId, versionId);
      expect(state?.status).toBe(i === order.length - 1 ? "ready" : "writing");
    }
    expect(await runs(projectId, "director")).toHaveLength(batches.length);

    const items = await currentBlocks(projectId, userId);
    const total = (planned?.plan as { blocks: unknown[] }).blocks.length;
    expect(items).toHaveLength(total);
    expect(items.map((b) => b.orderIndex)).toEqual(items.map((_, i) => i));
    expect(
      items.every((b) => (b.direction as { block_id: number }).block_id === b.orderIndex + 1),
    ).toBe(true);
    expect(await blocks.getSectioningStatus(projectId, userId)).toMatchObject({
      state: "done",
      blockCount: total,
    });

    // Late duplicates after the run is ready: no run, no new block versions.
    await write(id, 0);
    await write(id, order[0] ?? 0);
    await lightScene(id, 0);
    expect(await runs(projectId, "cinematographer")).toHaveLength(1 + 24);
    expect(await runs(projectId, "director")).toHaveLength(batches.length);
    expect(await currentBlocks(projectId, userId)).toHaveLength(total);
    const all = await getDb()
      .select({ id: s.promptBlock.id })
      .from(s.promptBlock)
      .where(eq(s.promptBlock.projectId, projectId));
    expect(all).toHaveLength(total);
  });

  it("a script edit directs again: a new direction supersedes the old, lineages are kept", async () => {
    const { userId, projectId, versionId } = await setup({ scenes: 3 });
    await directAll(projectId, versionId);
    const before = await currentBlocks(projectId, userId);
    const first = await directions.getLatestDirection(projectId, versionId);

    const edited = await addVersion(
      projectId,
      2,
      scriptText(3, "INT. ROOM 9 - DAWN\n\nA gull lands on the sill and stays."),
    );
    await scriptDetectAssetsHandler.run({ scriptVersionId: edited }, jobContext());
    expect((await blocks.getSectioningStatus(projectId, userId))?.state).toBe("stale");
    await directAll(projectId, edited);

    const after = await currentBlocks(projectId, userId);
    expect(after.length).toBeGreaterThan(before.length);
    expect(after.every((b) => b.scriptVersionId === edited && !b.stale)).toBe(true);
    const lineages = new Set(before.map((b) => b.lineageId));
    const kept = after.filter((b) => lineages.has(b.lineageId));
    expect(kept.length).toBeGreaterThanOrEqual(before.length - 1);
    expect(kept.every((b) => b.versionNumber === 2)).toBe(true);
    // The new run is the one that is ready; the old one is superseded.
    const old = await getDb()
      .select({ status: s.direction.status })
      .from(s.direction)
      .where(eq(s.direction.id, first?.id ?? ""));
    expect(old[0]?.status).toBe("superseded");
    expect((await directions.getLatestDirection(projectId, edited))?.status).toBe("ready");
  });

  it("a rejected bible fails before any paid call; a retry after the fix directs it", async () => {
    const { userId, projectId, versionId, bibleId } = await setup({
      scenes: 2,
      bible: "rejected",
    });
    await direct(versionId);
    // Refused before a run starts: no direction row and no dami run.
    expect(await directions.getLatestDirection(projectId, versionId)).toBeNull();
    expect(await runs(projectId, "film-director")).toHaveLength(0);
    expect(await currentBlocks(projectId, userId)).toHaveLength(0);
    expect(await blocks.getSectioningStatus(projectId, userId)).toMatchObject({
      state: "failed",
      failure: expect.stringContaining("The Director could not start"),
    });

    // The user fixes the style (a new bible) and tries again through the existing retry path.
    await getDb()
      .update(s.creativeBible)
      .set({ status: "superseded" })
      .where(eq(s.creativeBible.id, bibleId));
    const retried = await blocks.retrySectioning({ projectId, userId });
    expect(retried?.state).toBe("running");
    await scriptDetectAssetsHandler.run({ scriptVersionId: versionId }, jobContext());
    expect((await directAll(projectId, versionId))?.status).toBe("ready");
    expect((await blocks.getSectioningStatus(projectId, userId))?.state).toBe("done");
    expect((await currentBlocks(projectId, userId)).length).toBeGreaterThan(0);
  });

  it("a pending bible defers the run, and nothing is directed meanwhile", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId, REGISTRY_STYLE);
    const versionId = await addVersion(projectId, 1, scriptText(2));
    await scriptDetectAssetsHandler.run({ scriptVersionId: versionId }, jobContext());
    await direct(versionId);
    expect(await runs(projectId, "film-director")).toHaveLength(0);
    expect(await directions.getLatestDirection(projectId, versionId)).toBeNull();
    const rows = await getDb().execute<{ waits: string | null }>(
      sql.raw(
        `select data->>'bibleWaits' as waits from ${jobSchema}.job where name = 'script.direct' ` +
          `and data->>'scriptVersionId' = '${versionId}' order by created_on`,
      ),
    );
    expect(rows.rows.map((r) => r.waits)).toContain("1");
    const order = await getDb()
      .select({ id: s.creativeBible.id })
      .from(s.creativeBible)
      .where(eq(s.creativeBible.projectId, projectId))
      .orderBy(asc(s.creativeBible.versionNumber));
    expect(order).toHaveLength(1);
  });

  it("a style asking for shot-by-shot clips fails with a clear reason and calls nothing", async () => {
    const { userId, projectId, versionId } = await setup({
      scenes: 2,
      style: { ...TEST_STYLE, blockLength: "shot" },
    });
    await direct(versionId);
    expect(await runs(projectId, "film-director")).toHaveLength(0);
    expect(await blocks.getSectioningStatus(projectId, userId)).toMatchObject({
      state: "failed",
      failure: expect.stringContaining("Shot-by-shot clips cannot be directed yet"),
    });
  });
});
