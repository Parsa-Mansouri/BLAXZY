/**
 * Block replacement and stale marking against the real local Postgres. Skipped when unreachable.
 */
import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import type { SectionedBlock } from "@/server/damis";
import { createFixtures, databaseReachable } from "@/server/test-support/script-fixtures";

const reachable = await databaseReachable();

describe.skipIf(!reachable)("blocks service (integration)", async () => {
  const blocks = await import("@/server/blocks");
  const { closeDb, getDb } = await import("@/server/db/client");
  const { promptBlock, scriptVersion } = await import("@/server/db/schema");
  const { eq } = await import("drizzle-orm");
  const fixtures = createFixtures();

  afterAll(async () => {
    await fixtures.cleanup();
    await closeDb();
  });

  async function version(projectId: string, versionNumber: number): Promise<string> {
    const [row] = await getDb()
      .insert(scriptVersion)
      .values({ projectId, versionNumber, source: "edited", status: "accepted", content: "x" })
      .returning({ id: scriptVersion.id });
    if (!row) throw new Error("setup failed");
    return row.id;
  }

  const block = (
    orderIndex: number,
    excerpt: string,
    prompt = `Prompt ${excerpt}`,
  ): SectionedBlock => ({
    title: `Block ${orderIndex}`,
    scriptExcerpt: excerpt,
    prompt,
    durationSeconds: 5,
    assetRefs: ["character:mara"],
    startLine: orderIndex + 1,
    endLine: orderIndex + 1,
    orderIndex,
    start: 0,
    end: excerpt.length,
  });

  it("replaces blocks keeping lineage for unchanged excerpts, and marks stale", async () => {
    const userId = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    const v1 = await version(projectId, 1);
    const r1 = await blocks.replaceBlocks({
      projectId,
      scriptVersionId: v1,
      blocks: [block(0, "Mara runs."), block(1, "Jonas waits."), block(2, "They meet.")],
      damiRunIds: [],
    });
    expect(r1).toEqual({ created: 3, carried: 0, superseded: 0 });
    const first = (await blocks.listBlocks(projectId, userId))?.items ?? [];
    expect(first.map((b) => b.versionNumber)).toEqual([1, 1, 1]);

    expect(await blocks.markBlocksStale({ projectId, reason: "The script changed." })).toBe(3);
    expect(await blocks.markBlocksStale({ projectId, reason: "Again." })).toBe(0);
    expect((await blocks.getSectioningStatus(projectId, userId))?.state).toBe("stale");

    const v2 = await version(projectId, 2);
    const r2 = await blocks.replaceBlocks({
      projectId,
      scriptVersionId: v2,
      blocks: [
        block(0, "Mara   runs.\n", "Prompt Mara runs."), // same excerpt modulo whitespace, same prompt
        block(1, "Jonas waits.", "A new prompt"), // same excerpt, new prompt
        block(2, "Something new."),
      ],
      damiRunIds: [],
    });
    expect(r2).toEqual({ created: 1, carried: 2, superseded: 3 });

    const current = (await blocks.listBlocks(projectId, userId))?.items ?? [];
    expect(current).toHaveLength(3);
    expect(current.every((b) => b.scriptVersionId === v2 && !b.stale)).toBe(true);
    const lineage = (i: number) => first[i]?.lineageId;
    expect(current[0]).toMatchObject({
      lineageId: lineage(0),
      versionNumber: 2,
      prompt: "Prompt Mara runs.",
    });
    expect(current[1]).toMatchObject({
      lineageId: lineage(1),
      versionNumber: 2,
      prompt: "A new prompt",
    });
    expect([lineage(0), lineage(1), lineage(2)]).not.toContain(current[2]?.lineageId);

    const history = await getDb()
      .select()
      .from(promptBlock)
      .where(eq(promptBlock.projectId, projectId));
    expect(history).toHaveLength(6);
    expect(history.filter((b) => b.supersededAt !== null)).toHaveLength(3);

    expect(await blocks.hasCurrentBlocksFor(projectId, v2)).toBe(true);
    expect(await blocks.hasCurrentBlocksFor(projectId, v1)).toBe(false);
    expect(await blocks.getSectioningStatus(projectId, userId)).toMatchObject({
      state: "done",
      blockCount: 3,
    });
  });

  it("paginates, reports sectioning state and hides other users' blocks", async () => {
    const userId = await fixtures.newUser();
    const other = await fixtures.newUser();
    const projectId = await fixtures.newProject(userId);
    expect((await blocks.getSectioningStatus(projectId, userId))?.state).toBe("idle");
    const v1 = await version(projectId, 1);
    await blocks.setSectioningState({
      projectId,
      state: "running",
      scriptVersionId: v1,
      failure: null,
    });
    expect((await blocks.getSectioningStatus(projectId, userId))?.state).toBe("running");
    // A write for another version is ignored with onlyFor.
    expect(
      await blocks.setSectioningState({
        projectId,
        state: "failed",
        scriptVersionId: v1,
        failure: "x",
        onlyFor: "00000000-0000-4000-8000-000000000000",
      }),
    ).toBe(false);
    await blocks.replaceBlocks({
      projectId,
      scriptVersionId: v1,
      blocks: [0, 1, 2, 3, 4].map((i) => block(i, `Line ${i}.`)),
      damiRunIds: [],
    });
    await blocks.setSectioningState({
      projectId,
      state: "failed",
      scriptVersionId: v1,
      failure: "Claude is busy right now.",
      onlyFor: v1,
    });
    expect(await blocks.getSectioningStatus(projectId, userId)).toMatchObject({
      state: "failed",
      failure: "Claude is busy right now.",
      blockCount: 5,
    });
    const p1 = await blocks.listBlocks(projectId, userId, { limit: 3 });
    const p2 = await blocks.listBlocks(projectId, userId, { limit: 3, cursor: p1?.nextCursor });
    expect([...(p1?.items ?? []), ...(p2?.items ?? [])].map((b) => b.orderIndex)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(p2?.nextCursor).toBeNull();
    expect(await blocks.listBlocks(projectId, other)).toBeNull();
    expect(await blocks.getSectioningStatus(projectId, other)).toBeNull();
  });
});
