/**
 * The Director pipeline against the local Postgres, in sample mode (the sample Director answers at
 * once and passes its own `check()`): `script.direct` for a short script (one `full` call) and a
 * long one (plan, then `direction.write` batches), idempotent batch completion, the stub bible of a
 * project without one, 30 second blocks, a re-direction after a script edit keeping lineages, and
 * a failed run retried. Handlers run directly; follow-up jobs go to a throwaway queue schema.
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

  async function queuedWrites(directionId: string): Promise<number[]> {
    const result = await getDb().execute<{ index: string }>(
      sql.raw(
        `select data->>'batchIndex' as index from ${jobSchema}.job where name = 'direction.write' ` +
          `and data->>'directionId' = '${directionId}' order by data->>'batchIndex'`,
      ),
    );
    return result.rows.map((r) => Number(r.index));
  }

  it("a short script is one full call: blocks carry the direction, tags and 15 s", async () => {
    const { userId, projectId, versionId } = await setup({ scenes: 3 });
    await direct(versionId);
    expect(await runs(projectId, "director")).toHaveLength(1);
    expect(await runs(projectId, "director-plan")).toHaveLength(0);

    const row = await directions.getLatestDirection(projectId, versionId);
    expect(row).toMatchObject({ mode: "full", status: "ready", batchCount: 0, failure: null });
    expect(row?.creativeBibleId).toBeNull();
    expect(row?.header).toMatchObject({ dami: "director", status: expect.any(String) });

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
    expect(await runs(projectId, "director")).toHaveLength(1);
  });

  it("a project without a bible sends the stub: no rules, ok_with_assumptions", async () => {
    const { projectId, versionId } = await setup({ scenes: 2 });
    await direct(versionId);
    const row = await directions.getLatestDirection(projectId, versionId);
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
      .where(and(eq(s.damiRun.projectId, projectId), eq(s.damiRun.damiKey, "director")));
    expect(dami?.input).toMatchObject({ mode: "full", block_mode: "auto" });
  });

  it("a ready bible with 30 s blocks: fixed_30, blocks of 30 s, its row on the direction", async () => {
    const { userId, projectId, versionId, bibleId } = await setup({
      scenes: 3,
      bible: "ready30",
    });
    await direct(versionId);
    const row = await directions.getLatestDirection(projectId, versionId);
    expect(row).toMatchObject({ status: "ready", blockMode: "fixed_30", creativeBibleId: bibleId });
    const items = await currentBlocks(projectId, userId);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((b) => b.durationSeconds === 30)).toBe(true);
  });

  it("a long script is a plan and batches; the last batch assembles, repeats change nothing", async () => {
    const { userId, projectId, versionId } = await setup({
      scenes: 24,
      style: { ...TEST_STYLE, totalDurationSeconds: 360 },
    });
    await direct(versionId);
    expect(await runs(projectId, "director-plan")).toHaveLength(1);
    expect(await runs(projectId, "director")).toHaveLength(0);

    const planned = await directions.getLatestDirection(projectId, versionId);
    expect(planned).toMatchObject({ mode: "plan", status: "planned" });
    const batches = await directions.listBatches(planned?.id ?? "");
    expect(batches.length).toBeGreaterThanOrEqual(2);
    expect(planned?.batchCount).toBe(batches.length);
    expect(batches[0]).toMatchObject({ blockFrom: 1, blockTo: 8, status: "pending" });
    expect(await queuedWrites(planned?.id ?? "")).toEqual(batches.map((b) => b.batchIndex));
    // Nothing is stored until every batch is.
    expect(await currentBlocks(projectId, userId)).toHaveLength(0);
    expect((await blocks.getSectioningStatus(projectId, userId))?.state).not.toBe("done");

    const write = (batchIndex: number) =>
      directionWriteHandler.run({ directionId: planned?.id ?? "", batchIndex }, jobContext());
    // Out of order, each delivered twice (a duplicate delivery must not run the dami again).
    const order = [...batches.map((b) => b.batchIndex)].reverse();
    for (const [i, batchIndex] of order.entries()) {
      await write(batchIndex);
      await write(batchIndex);
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
    await write(0);
    await write(order[0] ?? 0);
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
    await direct(versionId);
    const before = await currentBlocks(projectId, userId);
    const first = await directions.getLatestDirection(projectId, versionId);

    const edited = await addVersion(
      projectId,
      2,
      scriptText(3, "INT. ROOM 9 - DAWN\n\nA gull lands on the sill and stays."),
    );
    await scriptDetectAssetsHandler.run({ scriptVersionId: edited }, jobContext());
    expect((await blocks.getSectioningStatus(projectId, userId))?.state).toBe("stale");
    await direct(edited);

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

  it("a Director that cannot start fails the run; a retry after the fix directs it", async () => {
    const { userId, projectId, versionId, bibleId } = await setup({
      scenes: 2,
      bible: "rejected",
    });
    await direct(versionId);
    const failed = await directions.getLatestDirection(projectId, versionId);
    expect(failed).toMatchObject({ status: "failed" });
    expect(failed?.failure).toContain("The Director could not start");
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
    await direct(versionId);
    expect((await directions.getLatestDirection(projectId, versionId))?.status).toBe("ready");
    expect((await blocks.getSectioningStatus(projectId, userId))?.state).toBe("done");
    expect((await currentBlocks(projectId, userId)).length).toBeGreaterThan(0);
  });

  it("a pending bible defers the run, and nothing is directed meanwhile", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId, REGISTRY_STYLE);
    const versionId = await addVersion(projectId, 1, scriptText(2));
    await scriptDetectAssetsHandler.run({ scriptVersionId: versionId }, jobContext());
    await direct(versionId);
    expect(await runs(projectId, "director")).toHaveLength(0);
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
});
