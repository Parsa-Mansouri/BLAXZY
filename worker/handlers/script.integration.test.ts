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
  const { and, eq } = await import("drizzle-orm");
  const { scriptWriteHandler } = await import("./script-write");
  const { scriptCheckHandler } = await import("./script-check");
  const { scriptReviseHandler } = await import("./script-revise");
  const { scriptDetectAssetsHandler } = await import("./script-detect-assets");
  const { scriptSectionHandler } = await import("./script-section");
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
    expect(await runCount(projectId, "script-writer")).toBe(1);

    // Reject with chips, a note and a comment; revise.
    const content = written?.content ?? "";
    const quote = "Not today. Not after all this.";
    const start = content.indexOf(quote);
    expect(start).toBeGreaterThan(0);
    const v2 = await script.submitScriptReview({
      projectId,
      userId,
      versionId: v1?.id ?? "",
      decision: "rejected",
      issueCodes: ["ending_weak"],
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
    expect(revised?.content).toContain(`${quote} (angrier)`);
    expect(revised?.notes).toHaveLength(3);
    expect(await runCount(projectId, "script-reviser")).toBe(1);

    // Accept; detect assets; section.
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

    await twice(scriptSectionHandler, v2?.id ?? "");
    const sectionerRuns = await runCount(projectId, "prompt-sectioner");
    expect(sectionerRuns).toBeGreaterThanOrEqual(1);
    const status = await blocks.getSectioningStatus(projectId, userId);
    expect(status?.state).toBe("done");
    expect(status?.blockCount).toBeGreaterThan(3);
    const page = await blocks.listBlocks(projectId, userId, { limit: 200 });
    expect(page?.items.every((b) => b.scriptVersionId === v2?.id && b.damiRunId)).toBe(true);
    expect(page?.items.some((b) => b.assetRefs.length > 0)).toBe(true);

    // Edit the accepted script: the old version's jobs do nothing; the new one re-detects as a
    // diff, marks old blocks stale, and resections keeping lineage where excerpts are unchanged.
    const edited = await script.editAcceptedScript({
      projectId,
      userId,
      content: (revised?.content ?? "").replace("Ask me tomorrow.", "Ask me in a year."),
    });
    await scriptDetectAssetsHandler.run({ scriptVersionId: v2?.id ?? "" }, jobContext());
    await scriptSectionHandler.run({ scriptVersionId: v2?.id ?? "" }, jobContext());
    expect(await runCount(projectId, "asset-detector")).toBe(1);

    await scriptDetectAssetsHandler.run({ scriptVersionId: edited?.id ?? "" }, jobContext());
    expect((await blocks.getSectioningStatus(projectId, userId))?.state).toBe("running");
    const staleBlocks = await blocks.listBlocks(projectId, userId, { limit: 200 });
    expect(staleBlocks?.items.every((b) => b.stale)).toBe(true);

    await scriptSectionHandler.run({ scriptVersionId: edited?.id ?? "" }, jobContext());
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
