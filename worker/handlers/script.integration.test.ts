/**
 * The five script job handlers, run directly (no queue consumer) in sample mode against the real
 * local Postgres and S3 store: each run twice yields one result, and the whole pipeline goes from
 * a brief to prompt blocks. Follow-up jobs go to a throwaway queue schema. Skipped when the
 * database is unreachable.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
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

describe.skipIf(!reachable)("script job handlers (integration, sample mode)", async () => {
  const script = await import("../../src/server/script");
  const assets = await import("../../src/server/assets");
  const blocks = await import("../../src/server/blocks");
  const { closeJobQueue } = await import("../../src/server/jobs");
  const { closeDb, getDb } = await import("../../src/server/db/client");
  const { damiRun, project } = await import("../../src/server/db/schema");
  const { and, desc, eq } = await import("drizzle-orm");
  const { scriptWriteHandler } = await import("./script-write");
  const { scriptCheckHandler } = await import("./script-check");
  const { scriptReviseHandler } = await import("./script-revise");
  const { scriptDetectAssetsHandler } = await import("./script-detect-assets");
  const { scriptDirectHandler } = await import("./script-direct");
  const { directionSceneHandler } = await import("./direction-scene");
  const { directionWriteHandler } = await import("./direction-write");
  const directions = await import("../../src/server/direction");

  /** Runs the scene batches, then the write batches, that `script.direct` queued for a version. */
  async function finishDirection(projectId: string, versionId: string): Promise<void> {
    const row = await directions.getLatestDirection(projectId, versionId);
    if (!row) return;
    for (const b of await directions.listBatches(row.id, "scene")) {
      await directionSceneHandler.run(
        { directionId: row.id, batchIndex: b.batchIndex },
        jobContext(),
      );
    }
    for (const b of await directions.listBatches(row.id, "write")) {
      await directionWriteHandler.run(
        { directionId: row.id, batchIndex: b.batchIndex },
        jobContext(),
      );
    }
  }
  const fixtures = createFixtures();

  afterAll(async () => {
    await fixtures.cleanup();
    await closeJobQueue();
    await dropSchema(jobSchema);
    await closeDb();
  });

  type Handler = { run: (data: unknown, ctx: ReturnType<typeof jobContext>) => Promise<void> };
  async function twice(handler: Handler, scriptVersionId: string): Promise<void> {
    await handler.run({ scriptVersionId }, jobContext());
    await handler.run({ scriptVersionId }, jobContext());
  }

  async function runCount(projectId: string, damiKey: string): Promise<number> {
    const rows = await getDb()
      .select({ id: damiRun.id, model: damiRun.model, costUsd: damiRun.costUsd })
      .from(damiRun)
      .where(and(eq(damiRun.projectId, projectId), eq(damiRun.damiKey, damiKey)));
    for (const row of rows) expect(row).toMatchObject({ model: "sample", costUsd: null });
    return rows.length;
  }

  it("runs the whole pipeline from a brief to prompt blocks, each handler idempotent", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);

    // Write.
    const v1 = await script.startFromBrief({
      projectId,
      userId,
      brief: "An old fisherman named Tomas finds a map in a bottle.",
    });
    await twice(scriptWriteHandler, v1?.id ?? "");
    const written = await script.getScriptVersion(v1?.id ?? "", userId);
    expect(written).toMatchObject({ status: "in_review", isSample: true, title: "The Fisherman" });
    expect(written?.content).toContain("TOMAS");
    expect(written?.structured).toBe(true);
    expect(written?.assumptions.length).toBeGreaterThan(0);
    expect(written?.runtime?.verdict).toBe("ok");
    expect(await runCount(projectId, "script-writer")).toBe(1);

    // Reject with a note and a comment; the writer revises (revise mode) from the note alone.
    const content = written?.content ?? "";
    const quote = content.split("\n").find((l) => l.startsWith("Tomas ")) ?? "";
    const start = content.indexOf(quote);
    expect(start).toBeGreaterThan(0);
    const v2 = await script.submitScriptReview({
      projectId,
      userId,
      versionId: v1?.id ?? "",
      decision: "rejected",
      note: "More hope at the end.",
      comments: [{ quote, start, end: start + quote.length, note: "Angrier." }],
    });
    await twice(scriptReviseHandler, v2?.id ?? "");
    const revised = await script.getScriptVersion(v2?.id ?? "", userId);
    expect(revised).toMatchObject({
      status: "in_review",
      source: "revised",
      title: "The Fisherman",
    });
    expect(revised?.structured).toBe(true);
    expect(revised?.content).not.toEqual(content);
    expect(revised?.notes.length).toBeGreaterThan(0);
    expect(await runCount(projectId, "script-writer")).toBe(2);
    expect(await runCount(projectId, "script-reviser")).toBe(0);
    // The note reached the writer's revise mode as its free-text note, with no reason codes.
    const [reviseRun] = await getDb()
      .select({ input: damiRun.input })
      .from(damiRun)
      .where(and(eq(damiRun.projectId, projectId), eq(damiRun.damiKey, "script-writer")))
      .orderBy(desc(damiRun.createdAt))
      .limit(1);
    expect(reviseRun?.input).toMatchObject({
      mode: "revise",
      feedback: {
        issueType: "preference",
        selectedReasons: [],
        customNote: expect.stringContaining("More hope at the end."),
      },
    });

    // Accept; detect assets; direct.
    await script.submitScriptReview({
      projectId,
      userId,
      versionId: v2?.id ?? "",
      decision: "accepted",
    });
    await twice(scriptDetectAssetsHandler, v2?.id ?? "");
    expect(await runCount(projectId, "asset-detector")).toBe(1);
    const counts = await assets.countAssetsByKind(projectId, userId);
    expect(counts?.character).toBeGreaterThanOrEqual(2);
    expect(counts?.location).toBeGreaterThanOrEqual(2);
    expect(counts?.prop).toBeGreaterThanOrEqual(1);

    await twice(scriptDirectHandler, v2?.id ?? "");
    await finishDirection(projectId, v2?.id ?? "");
    expect(await runCount(projectId, "film-director")).toBe(1);
    expect(await runCount(projectId, "director")).toBeGreaterThanOrEqual(1);
    const status = await blocks.getSectioningStatus(projectId, userId);
    expect(status?.state).toBe("done");
    expect(status?.blockCount).toBeGreaterThan(3);
    const page = await blocks.listBlocks(projectId, userId, { limit: 200 });
    expect(page?.items.every((b) => b.scriptVersionId === v2?.id && b.damiRunId)).toBe(true);
    expect(page?.items.some((b) => b.assetRefs.length > 0)).toBe(true);

    // Edit the accepted script: the old version's jobs do nothing; the new one re-detects as a
    // diff, marks old blocks stale, and directs again keeping lineage where excerpts are unchanged.
    const edited = await script.editAcceptedScript({
      projectId,
      userId,
      content: `${(revised?.content ?? "").trimEnd()}\n\nA gull lands on the rail and stays.`,
    });
    await scriptDetectAssetsHandler.run({ scriptVersionId: v2?.id ?? "" }, jobContext());
    await scriptDirectHandler.run({ scriptVersionId: v2?.id ?? "" }, jobContext());
    expect(await runCount(projectId, "asset-detector")).toBe(1);

    await scriptDetectAssetsHandler.run({ scriptVersionId: edited?.id ?? "" }, jobContext());
    expect((await blocks.getSectioningStatus(projectId, userId))?.state).toBe("running");
    const staleBlocks = await blocks.listBlocks(projectId, userId, { limit: 200 });
    expect(staleBlocks?.items.every((b) => b.stale)).toBe(true);

    await scriptDirectHandler.run({ scriptVersionId: edited?.id ?? "" }, jobContext());
    await finishDirection(projectId, edited?.id ?? "");
    const after = await blocks.listBlocks(projectId, userId, { limit: 200 });
    expect(after?.items.every((b) => b.scriptVersionId === edited?.id && !b.stale)).toBe(true);
    expect(after?.items.some((b) => b.versionNumber === 2)).toBe(true); // carried lineage
    expect((await blocks.getSectioningStatus(projectId, userId))?.state).toBe("done");

    const [row] = await getDb().select().from(project).where(eq(project.id, projectId));
    expect(row?.stage).toBe("pre_production");
  });

  it("checks an uploaded script once and shows its findings", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const { putFileBytes } = await import("../../src/server/storage");
    const text = [
      "EXT. HARBOUR PIER - DUSK",
      "",
      "MARA (60s), wiry, grey-streaked braid, hurries down the planks clutching a brass locket while the ferry horn sounds.",
      "",
      "MARA",
      "Wait. Please wait.",
      "",
      "INT. FERRY CABIN - CONTINUOUS",
      "",
      "JONAS sits alone by the window.",
      "",
      "JONAS",
      "You kept it.",
    ].join("\n");
    const file = await putFileBytes({
      ownerId: userId,
      projectId,
      name: "pier.txt",
      mimeType: "text/plain",
      purpose: "script_document",
      bytes: new TextEncoder().encode(text),
    });
    const v1 = await script.startFromUpload({ projectId, userId, fileId: file.id });
    await twice(scriptCheckHandler, v1?.id ?? "");
    const checked = await script.getScriptVersion(v1?.id ?? "", userId);
    expect(checked).toMatchObject({ status: "in_review", source: "uploaded", isSample: true });
    expect(checked?.content).toBe(text);
    expect(checked?.findings?.length).toBeGreaterThanOrEqual(2);
    expect(checked?.checkVerdict).not.toBeNull();
    expect(await runCount(projectId, "script-checker")).toBe(1);
  });

  it("expands a quick idea with the Enhancer and saves the look line", async () => {
    const { scriptEnhanceHandler } = await import("./script-enhance");
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId, {
      ...TEST_STYLE,
      genre: "comedy",
      visualStyle: "claymation",
    });
    const v1 = await script.startFromIdea({ projectId, userId, idea: "A chef drops the eggs." });
    expect(v1?.source).toBe("enhanced");
    await twice(scriptEnhanceHandler, v1?.id ?? "");
    const ready = await script.getScriptVersion(v1?.id ?? "", userId);
    expect(ready).toMatchObject({ status: "in_review", source: "enhanced", isSample: true });
    expect(ready?.content).toContain("A chef drops the eggs.");
    expect(ready?.lookLine).toBeTruthy();
    expect(ready?.enhanceFellBack).toBe(false);
    expect(ready?.structured).toBe(false);
    const [row] = await getDb().select().from(project).where(eq(project.id, projectId));
    expect(row?.style?.lookLine).toBe(ready?.lookLine);
    expect(await runCount(projectId, "enhancer")).toBe(1);
  });

  it("writes a series one episode per call, stitched in order", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId, {
      ...TEST_STYLE,
      format: "series",
      totalDurationSeconds: 180,
      episodeDurationSeconds: 60,
    });
    const v1 = await script.startFromBrief({ projectId, userId, brief: "Two rival bakers." });
    await twice(scriptWriteHandler, v1?.id ?? "");
    const written = await script.getScriptVersion(v1?.id ?? "", userId);
    expect(written?.status).toBe("in_review");
    const episodes = (written?.content ?? "").split("\n").filter((l) => /^EPISODE \d+/.test(l));
    expect(episodes).toHaveLength(3);
    expect(await runCount(projectId, "script-writer")).toBeGreaterThanOrEqual(3);
  });

  it("plans a long film as an outline, then writes it sequence by sequence", async () => {
    const { scriptWriteSegmentHandler } = await import("./script-write-segment");
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId, {
      ...TEST_STYLE,
      totalDurationSeconds: 20 * 60,
    });
    const v1 = await script.startFromBrief({ projectId, userId, brief: "A courier named Lena." });
    await twice(scriptWriteHandler, v1?.id ?? "");
    const outlined = await script.getScriptVersion(v1?.id ?? "", userId);
    expect(outlined?.status).toBe("in_review");
    expect(outlined?.content).toBeNull();
    const outline = outlined?.outline;
    if (!outline) throw new Error("no outline");
    await expect(
      script.submitScriptReview({
        projectId,
        userId,
        versionId: v1?.id ?? "",
        decision: "accepted",
      }),
    ).rejects.toThrow(/Approve the outline/);

    const v2 = await script.approveOutline({
      projectId,
      userId,
      versionId: v1?.id ?? "",
      approvedAdditions: [0],
    });
    expect(v2).toMatchObject({ status: "pending", source: "generated", writingSegments: true });
    // The write job hands over to the segment jobs; run them in order (each twice).
    await scriptWriteHandler.run({ scriptVersionId: v2?.id ?? "" }, jobContext());
    const sequences = outline.acts.flatMap((a) => a.sequences);
    for (let i = 0; i < sequences.length; i++) {
      const data = { scriptVersionId: v2?.id ?? "", segmentIndex: i };
      await scriptWriteSegmentHandler.run(data, jobContext());
      await scriptWriteSegmentHandler.run(data, jobContext());
    }
    const written = await script.getScriptVersion(v2?.id ?? "", userId);
    expect(written?.status).toBe("in_review");
    expect(written?.structured).toBe(true);
    const sceneCount = sequences.reduce((n, s) => n + s.scenes.length, 0);
    const headings = (written?.content ?? "").split("\n").filter((l) => /^(INT|EXT)\./.test(l));
    expect(headings).toHaveLength(sceneCount);
    expect(await runCount(projectId, "script-writer")).toBe(sequences.length);
  });

  it("corrects the detected list: a merge, something missing, a re-scan", async () => {
    const { assetDetectFixHandler } = await import("./asset-detect-fix");
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const v1 = await script.startFromBrief({
      projectId,
      userId,
      brief: "An old fisherman named Tomas and his granddaughter Leyla find a map in a bottle.",
    });
    await scriptWriteHandler.run({ scriptVersionId: v1?.id ?? "" }, jobContext());
    await script.submitScriptReview({
      projectId,
      userId,
      versionId: v1?.id ?? "",
      decision: "accepted",
    });
    await scriptDetectAssetsHandler.run({ scriptVersionId: v1?.id ?? "" }, jobContext());
    const characters = await assets.listAssets(projectId, userId, { kind: "character" });
    const names = characters?.items.map((c) => c.name) ?? [];
    expect(names.length).toBeGreaterThanOrEqual(2);

    const { getDb: db } = await import("../../src/server/db/client");
    const { review } = await import("../../src/server/db/schema");
    const latestReview = async () =>
      (
        await db()
          .select({ id: review.id })
          .from(review)
          .where(eq(review.projectId, projectId))
          .orderBy(desc(review.createdAt))
          .limit(1)
      )[0]?.id ?? "";

    // A change request in free text: one custom-text fix request of the owner's "Other" (ADP99).
    const note = `${names[0]} and ${names[1]} are the same character. Keep one of them.`;
    const started = await assets.submitDetectionReview({ projectId, userId, note });
    expect(started).toEqual({ started: true });
    expect((await assets.getDetectionPanel(projectId, userId))?.busy).toBe(true);
    const reviewId = await latestReview();
    await assetDetectFixHandler.run({ reviewId }, jobContext());
    await assetDetectFixHandler.run({ reviewId }, jobContext());
    // The note reached the detector in fix mode as the custom text of its one request.
    const [fixRun] = await db()
      .select({ input: damiRun.input })
      .from(damiRun)
      .where(and(eq(damiRun.projectId, projectId), eq(damiRun.damiKey, "asset-detector")))
      .orderBy(desc(damiRun.createdAt))
      .limit(1);
    expect(fixRun?.input).toMatchObject({
      mode: "fix",
      fix_requests: [{ type: "preference", code: "ADP99", custom_text: note }],
    });
    // The corrected list is applied and the Director runs again.
    const { project: projectTable } = await import("../../src/server/db/schema");
    const [sectioning] = await db()
      .select({ stageState: projectTable.stageState })
      .from(projectTable)
      .where(eq(projectTable.id, projectId));
    expect(sectioning?.stageState.sectioning).toMatchObject({ state: "running" });
    const after = await assets.listAssets(projectId, userId, { kind: "character" });
    const panel = await assets.getDetectionPanel(projectId, userId);
    expect(panel).toMatchObject({ busy: false, rounds: 1, failure: null });

    // A thing the script does not contain: the dami keeps the list and says so; no new asset.
    await assets.submitDetectionReview({ projectId, userId, note: "a purple giraffe" });
    await assetDetectFixHandler.run({ reviewId: await latestReview() }, jobContext());
    expect((await assets.listAssets(projectId, userId, { kind: "character" }))?.items.length).toBe(
      after?.items.length,
    );

    // ADR01: a re-scan runs incrementally and keeps the stored names.
    await assets.submitDetectionReview({ projectId, userId, rescan: true });
    await assetDetectFixHandler.run({ reviewId: await latestReview() }, jobContext());
    const rescanned = await assets.listAssets(projectId, userId, { kind: "character" });
    expect(rescanned?.items.map((c) => c.name)).toEqual(
      expect.arrayContaining(after?.items.map((c) => c.name) ?? []),
    );
    expect(await runCount(projectId, "asset-detector")).toBe(4);
  });

  it("records a user-readable failure for a non-retryable error", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const { putFileBytes } = await import("../../src/server/storage");
    const file = await putFileBytes({
      ownerId: userId,
      projectId,
      name: "blank.txt",
      mimeType: "text/plain",
      purpose: "script_document",
      bytes: new TextEncoder().encode("   \n\n  "),
    });
    const v1 = await script.startFromUpload({ projectId, userId, fileId: file.id });
    await scriptCheckHandler.run({ scriptVersionId: v1?.id ?? "" }, jobContext());
    const failed = await script.getScriptVersion(v1?.id ?? "", userId);
    expect(failed?.status).toBe("failed");
    expect(failed?.failure).toBe("This file has no text in it.");
  });
});
